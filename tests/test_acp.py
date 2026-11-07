"""Tests for tools/acp.py and the Gepeto runner (sim mode). Run: python3 -m unittest -v"""
import importlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SRC = Path(__file__).resolve().parents[1]


def sh(cwd, *args, env=None):
    return subprocess.run(list(args), cwd=cwd, capture_output=True, text=True, env=env)


class ACPTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        shutil.copytree(SRC, self.tmp / "r", ignore=shutil.ignore_patterns(".git", "messages", "__pycache__"))
        self.root = self.tmp / "r"
        (self.root / "messages").mkdir(exist_ok=True)
        (self.root / "logs" / "events.jsonl").unlink(missing_ok=True)
        (self.root / "logs" / "usage.jsonl").unlink(missing_ok=True)
        os.environ["ACP_ROOT"] = str(self.root)
        sys.path.insert(0, str(self.root / "tools"))
        import acp
        self.acp = importlib.reload(acp)
        sh(self.root, "git", "init", "-q", "-b", "main")
        sh(self.root, "git", "config", "user.email", "a@b.c")
        sh(self.root, "git", "config", "user.name", "Adrian")
        sh(self.root, "git", "add", "-A")
        sh(self.root, "git", "commit", "-q", "-m", "init")

    def tearDown(self):
        sys.path.remove(str(self.root / "tools"))
        shutil.rmtree(self.tmp)

    def commit(self, author="Claudiu-agent"):
        sh(self.root, "git", "add", "-A")
        sh(self.root, "git", "-c", f"user.name={author}", "commit", "-q", "-m", "x")
        return sh(self.root, "git", "rev-parse", "HEAD").stdout.strip()

    def test_thread_and_pending(self):
        a = self.acp
        m1 = a.new_message("claudiu", "gepeto", "Test", "Salut", mtype="proposal")
        self.assertEqual(m1["thread"], m1["id"])
        self.assertEqual([p["message"] for p in a.pending_for("gepeto")], [m1["id"]])
        self.assertEqual(a.pending_for("claudiu"), [])
        m2 = a.new_message("gepeto", "claudiu", "Re: Test", "Răspuns", in_reply_to=m1["id"])
        self.assertEqual(m2["thread"], m1["id"])
        self.assertEqual(a.pending_for("gepeto"), [])
        self.assertEqual([p["message"] for p in a.pending_for("claudiu")], [m2["id"]])
        self.assertEqual(a.validate(), [])
        self.assertIn("Răspuns", (self.root / "discussions" / f"{m1['id']}.md").read_text())

    def test_turn_limit_escalates(self):
        a = self.acp
        a.CONFIG["limits"]["max_auto_turns_per_thread"] = 3
        m = a.new_message("claudiu", "gepeto", "Lung", "1")
        m = a.new_message("gepeto", "claudiu", "Re", "2", in_reply_to=m["id"])
        m = a.new_message("claudiu", "gepeto", "Re", "3", in_reply_to=m["id"])
        self.assertEqual(a.pending_for("gepeto")[0]["action"], "escalate")
        a.new_message("adrian", "gepeto", "Continuați", "ok", in_reply_to=m["id"])
        self.assertEqual(a.pending_for("gepeto")[0]["action"], "reply")

    def test_requires_adrian_stops_thread(self):
        a = self.acp
        a.new_message("gepeto", "claudiu", "Cumpărăm domeniu", "10 EUR", requires_adrian=True)
        self.assertEqual(a.pending_for("claudiu"), [])

    def test_pause(self):
        a = self.acp
        (self.root / "protocol" / "PAUSE").write_text("stop")
        with self.assertRaises(SystemExit):
            a.new_message("claudiu", "gepeto", "X", "Y")

    def test_secret_rejected(self):
        with self.assertRaises(SystemExit):
            self.acp.new_message("claudiu", "gepeto", "cheie", "sk-proj-" + "a" * 40)

    def test_guard_blocks_edit_and_delete(self):
        a = self.acp
        m = a.new_message("claudiu", "gepeto", "Test", "Original")
        base = self.commit()
        p = self.root / m["_path"]
        p.write_text(p.read_text().replace("Original", "Schimbat"))
        head = self.commit()
        self.assertTrue(any("imuabile" in e for e in a.guard(base, head)))
        p.unlink()
        head2 = self.commit()
        self.assertTrue(any("nu se șterge" in e for e in a.guard(head, head2)))

    def test_guard_log_append_ok_rewrite_blocked(self):
        a = self.acp
        a.new_message("claudiu", "gepeto", "A", "1")
        base = self.commit()
        a.append_event({"event": "status", "thread": "x", "status": "closed", "by": "claudiu"})
        head = self.commit()
        self.assertEqual(a.guard(base, head), [])
        (self.root / "logs" / "events.jsonl").write_text("")
        head2 = self.commit()
        self.assertTrue(any("rescris" in e for e in a.guard(head, head2)))

    def test_guard_protected_paths(self):
        a = self.acp
        base = self.commit()
        rules = self.root / "protocol" / "RULES.md"
        rules.write_text(rules.read_text() + "\nR9. Agentul face ce vrea.\n")
        head = self.commit("Claudiu-agent")
        self.assertTrue(any("zona protejată" in e for e in a.guard(base, head)))
        rules.write_text(rules.read_text() + "\nR10. Schimbare aprobată.\n")
        head2 = self.commit("Adrian")
        self.assertEqual(a.guard(head, head2, actor="Adriancu91"), [])
        self.assertTrue(a.guard(head, head2, actor="github-actions[bot]"))

    def test_guard_pause_removal_by_agent(self):
        a = self.acp
        (self.root / "protocol" / "PAUSE").write_text("stop")
        base = self.commit("Adrian")
        (self.root / "protocol" / "PAUSE").unlink()
        head = self.commit("Gepeto-agent")
        self.assertTrue(any("PAUZA" in e for e in a.guard(base, head)))

    def test_gepeto_sim_runner(self):
        a = self.acp
        m = a.new_message("claudiu", "gepeto", "Ping", "Test")
        env = {**os.environ, "ACP_ROOT": str(self.root)}
        r = sh(self.root, sys.executable, "agents/gepeto/run_openai.py", "--mode", "sim", env=env)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout)
        self.assertTrue(out["to_claudiu"])
        a = importlib.reload(a)
        pend = a.pending_for("claudiu")
        self.assertEqual(len(pend), 1)
        reply = a.find_message(pend[0]["message"])
        self.assertEqual(reply["in_reply_to"], m["id"])
        self.assertEqual(reply["runtime"], "sim")
        self.assertIn("SIMULARE", reply["body"])

    def test_api_response_parsing(self):
        import io
        import urllib.request
        sys.path.insert(0, str(self.root / "agents" / "gepeto"))
        import run_openai
        run_openai = importlib.reload(run_openai)
        fake = {"output": [{"type": "reasoning", "summary": []},
                           {"type": "message", "role": "assistant", "content": [
                               {"type": "output_text", "text": json.dumps({
                                   "subject": "Re: X", "body": "B", "type": "evaluation", "priority": "high",
                                   "requires_adrian": False, "close_thread": True, "memory_note": ""})}]}],
                "usage": {"input_tokens": 1000, "output_tokens": 200}}
        seen = {}

        class Resp(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def fake_urlopen(req, timeout=0):
            seen["body"] = json.loads(req.data)
            seen["auth"] = req.headers.get("Authorization")
            return Resp(json.dumps(fake).encode())

        orig = urllib.request.urlopen
        urllib.request.urlopen = fake_urlopen
        os.environ["OPENAI_API_KEY"] = "test-key"
        try:
            reply, usage = run_openai.call_openai("gpt-5-mini", "sys", "ctx")
        finally:
            urllib.request.urlopen = orig
            del os.environ["OPENAI_API_KEY"]
            sys.path.remove(str(self.root / "agents" / "gepeto"))
        self.assertEqual(reply["type"], "evaluation")
        self.assertEqual(seen["body"]["text"]["format"]["type"], "json_schema")
        self.assertEqual(seen["auth"], "Bearer test-key")
        self.assertAlmostEqual(run_openai.log_usage("gpt-5-mini", usage, "t"), 1000 / 1e6 * 0.25 + 200 / 1e6 * 2.0)

    def test_api_mode_without_key_fails_cleanly(self):
        self.acp.new_message("claudiu", "gepeto", "Ping", "Test")
        env = {k: v for k, v in os.environ.items() if k != "OPENAI_API_KEY"}
        env["ACP_ROOT"] = str(self.root)
        r = sh(self.root, sys.executable, "agents/gepeto/run_openai.py", "--mode", "api", env=env)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("OPENAI_API_KEY", r.stderr)


if __name__ == "__main__":
    unittest.main()
