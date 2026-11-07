"""Core protocol tests. Run: python3 -m unittest discover -s tests -v"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from _harness import RepoCase, sh  # noqa: E402


class ProtocolTest(RepoCase):
    def test_thread_and_pending(self):
        a = self.acp
        m1 = a.new_message("claudiu", "gepeto", "Test", "Salut", mtype="proposal", runtime="claude-code")
        self.assertEqual(m1["thread"], m1["id"])
        self.assertEqual([p["message"] for p in a.pending_for("gepeto")], [m1["id"]])
        m2 = a.new_message("gepeto", "claudiu", "Re: Test", "Răspuns", in_reply_to=m1["id"], runtime="sim")
        self.assertEqual(m2["thread"], m1["id"])
        self.assertEqual(a.pending_for("gepeto"), [])
        self.assertEqual([p["message"] for p in a.pending_for("claudiu")], [m2["id"]])
        self.assertEqual(a.validate(), [])
        self.assertIn("Răspuns", (self.root / "discussions" / f"{m1['id']}.md").read_text())

    def test_same_second_ordering(self):
        a = self.acp
        m = a.new_message("claudiu", "gepeto", "A", "1", runtime="claude-code")
        for i in range(3):
            m = a.new_message("gepeto" if i % 2 == 0 else "claudiu", "claudiu" if i % 2 == 0 else "gepeto",
                              "Re", str(i), in_reply_to=m["id"], runtime="sim")
        self.assertEqual(a.threads()[m["thread"]][-1]["id"], m["id"])

    def test_gepeto_sim_runner_end_to_end(self):
        a = self.acp
        m = a.new_message("claudiu", "gepeto", "Ping", "Test", runtime="claude-code")
        env = {**os.environ}
        r = sh(self.root, sys.executable, "agents/gepeto/run_openai.py", "--mode", "sim", env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(json.loads(r.stdout)["to_claudiu"])
        pend = a.pending_for("claudiu")
        self.assertEqual(len(pend), 1)
        reply = a.find_message(pend[0]["message"])
        self.assertEqual((reply["in_reply_to"], reply["runtime"]), (m["id"], "sim"))
        self.assertIn("SIMULARE", reply["body"])

    def test_api_mode_without_key_fails_cleanly(self):
        self.acp.new_message("claudiu", "gepeto", "Ping", "Test", runtime="claude-code")
        r = sh(self.root, sys.executable, "agents/gepeto/run_openai.py", "--mode", "api", env={**os.environ})
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("OPENAI_API_KEY", r.stderr)
        self.assertNotIn("Traceback", r.stderr)

    def test_views_show_needs_adrian(self):
        a = self.acp
        a.new_message("gepeto", "claudiu", "Cumpărăm ceva", "x", requires_adrian=True, runtime="sim")
        self.assertIn("Cumpărăm ceva", (self.root / "inbox" / "adrian.md").read_text())

    def test_costs_report(self):
        a = self.acp
        month = a.iso(a.now_utc())[:7]
        for kind, cid, cost in [("reservation", "c1", 0.01), ("actual", "c1", 0.002),
                                ("reservation", "c2", 0.01), ("failed", "c2", 0.01)]:
            a.append_jsonl(a.USAGE, {"ts": f"{month}-05T00:00:00Z", "kind": kind, "call_id": cid, "model": "gpt-6-luna",
                                     "thread": "t", "input_tokens": 1000, "output_tokens": 100, "cost_usd": cost})
        u = a.month_usage(month)
        self.assertAlmostEqual(u["total"], 0.002 + 0.01)  # c2: reservation + failed = one call
        rep = a.costs_report(month)
        self.assertIn("gpt-6-luna", rep)
        self.assertIn("nu e o garanție absolută", rep)
