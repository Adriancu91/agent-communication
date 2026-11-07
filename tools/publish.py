#!/usr/bin/env python3
"""Publish an agent bundle to main. Runs in the publish job, from a copy of tools/ and protocol/config.json
taken from main BEFORE anything produced by the AI job is touched. No model runs here.

Steps: apply bundle (new files + appended lines only, allowed paths only) -> rebuild views -> commit ->
validate -> guard (identity of the pusher) -> push. On a push race: fetch, reset to the new main,
re-apply the same bundle (idempotent), retry. If the content is refused, only the cost-ledger lines are
published, so no API spend goes unrecorded, and the job fails.

Usage: publish.py --agent gepeto --bundle bundle.json --actor <github login of the pushing identity>
       (token in env PUBLISH_TOKEN, repo in env REPO)
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import acp  # noqa: E402  (the trusted copy next to this file)


def sh(*args, check=True) -> str:
    return subprocess.run(list(args), cwd=acp.ROOT, check=check, capture_output=True, text=True).stdout.strip()


def remote() -> str:
    if os.environ.get("PUBLISH_REMOTE"):  # tests only: a local bare repository
        return os.environ["PUBLISH_REMOTE"]
    return f"https://x-access-token:{os.environ['PUBLISH_TOKEN']}@github.com/{os.environ['REPO']}.git"


def sync_main() -> str:
    sh("git", "fetch", "-q", remote(), "main")
    sh("git", "reset", "-q", "--hard", "FETCH_HEAD")
    sh("git", "clean", "-qfd")
    return sh("git", "rev-parse", "HEAD")


def commit(agent: str, msg: str) -> bool:
    acp.build_views()
    sh("git", "add", "-A")
    if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=acp.ROOT).returncode == 0:
        return False
    sh("git", "-c", f"user.name={agent}-agent", "-c", f"user.email={agent}-agent@users.noreply.github.com",
       "commit", "-q", "-m", msg)
    return True


def checks(base: str, actor: str) -> list[str]:
    errs = acp.validate()
    gerrs, _ = acp.guard(base, "HEAD", default={"actor": actor, "type": "push"}, mode="prepush")
    return errs + gerrs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--agent", required=True)
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--actor", required=True)
    a = ap.parse_args()
    principal = acp.CONFIG["identities"].get(a.actor)
    if principal is None:
        print(f"EROARE: identitatea {a.actor} nu e în config", file=sys.stderr)
        return 1
    bundle = json.loads(Path(a.bundle).read_text(encoding="utf-8"))
    for attempt in range(3):
        base = sync_main()
        refused = acp.apply_bundle(bundle, principal)
        if refused:
            break
        if not commit(a.agent, f"{a.agent}: răspuns automat"):
            print("Nimic nou de publicat.")
            return 0
        errs = checks(base, a.actor)
        if errs:
            refused = errs
            break
        if subprocess.run(["git", "push", "-q", remote(), "HEAD:main"], cwd=acp.ROOT,
                          capture_output=True).returncode == 0:
            print(json.dumps({"published": sh("git", "rev-parse", "HEAD"), "as": a.actor, "principal": principal}))
            return 0
        print(f"Push refuzat (încercarea {attempt + 1}); reiau pe main actualizat.")
    else:
        print("EROARE: push eșuat de 3 ori", file=sys.stderr)
        return 1

    print("RESPINS de verificările de publicare:", file=sys.stderr)
    for r in refused:
        print(f"  - {r}", file=sys.stderr)
    # Keep the cost ledger complete even when the content is refused.
    base = sync_main()
    if not acp.apply_bundle(bundle, principal, only=("logs/usage.jsonl",)) and \
            commit(a.agent, "costuri: consum înregistrat (răspuns respins la publicare)") and \
            not checks(base, a.actor):
        subprocess.run(["git", "push", "-q", remote(), "HEAD:main"], cwd=acp.ROOT, capture_output=True)
        print("Doar jurnalul de costuri a fost publicat.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
