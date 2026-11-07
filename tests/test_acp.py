"""Core protocol tests. Run: python3 -m unittest discover -s tests -v"""
import json
import re
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
        r = sh(self.root, sys.executable, "agents/gepeto/run_auto.py", "--provider", "sim", env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertTrue(json.loads(r.stdout)["to_claudiu"])
        pend = a.pending_for("claudiu")
        self.assertEqual(len(pend), 1)
        reply = a.find_message(pend[0]["message"])
        self.assertEqual((reply["in_reply_to"], reply["runtime"]), (m["id"], "sim"))
        self.assertIn("SIMULARE", reply["body"])

    def test_default_provider_writes_nothing(self):
        self.acp.new_message("claudiu", "gepeto", "Ping", "Test", runtime="claude-code")
        r = sh(self.root, sys.executable, "agents/gepeto/run_auto.py", env={**os.environ})
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(json.loads(r.stdout)["provider"], "none")
        self.assertEqual(len(self.acp.pending_for("gepeto")), 1)

    def test_paid_or_remote_providers_refused(self):
        for p in ("openai", "api", "gemini"):
            r = sh(self.root, sys.executable, "agents/gepeto/run_auto.py", "--provider", p, env={**os.environ})
            self.assertEqual(r.returncode, 2, p)
            self.assertIn("REFUZAT", r.stderr)
        cfg = json.loads((self.root / "protocol" / "config.json").read_text())
        cfg["gepeto_auto"]["local"]["endpoint"] = "https://api.exemplu.com/v1/chat/completions"
        (self.root / "protocol" / "config.json").write_text(json.dumps(cfg))
        r = sh(self.root, sys.executable, "agents/gepeto/run_auto.py", "--provider", "local", env={**os.environ})
        self.assertEqual(r.returncode, 2)
        self.assertIn("localhost", r.stderr)

    def test_chatgpt_reply_template_roundtrip(self):
        """Gepeto from ChatGPT copies the template from inbox/gepeto.md; Adrian commits it; it is valid."""
        a = self.acp
        m = a.new_message("claudiu", "gepeto", "Întrebare reală", "Ce alegem?", runtime="claude-code")
        base = self.commit("claudiu")
        inbox = (self.root / "inbox" / "gepeto.md").read_text()
        path = re.search(r"`(messages/\d{4}/\d{2}/M-[^`]+\.md)`", inbox).group(1)
        tpl = re.search(r"~~~markdown\n(.*?)~~~", inbox, re.S).group(1)
        self.assertIn(f"in_reply_to: {m['id']}", tpl)
        text = tpl.replace("(Gepeto scrie aici răspunsul.)", "Alegem varianta B.").replace("\n", "\r\n")
        (self.root / path).parent.mkdir(parents=True, exist_ok=True)
        (self.root / path).write_bytes(text.encode("utf-8"))
        self.commit("gepeto din chatgpt", author="Adrian")
        self.assertEqual(self.guard(base, "Adriancu91"), [])
        self.assertEqual(a.validate(), [])
        pend = a.pending_for("claudiu")
        self.assertEqual(len(pend), 1)
        got = a.find_message(pend[0]["message"])
        self.assertEqual((got["runtime"], got["in_reply_to"]), ("chatgpt-ui", m["id"]))
        self.assertIn("varianta B", got["body"])

    def test_views_show_needs_adrian(self):
        a = self.acp
        a.new_message("gepeto", "claudiu", "Cumpărăm ceva", "x", requires_adrian=True, runtime="sim")
        self.assertIn("Cumpărăm ceva", (self.root / "inbox" / "adrian.md").read_text())

    def test_costs_report(self):
        a = self.acp
        month = a.iso(a.now_utc())[:7]
        a.new_message("claudiu", "gepeto", "Q", "x", runtime="claude-code")
        a.append_jsonl(a.USAGE, {"ts": f"{month}-05T00:00:00Z", "kind": "local-call", "agent": "gepeto",
                                 "model": "qwen2.5:7b-instruct", "thread": "t", "cost_usd": 0})
        rep = a.costs_report(month)
        self.assertIn("Buget API: **0 USD**", rep)
        self.assertIn("Apeluri la modelul local (gratuit): 1", rep)
        self.assertIn("claudiu: 1", rep)
