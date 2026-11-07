#!/usr/bin/env python3
"""ACP - Agent Communication Protocol tool (stdlib only).

Commands:
  new        write a new immutable message (+ event, + views)
  pending    list conversations waiting for an agent (JSON)
  thread     print a thread transcript
  status     append a status event for a thread
  build      regenerate the derived views (inbox/, outbox/, discussions/)
  validate   validate every message file
  guard      check a git range for forbidden changes (history, protected paths, secrets)

Messages are immutable: a message is never edited or deleted. Status changes are
appended to logs/events.jsonl. inbox/, outbox/ and discussions/ are generated views.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import secrets
import subprocess
import sys
from pathlib import Path

ROOT = Path(os.environ.get("ACP_ROOT", Path(__file__).resolve().parent.parent))
CONFIG = json.loads((ROOT / "protocol" / "config.json").read_text(encoding="utf-8"))
MSG_DIR = ROOT / "messages"
EVENTS = ROOT / "logs" / "events.jsonl"
FIELDS = ["id", "thread", "from", "to", "date", "subject", "priority", "type",
          "status", "in_reply_to", "refs", "reply_expected", "requires_adrian", "runtime"]
REQUIRED = ["id", "thread", "from", "to", "date", "subject", "priority", "type", "status"]
ID_RE = re.compile(r"^M-\d{8}T\d{6}Z-[a-z]+-[0-9a-f]{4}$")
SECRET_RE = re.compile(
    r"(sk-ant-[A-Za-z0-9_\-]{20,}|sk-(proj-)?[A-Za-z0-9_\-]{20,}|ghp_[A-Za-z0-9]{30,}|"
    r"github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9\-]{10,}|AKIA[0-9A-Z]{16})")
AGENT_AUTHORS = {a["commit_author"].split(" <")[0] for a in CONFIG["agents"].values() if a["commit_author"]}
BOT_ACTORS = {"github-actions[bot]", "claude[bot]", "chatgpt-codex-connector[bot]"}


# ---------------------------------------------------------------- message I/O
def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def parse_value(raw: str):
    raw = raw.strip()
    if raw in ("true", "false"):
        return raw == "true"
    if raw in ("null", "~", ""):
        return None
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1].strip()
        return [x.strip().strip('"').strip("'") for x in inner.split(",") if x.strip()] if inner else []
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in "\"'":
        return raw[1:-1]
    return raw


def format_value(v) -> str:
    if isinstance(v, bool):
        return "true" if v else "false"
    if v is None:
        return "null"
    if isinstance(v, list):
        return "[" + ", ".join(v) + "]"
    return str(v)


def read_message(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError(f"{path}: missing front matter")
    head, _, body = text[4:].partition("\n---\n")
    meta = {}
    for line in head.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, val = line.partition(":")
        if not sep:
            raise ValueError(f"{path}: bad header line: {line!r}")
        meta[key.strip()] = parse_value(val)
    meta["body"] = body.strip("\n")
    meta["_path"] = str(path.relative_to(ROOT))
    return meta


def all_messages() -> list[dict]:
    msgs = [read_message(p) for p in sorted(MSG_DIR.rglob("M-*.md"))]
    # Same-second messages: the append-only event log gives the true order.
    seq = {ev["id"]: i for i, ev in enumerate(read_events()) if ev.get("event") == "sent"}
    msgs.sort(key=lambda m: (m["date"], seq.get(m["id"], len(seq)), m["id"]))
    return msgs


def read_events() -> list[dict]:
    if not EVENTS.exists():
        return []
    return [json.loads(l) for l in EVENTS.read_text(encoding="utf-8").splitlines() if l.strip()]


def append_event(ev: dict) -> None:
    EVENTS.parent.mkdir(parents=True, exist_ok=True)
    ev = {"ts": now_utc().isoformat().replace("+00:00", "Z"), **ev}
    with EVENTS.open("a", encoding="utf-8") as f:
        f.write(json.dumps(ev, ensure_ascii=False) + "\n")


def thread_status(thread: str, events: list[dict] | None = None) -> str:
    events = read_events() if events is None else events
    st = "open"
    for ev in events:
        if ev.get("event") == "status" and ev.get("thread") == thread:
            st = ev["status"]
    return st


def paused() -> bool:
    return (ROOT / CONFIG["pause_file"]).exists()


def new_message(frm: str, to: str, subject: str, body: str, *, mtype="message", priority="normal",
                in_reply_to: str | None = None, refs=None, reply_expected=True,
                requires_adrian=False, runtime=None, rebuild=True) -> dict:
    if paused() and frm != "adrian":
        raise SystemExit("PAUZĂ activă (protocol/PAUSE): agenții nu scriu mesaje.")
    if frm not in CONFIG["agents"] or to not in CONFIG["agents"]:
        raise SystemExit(f"Agent necunoscut: {frm} -> {to}")
    if "\n" in subject:
        raise SystemExit("Subiectul trebuie să fie pe un singur rând.")
    today = now_utc().date().isoformat()
    sent_today = sum(1 for m in all_messages() if m["from"] == frm and str(m["date"]).startswith(today))
    if frm != "adrian" and sent_today >= CONFIG["limits"]["max_messages_per_agent_per_day"]:
        raise SystemExit(f"Limită zilnică atinsă pentru {frm} ({sent_today}).")
    if len(body) > CONFIG["limits"]["max_body_chars"]:
        raise SystemExit("Mesaj prea lung.")
    if SECRET_RE.search(body) or SECRET_RE.search(subject):
        raise SystemExit("Mesajul pare să conțină o cheie secretă. Refuzat.")
    t = now_utc()
    mid = f"M-{t.strftime('%Y%m%dT%H%M%SZ')}-{frm}-{secrets.token_hex(2)}"
    if in_reply_to:
        parent = find_message(in_reply_to)
        thread = parent["thread"]
    else:
        thread = mid
    meta = {
        "id": mid, "thread": thread, "from": frm, "to": to,
        "date": t.isoformat().replace("+00:00", "Z"), "subject": subject,
        "priority": priority, "type": mtype, "status": "open",
        "in_reply_to": in_reply_to, "refs": refs or [], "reply_expected": reply_expected,
        "requires_adrian": requires_adrian,
        "runtime": runtime or CONFIG["agents"][frm]["runtimes"][0],
    }
    path = MSG_DIR / t.strftime("%Y") / t.strftime("%m") / f"{mid}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    head = "\n".join(f"{k}: {format_value(meta[k])}" for k in FIELDS)
    path.write_text(f"---\n{head}\n---\n\n{body.strip()}\n", encoding="utf-8")
    append_event({"event": "sent", "id": mid, "thread": thread, "by": frm, "to": to, "type": mtype})
    if requires_adrian:
        append_event({"event": "status", "thread": thread, "status": "needs-adrian", "by": frm,
                      "reason": "requires_adrian"})
    if rebuild:
        build_views()
    meta["_path"] = str(path.relative_to(ROOT))
    return meta


def find_message(mid: str) -> dict:
    hits = list(MSG_DIR.rglob(f"{mid}.md"))
    if not hits:
        raise SystemExit(f"Mesaj inexistent: {mid}")
    return read_message(hits[0])


# ---------------------------------------------------------------- queries
def threads() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for m in all_messages():
        out.setdefault(m["thread"], []).append(m)
    return out


def auto_turns(msgs: list[dict]) -> int:
    """Agent messages since the last message written by a human."""
    n = 0
    for m in msgs:
        n = 0 if m["from"] == "adrian" else n + 1
    return n


def pending_for(agent: str) -> list[dict]:
    """Threads whose last message is addressed to `agent` and expects a reply."""
    events = read_events()
    res = []
    for tid, msgs in threads().items():
        last = msgs[-1]
        st = thread_status(tid, events)
        if last["to"] != agent or last["from"] == agent:
            continue
        if not last.get("reply_expected", True) or st in ("closed", "needs-adrian"):
            continue
        item = {"thread": tid, "message": last["id"], "from": last["from"], "subject": last["subject"],
                "priority": last["priority"], "type": last["type"], "path": last["_path"],
                "auto_turns": auto_turns(msgs), "action": "reply"}
        if agent != "adrian" and item["auto_turns"] >= CONFIG["limits"]["max_auto_turns_per_thread"]:
            item["action"] = "escalate"
        res.append(item)
    prio = {p: i for i, p in enumerate(reversed(CONFIG["priorities"]))}
    res.sort(key=lambda x: prio.get(x["priority"], 9))
    return res


def transcript(tid: str, last_n: int | None = None) -> str:
    msgs = threads().get(tid, [])
    if last_n:
        msgs = msgs[-last_n:]
    parts = []
    for m in msgs:
        parts.append(f"### {m['id']}\n- de la: {m['from']} ({m.get('runtime')}) → către: {m['to']}\n"
                     f"- data: {m['date']} · tip: {m['type']} · prioritate: {m['priority']}\n"
                     f"- subiect: {m['subject']}\n- răspuns la: {m.get('in_reply_to') or '—'}\n\n{m['body']}\n")
    return "\n".join(parts)


# ---------------------------------------------------------------- views
def build_views() -> None:
    events = read_events()
    ths = threads()
    gen = "<!-- GENERAT AUTOMAT de tools/acp.py build. Nu edita de mână. -->\n\n"
    (ROOT / "discussions").mkdir(exist_ok=True)
    rows = []
    for tid, msgs in sorted(ths.items(), key=lambda kv: kv[1][-1]["date"], reverse=True):
        st = thread_status(tid, events)
        people = sorted({m["from"] for m in msgs} | {m["to"] for m in msgs})
        rows.append(f"| [{msgs[0]['subject']}]({tid}.md) | {', '.join(people)} | {len(msgs)} | "
                    f"{msgs[-1]['date']} | {st} | {msgs[-1]['to']} |")
        (ROOT / "discussions" / f"{tid}.md").write_text(
            gen + f"# {msgs[0]['subject']}\n\nFir: `{tid}` · stare: **{st}** · mesaje: {len(msgs)}\n\n"
            + transcript(tid), encoding="utf-8")
    (ROOT / "discussions" / "INDEX.md").write_text(
        gen + "# Discuții\n\n| Subiect | Participanți | Mesaje | Ultima activitate | Stare | Așteaptă pe |\n"
        "| --- | --- | --- | --- | --- | --- |\n" + "\n".join(rows) + "\n", encoding="utf-8")
    for agent in CONFIG["agents"]:
        pend = pending_for(agent)
        recv = [m for m in all_messages() if m["to"] == agent][-30:]
        sent = [m for m in all_messages() if m["from"] == agent][-30:]
        lines = [gen + f"# Inbox: {agent}\n", f"## De răspuns ({len(pend)})\n"]
        lines += [f"- [{p['priority']}] {p['subject']} — de la {p['from']} — `{p['message']}`"
                  + (" — **LIMITĂ DE TURE: escaladează la Adrian**" if p["action"] == "escalate" else "")
                  for p in pend] or ["- nimic"]
        lines += ["\n## Primite recent\n"] + [f"- {m['date']} · {m['from']} · {m['subject']} · `{m['id']}`"
                                              for m in reversed(recv)]
        (ROOT / "inbox" / f"{agent}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
        (ROOT / "outbox" / f"{agent}.md").write_text(
            gen + f"# Outbox: {agent}\n\n" + "\n".join(
                f"- {m['date']} · către {m['to']} · {m['subject']} · `{m['id']}`" for m in reversed(sent)) + "\n",
            encoding="utf-8")


# ---------------------------------------------------------------- validation
def validate() -> list[str]:
    errs = []
    ids = set()
    msgs = []
    for p in sorted(MSG_DIR.rglob("*.md")):
        try:
            m = read_message(p)
        except Exception as e:  # noqa: BLE001
            errs.append(str(e))
            continue
        msgs.append(m)
        for k in REQUIRED:
            if m.get(k) in (None, ""):
                errs.append(f"{p.name}: lipsește câmpul {k}")
        if not ID_RE.match(str(m.get("id", ""))) or p.stem != m.get("id"):
            errs.append(f"{p.name}: ID invalid sau diferit de numele fișierului")
        if m.get("from") not in CONFIG["agents"] or m.get("to") not in CONFIG["agents"]:
            errs.append(f"{p.name}: expeditor/destinatar necunoscut")
        if m.get("type") not in CONFIG["types"]:
            errs.append(f"{p.name}: tip necunoscut {m.get('type')}")
        if m.get("priority") not in CONFIG["priorities"]:
            errs.append(f"{p.name}: prioritate necunoscută")
        if not m.get("body"):
            errs.append(f"{p.name}: conținut gol")
        if SECRET_RE.search(m.get("body", "")):
            errs.append(f"{p.name}: conține ceva ce seamănă cu o cheie secretă")
        ids.add(m.get("id"))
    for m in msgs:
        if m.get("in_reply_to") and m["in_reply_to"] not in ids:
            errs.append(f"{m['id']}: răspunde la un mesaj inexistent {m['in_reply_to']}")
        if m.get("thread") not in ids:
            errs.append(f"{m['id']}: fir inexistent {m.get('thread')}")
    return errs


# ---------------------------------------------------------------- guard
def git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(ROOT), *args], check=True, capture_output=True,
                          text=True).stdout


def guard(base: str, head: str, actor: str | None = None) -> list[str]:
    """Forbidden: editing/deleting messages or past log lines, agents touching protected
    paths, removing the pause file by an agent, secrets in added lines."""
    errs: list[str] = []
    zero = set("0")
    if not base or set(base) <= zero:
        base = git("rev-list", "--max-parents=0", head).split()[0]
        first_commit = True
    else:
        first_commit = False
    rng = f"{base}..{head}"
    commits = [l.split("\t") for l in git("log", "--format=%H\t%an", rng).splitlines() if l]
    actor_is_bot = actor in BOT_ACTORS
    for sha, author in commits:
        is_agent = author in AGENT_AUTHORS or actor_is_bot
        for line in git("diff-tree", "--no-commit-id", "-r", "--name-status", "-M", sha).splitlines():
            parts = line.split("\t")
            status, path = parts[0], parts[-1]
            old_path = parts[1] if len(parts) > 2 else path
            for ap in CONFIG["append_only_paths"]:
                if old_path.startswith(ap) and status[0] in "DR":
                    errs.append(f"{sha[:8]} ({author}): {status} pe {old_path} — istoricul nu se șterge/mută")
                if path.startswith(ap) and status[0] == "M":
                    if path == "logs/events.jsonl":
                        old = git("show", f"{sha}^:{path}")
                        new = git("show", f"{sha}:{path}")
                        if not new.startswith(old):
                            errs.append(f"{sha[:8]} ({author}): jurnalul a fost rescris, nu doar completat")
                    else:
                        errs.append(f"{sha[:8]} ({author}): mesaj modificat {path} — mesajele sunt imuabile")
            if path == CONFIG["pause_file"]:
                if status[0] == "D" and is_agent:
                    errs.append(f"{sha[:8]} ({author}): un agent a scos PAUZA — doar Adrian poate")
                continue
            if is_agent and not first_commit and any(path.startswith(pp) or old_path.startswith(pp)
                                                     for pp in CONFIG["protected_paths"]):
                errs.append(f"{sha[:8]} ({author}): agentul a modificat zona protejată {path} — cere aprobarea lui Adrian")
        diff = git("show", "--format=", "--unified=0", sha)
        for l in diff.splitlines():
            if l.startswith("+") and not l.startswith("+++") and SECRET_RE.search(l):
                errs.append(f"{sha[:8]} ({author}): linie adăugată care seamănă cu o cheie secretă")
    return errs


# ---------------------------------------------------------------- CLI
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="acp")
    sub = ap.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("new")
    n.add_argument("--from", dest="frm", required=True)
    n.add_argument("--to", required=True)
    n.add_argument("--subject", required=True)
    n.add_argument("--type", default="message")
    n.add_argument("--priority", default="normal")
    n.add_argument("--reply-to")
    n.add_argument("--refs", default="")
    n.add_argument("--no-reply-expected", action="store_true")
    n.add_argument("--requires-adrian", action="store_true")
    n.add_argument("--runtime")
    g = n.add_mutually_exclusive_group(required=True)
    g.add_argument("--body")
    g.add_argument("--body-file")
    p = sub.add_parser("pending")
    p.add_argument("--agent", required=True)
    t = sub.add_parser("thread")
    t.add_argument("thread")
    s = sub.add_parser("status")
    s.add_argument("thread")
    s.add_argument("status")
    s.add_argument("--by", required=True)
    s.add_argument("--reason", default="")
    sub.add_parser("build")
    sub.add_parser("validate")
    gd = sub.add_parser("guard")
    gd.add_argument("--base", required=True)
    gd.add_argument("--head", default="HEAD")
    gd.add_argument("--actor")
    a = ap.parse_args(argv)

    if a.cmd == "new":
        body = a.body if a.body is not None else Path(a.body_file).read_text(encoding="utf-8")
        m = new_message(a.frm, a.to, a.subject, body, mtype=a.type, priority=a.priority,
                        in_reply_to=a.reply_to, refs=[r for r in a.refs.split(",") if r],
                        reply_expected=not a.no_reply_expected, requires_adrian=a.requires_adrian,
                        runtime=a.runtime)
        print(json.dumps({"id": m["id"], "thread": m["thread"], "path": m["_path"]}, ensure_ascii=False))
    elif a.cmd == "pending":
        print(json.dumps({"paused": paused(), "items": [] if paused() else pending_for(a.agent)},
                         ensure_ascii=False, indent=2))
    elif a.cmd == "thread":
        print(transcript(a.thread))
    elif a.cmd == "status":
        if a.status not in CONFIG["statuses"]:
            raise SystemExit(f"Stare necunoscută: {a.status}")
        append_event({"event": "status", "thread": a.thread, "status": a.status, "by": a.by, "reason": a.reason})
        build_views()
    elif a.cmd == "build":
        build_views()
    elif a.cmd == "validate":
        errs = validate()
        print("\n".join(errs) if errs else "OK: toate mesajele sunt valide")
        return 1 if errs else 0
    elif a.cmd == "guard":
        errs = guard(a.base, a.head, a.actor)
        print("\n".join(errs) if errs else "OK: niciun istoric șters, nicio zonă protejată atinsă de agenți, niciun secret")
        return 1 if errs else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
