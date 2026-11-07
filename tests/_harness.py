"""Shared test harness: a throw-away copy of the repository with its own git history."""
import importlib
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SRC = Path(__file__).resolve().parents[1]
IGNORE = shutil.ignore_patterns(".git", "messages", "discussions", "inbox", "outbox", "__pycache__",
                                "*.jsonl", "proposals", "PAUSE", "costs")


def sh(cwd, *args, env=None, check=False):
    return subprocess.run(list(args), cwd=cwd, capture_output=True, text=True, env=env, check=check)


class RepoCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.root = self.tmp / "r"
        shutil.copytree(SRC, self.root, ignore=IGNORE)
        (self.root / "messages").mkdir(exist_ok=True)
        (self.root / "messages" / ".gitkeep").write_text("")
        self._env = {k: os.environ.get(k) for k in ("ACP_ROOT", "ACP_CONFIG", "ACP_AGENT")}
        os.environ["ACP_ROOT"] = str(self.root)
        os.environ["ACP_CONFIG"] = str(self.root / "protocol" / "config.json")
        os.environ.pop("ACP_AGENT", None)
        for p in (str(self.root / "tools"), str(self.root / "agents" / "gepeto")):
            sys.path.insert(0, p)
        import acp
        self.acp = importlib.reload(acp)
        sh(self.root, "git", "init", "-q", "-b", "main")
        sh(self.root, "git", "config", "user.email", "t@t.t")
        sh(self.root, "git", "config", "user.name", "Test")
        self.commit("init")
        self.root_sha = self.head()

    def tearDown(self):
        for p in (str(self.root / "tools"), str(self.root / "agents" / "gepeto")):
            while p in sys.path:
                sys.path.remove(p)
        for k, v in self._env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        shutil.rmtree(self.tmp)

    # helpers
    def runner(self):
        import run_auto
        return importlib.reload(run_auto)

    def head(self):
        return sh(self.root, "git", "rev-parse", "HEAD").stdout.strip()

    def commit(self, msg="x", author="Test"):
        sh(self.root, "git", "add", "-A")
        sh(self.root, "git", "-c", f"user.name={author}", "commit", "-q", "--allow-empty", "-m", msg)
        return self.head()

    def guard(self, base, actor, kind="push", mode="push"):
        errs, warns = self.acp.guard(base, self.head(), default={"actor": actor, "type": kind}, mode=mode)
        return errs

    def write(self, rel, text):
        p = self.root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")


GEPETO_BOT = "gepeto-agent-adriancu91[bot]"
CLAUDIU_BOT = "claudiu-agent-adriancu91[bot]"
ACTIONS_BOT = "github-actions[bot]"
ADRIAN = "Adriancu91"
