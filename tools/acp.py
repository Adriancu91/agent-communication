#!/usr/bin/env python3
"""ACP - Agent Communication Protocol tool, v1.1 (stdlib only).

Commands:
  new        write a new immutable message (+ event, + views)
  pending    conversations waiting for an agent (JSON)
  thread     print a thread transcript
  status     append a status event for a thread
  build      regenerate the derived views (inbox/, outbox/, discussions/)
  validate   validate every message (fields, threads, duplicates, corrections, secrets)
  guard      check a git range: who really pushed each commit, what they changed
  costs      monthly OpenAI cost report from logs/usage.jsonl

Trust model: the author name written in a commit proves nothing. The guard takes the identity
of whoever pushed a commit from GitHub's activity log (or, before a push, from the publishing
job that knows its own identity) and checks it against protocol/config.json.
"""
from __future__ import annotations

import argparse
import datetime as dt
import fnmatch
import json
import os
import re
import secrets
import subprocess
import sys
from pathlib import Path

ROOT = Path(os.environ.get("ACP_ROOT", Path(__file__).resolve().parent.parent))
CONFIG_PATH = Path(os.environ.get("ACP_CONFIG", ROOT / "protocol" / "config.json"))
CONFIG = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
MSG_DIR = ROOT / "messages"
EVENTS = ROOT / "logs" / "events.jsonl"
USAGE = ROOT / "logs" / "usage.jsonl"
FIELDS = ["id", "thread", "from", "to", "date", "subject", "priority", "type", "status", "in_reply_to",
          "supersedes", "refs", "reply_expected", "requires_adrian", "runtime"]
REQUIRED = ["id", "thread", "from", "to", "date", "subject", "priority", "type", "status", "runtime"]
ID_RE = re.compile(r"^M-\d{8}T\d{6}Z-[a-z]+-[0-9a-f]{4}$")
SECRET_RE = re.compile(
    r"(sk-ant-[A-Za-z0-9_\-]{20,}|sk-(proj-|svcacct-|admin-)?[A-Za-z0-9_\-]{20,}|ghp_[A-Za-z0-9]{30,}|"
    r"ghs_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9\-]{10,}|"
    r"AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)")
ZERO = "0" * 40
AGENTS_WITH_LIMITS = {"gepeto", "claudiu"}


class Refused(SystemExit):
    """A message the protocol refuses to write."""


# ---------------------------------------------------------------- helpers
def now_utc() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0)


def iso(t: dt.datetime) -> str:
    return t.isoformat().replace("+00:00", "Z")


def path_matches(path: str, prefixes) -> bool:
    for p in prefixes:
        if p == "*" or path == p or (p.endswith("/") and path.startswith(p)) or \
                (not p.endswith("/") and path.startswith(p) and "/" not in path[len(p):]):
            return True
    return False


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


def parse_message_text(text: str, name: str = "?") -> dict:
    if not text.startswith("---\n"):
        raise ValueError(f"{name}: lipsește antetul")
    head, sep, body = text[4:].partition("\n---\n")
    if not sep:
        raise ValueError(f"{name}: antet neînchis")
    meta = {}
    for line in head.splitlines():
        if not line.strip():
            continue
        key, sep, val = line.partition(":")
        if not sep:
            raise ValueError(f"{name}: linie de antet invalidă")
        meta[key.strip()] = parse_value(val)
    meta["body"] = body.strip("\n")
    return meta


def read_message(path: Path) -> dict:
    meta = parse_message_text(path.read_text(encoding="utf-8"), path.name)
    meta["_path"] = str(path.relative_to(ROOT))
    return meta


def read_jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]


def read_events() -> list[dict]:
    return read_jsonl(EVENTS)


def append_jsonl(p: Path, obj: dict) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")


def append_event(ev: dict) -> None:
    append_jsonl(EVENTS, {"ts": iso(now_utc()), **ev})


def all_messages() -> list[dict]:
    msgs = [read_message(p) for p in sorted(MSG_DIR.rglob("M-*.md"))]
    seq = {ev["id"]: i for i, ev in enumerate(read_events()) if ev.get("event") == "sent"}
    msgs.sort(key=lambda m: (m["date"], seq.get(m["id"], len(seq)), m["id"]))
    return msgs


def superseded_map(msgs) -> dict[str, str]:
    return {m["supersedes"]: m["id"] for m in msgs if m.get("supersedes")}


def thread_status(thread: str, events=None) -> str:
    st = "open"
    for ev in read_events() if events is None else events:
        if ev.get("event") == "status" and ev.get("thread") == thread:
            st = ev["status"]
    return st


def paused() -> bool:
    return (ROOT / CONFIG["pause_file"]).exists()


def runtime_ok(frm: str, runtime: str) -> bool:
    return any(runtime == r or runtime.startswith(r + ":") or runtime.startswith(r)
               for r in CONFIG["agents"][frm]["runtimes"])


def find_message(mid: str) -> dict:
    hits = list(MSG_DIR.rglob(f"{mid}.md"))
    if not hits:
        raise Refused(f"Mesaj inexistent: {mid}")
    return read_message(hits[0])


# ---------------------------------------------------------------- writing
def new_message(frm: str, to: str, subject: str, body: str, *, mtype="message", priority="normal",
                in_reply_to=None, supersedes=None, refs=None, reply_expected=True,
                requires_adrian=False, runtime=None, rebuild=True) -> dict:
    """Write one immutable message. Raises Refused when the protocol forbids it."""
    acting = os.environ.get("ACP_AGENT")
    if acting and frm != acting:
        raise Refused(f"Identitate refuzată: acest proces scrie doar ca '{acting}', nu ca '{frm}'.")
    if paused() and frm != "adrian":
        raise Refused("PAUZĂ activă (protocol/PAUSE): agenții nu scriu mesaje.")
    if frm not in CONFIG["agents"] or to not in CONFIG["agents"]:
        raise Refused(f"Agent necunoscut: {frm} -> {to}")
    runtime = runtime or CONFIG["agents"][frm]["runtimes"][0]
    if not runtime_ok(frm, runtime):
        raise Refused(f"Runtime nepermis pentru {frm}: {runtime}")
    if mtype not in CONFIG["types"] or priority not in CONFIG["priorities"]:
        raise Refused("Tip sau prioritate necunoscută.")
    if "\n" in subject or "\r" in subject or not subject.strip():
        raise Refused("Subiectul trebuie să fie un singur rând, negol.")
    if len(body) > CONFIG["limits"]["max_body_chars"] or not body.strip():
        raise Refused("Mesaj gol sau prea lung.")
    if SECRET_RE.search(body) or SECRET_RE.search(subject):
        raise Refused("Mesajul pare să conțină o cheie secretă. Refuzat.")
    msgs = all_messages()
    if supersedes:
        old = find_message(supersedes)
        if old["from"] != frm or mtype != "correction":
            raise Refused("O corectură (type: correction) poate înlocui doar un mesaj al aceluiași autor.")
    if in_reply_to and not supersedes:
        if any(m["from"] == frm and m.get("in_reply_to") == in_reply_to and not m.get("supersedes") for m in msgs):
            raise Refused(f"Răspuns duplicat: {frm} a răspuns deja la {in_reply_to}.")
    today = iso(now_utc())[:10]
    if frm in AGENTS_WITH_LIMITS:
        sent_today = sum(1 for m in msgs if m["from"] == frm and str(m["date"]).startswith(today))
        if sent_today >= CONFIG["limits"]["max_messages_per_agent_per_day"]:
            raise Refused(f"Limită zilnică atinsă pentru {frm} ({sent_today}).")
    sentinel = None
    if frm in AGENTS_WITH_LIMITS:
        low = (subject + "\n" + body).lower()
        if frm == "gepeto" and mtype == "decision" and runtime.startswith("openai-api"):
            sentinel = "decizie strategică a lui Gepeto-API (G3: definitivă doar cu Adrian)"
        elif mtype in ("decision", "task", "decision-request"):
            hit = next((w for w in CONFIG["r3_action_words"] if w in low), None)
            if hit:
                sentinel = f"acțiune care cere aprobare (cuvânt: „{hit}”)"
        if sentinel:
            requires_adrian = True
    t = now_utc()
    mid = f"M-{t.strftime('%Y%m%dT%H%M%SZ')}-{frm}-{secrets.token_hex(2)}"
    thread = find_message(in_reply_to)["thread"] if in_reply_to else (
        find_message(supersedes)["thread"] if supersedes else mid)
    meta = {"id": mid, "thread": thread, "from": frm, "to": to, "date": iso(t), "subject": subject.strip(),
            "priority": priority, "type": mtype, "status": "open", "in_reply_to": in_reply_to,
            "supersedes": supersedes, "refs": refs or [], "reply_expected": reply_expected,
            "requires_adrian": requires_adrian, "runtime": runtime}
    path = MSG_DIR / t.strftime("%Y") / t.strftime("%m") / f"{mid}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    head = "\n".join(f"{k}: {format_value(meta[k])}" for k in FIELDS)
    path.write_text(f"---\n{head}\n---\n\n{body.strip()}\n", encoding="utf-8")
    append_event({"event": "sent", "id": mid, "thread": thread, "by": frm, "to": to, "type": mtype})
    if requires_adrian:
        append_event({"event": "status", "thread": thread, "status": "needs-adrian", "by": frm,
                      "reason": sentinel or "requires_adrian"})
    if rebuild:
        build_views()
    meta["_path"] = str(path.relative_to(ROOT))
    meta["_sentinel"] = sentinel
    return meta


# ---------------------------------------------------------------- queries
def threads() -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for m in all_messages():
        out.setdefault(m["thread"], []).append(m)
    return out


def auto_turns(msgs) -> int:
    n = 0
    for m in msgs:
        n = 0 if m["from"] == "adrian" else n + 1
    return n


def pending_for(agent: str) -> list[dict]:
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
    sup = superseded_map(msgs)
    if last_n:
        msgs = msgs[-last_n:]
    parts = []
    for m in msgs:
        note = f"\n- **înlocuit de** `{sup[m['id']]}`" if m["id"] in sup else ""
        corr = f"\n- corectează: `{m['supersedes']}`" if m.get("supersedes") else ""
        parts.append(f"### {m['id']}\n- de la: {m['from']} ({m.get('runtime')}) → către: {m['to']}\n"
                     f"- data: {m['date']} · tip: {m['type']} · prioritate: {m['priority']}\n"
                     f"- subiect: {m['subject']}\n- răspuns la: {m.get('in_reply_to') or '—'}{corr}{note}\n\n"
                     f"{m['body']}\n")
    return "\n".join(parts)


# ---------------------------------------------------------------- views
def build_views() -> None:
    events = read_events()
    ths = threads()
    msgs_all = all_messages()
    gen = "<!-- GENERAT AUTOMAT de tools/acp.py build. Nu edita de mână. -->\n\n"
    (ROOT / "discussions").mkdir(exist_ok=True)
    rows = []
    for tid, msgs in sorted(ths.items(), key=lambda kv: kv[1][-1]["date"], reverse=True):
        st = thread_status(tid, events)
        people = sorted({m["from"] for m in msgs} | {m["to"] for m in msgs})
        waiting = "—" if st == "closed" else ("adrian" if st == "needs-adrian" else msgs[-1]["to"])
        rows.append(f"| [{msgs[0]['subject']}]({tid}.md) | {', '.join(people)} | {len(msgs)} | "
                    f"{msgs[-1]['date']} | {st} | {waiting} |")
        (ROOT / "discussions" / f"{tid}.md").write_text(
            gen + f"# {msgs[0]['subject']}\n\nFir: `{tid}` · stare: **{st}** · mesaje: {len(msgs)}\n\n"
            + transcript(tid), encoding="utf-8")
    (ROOT / "discussions" / "INDEX.md").write_text(
        gen + "# Discuții\n\n| Subiect | Participanți | Mesaje | Ultima activitate | Stare | Așteaptă pe |\n"
        "| --- | --- | --- | --- | --- | --- |\n" + "\n".join(rows) + "\n", encoding="utf-8")
    for d in ("inbox", "outbox"):
        (ROOT / d).mkdir(exist_ok=True)
    needs = [tid for tid in ths if thread_status(tid, events) == "needs-adrian"]
    for agent in CONFIG["agents"]:
        pend = pending_for(agent)
        recv = [m for m in msgs_all if m["to"] == agent][-30:]
        sent = [m for m in msgs_all if m["from"] == agent][-30:]
        lines = [gen + f"# Inbox: {agent}\n", f"## De răspuns ({len(pend)})\n"]
        lines += [f"- [{p['priority']}] {p['subject']} — de la {p['from']} — `{p['message']}`"
                  + (" — **LIMITĂ DE TURE: escaladează la Adrian**" if p["action"] == "escalate" else "")
                  for p in pend] or ["- nimic"]
        if agent == "adrian":
            lines += ["\n## Fire oprite până aprobi tu (needs-adrian)\n"] + (
                [f"- {ths[t][0]['subject']} — `{t}`" for t in needs] or ["- nimic"])
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
        elif m.get("runtime") and not runtime_ok(m["from"], str(m["runtime"])):
            errs.append(f"{p.name}: runtime nepermis pentru {m['from']}")
        if m.get("type") not in CONFIG["types"]:
            errs.append(f"{p.name}: tip necunoscut {m.get('type')}")
        if m.get("priority") not in CONFIG["priorities"]:
            errs.append(f"{p.name}: prioritate necunoscută")
        if not m.get("body"):
            errs.append(f"{p.name}: conținut gol")
        if SECRET_RE.search(m.get("body", "")) or SECRET_RE.search(str(m.get("subject", ""))):
            errs.append(f"{p.name}: conține ceva ce seamănă cu o cheie secretă")
    byid = {m.get("id"): m for m in msgs}
    seen = {}
    for m in msgs:
        if m.get("in_reply_to") and m["in_reply_to"] not in byid:
            errs.append(f"{m['id']}: răspunde la un mesaj inexistent")
        if m.get("thread") not in byid:
            errs.append(f"{m['id']}: fir inexistent")
        if m.get("supersedes"):
            old = byid.get(m["supersedes"])
            if not old or old["from"] != m["from"] or m["type"] != "correction":
                errs.append(f"{m['id']}: corectură invalidă (doar propriul mesaj, type: correction)")
        elif m.get("in_reply_to"):
            key = (m["from"], m["in_reply_to"])
            if key in seen:
                errs.append(f"{m['id']}: răspuns duplicat al lui {m['from']} la {m['in_reply_to']} (primul: {seen[key]})")
            seen[key] = m["id"]
    return errs


# ---------------------------------------------------------------- guard
def git(*args: str) -> str:
    return subprocess.run(["git", "-C", str(ROOT), *args], check=True, capture_output=True,
                          text=True).stdout


def attribution_from_activity(activities: list[dict], ref: str = "refs/heads/main"):
    """Map commit SHA -> {actor, type} from GitHub's repository activity log (server-side record
    of who pushed). Returns (mapping, errors)."""
    mapping, errs = {}, []
    for a in sorted(activities, key=lambda x: x.get("timestamp", "")):
        if a.get("ref") != ref:
            continue
        actor = (a.get("actor") or {}).get("login", "?")
        kind = a.get("activity_type")
        if kind in ("force_push", "branch_deletion"):
            errs.append(f"{a.get('timestamp')}: {kind} pe {ref} de {actor} — istoricul a fost rescris/șters")
            continue
        after, before = a.get("after", ZERO), a.get("before", ZERO)
        if after == ZERO:
            continue
        try:
            shas = git("rev-list", after if before == ZERO else f"{before}..{after}").split()
        except subprocess.CalledProcessError:
            continue
        for s in shas:
            mapping.setdefault(s, {"actor": actor, "type": kind})
    return mapping, errs


def _show(sha: str, path: str) -> str:
    try:
        return git("show", f"{sha}:{path}")
    except subprocess.CalledProcessError:
        return ""


def guard(base: str, head: str, *, attribution: dict | None = None, default: dict | None = None,
          mode: str = "push") -> tuple[list[str], list[str]]:
    """Return (errors, warnings) for commits in base..head.
    mode: push | audit (actual pushes), pr (proposal, Adrian decides at merge), prepush (publishing job)."""
    errs, warns = [], []
    first = False
    if not base or base == ZERO:
        base = git("rev-list", "--max-parents=0", head).split()[0]
        first = True
    commits = [l for l in git("rev-list", "--reverse", f"{base}..{head}").splitlines() if l]
    ids, principals = CONFIG["identities"], CONFIG["principals"]
    pause = CONFIG["pause_file"]
    for sha in commits:
        att = (attribution or {}).get(sha) or default or {}
        actor, kind = att.get("actor", "?"), att.get("type", "push")
        who = ids.get(actor)
        tag = f"{sha[:8]} ({actor})"
        if who is None:
            errs.append(f"{tag}: identitate necunoscută — nimeni din config nu urcă astfel")
            continue
        rules = principals[who]
        parents = git("rev-list", "--parents", "-n", "1", sha).split()[1:]
        if len(parents) > 1:
            continue  # merge commits: their content is checked through the merged commits
        for line in git("diff-tree", "--no-commit-id", "-r", "--name-status", "-M", sha).splitlines():
            parts = line.split("\t")
            st, path = parts[0][0], parts[-1]
            old = parts[1] if len(parts) > 2 else path
            for pth in {old, path}:
                if path_matches(pth, CONFIG["immutable_paths"]) and st in "MDR":
                    errs.append(f"{tag}: {st} pe {pth} — mesajele, deciziile și costurile nu se modifică, nu se șterg")
            if path in CONFIG["append_only_files"]:
                if st == "D":
                    errs.append(f"{tag}: jurnalul {path} a fost șters")
                elif st == "M" and not _show(sha, path).startswith(_show(f"{sha}^", path)):
                    errs.append(f"{tag}: jurnalul {path} a fost rescris, nu doar completat")
            if path == pause:
                if st != "A" and who != "adrian":
                    errs.append(f"{tag}: doar Adrian scoate sau schimbă pauza")
                continue
            if path_matches(path, CONFIG["protected_paths"]) or path_matches(old, CONFIG["protected_paths"]):
                if who == "adrian" and kind == "pr_merge":
                    pass
                elif mode == "pr" and not first:
                    warns.append(f"{tag}: schimbă zona protejată {path} — intră doar dacă Adrian îmbină PR-ul")
                else:
                    errs.append(f"{tag}: {who} a schimbat zona protejată {path} fără PR îmbinat de Adrian")
                continue
            if path_matches(path, CONFIG["owner_only_paths"]) and who != "adrian":
                errs.append(f"{tag}: {who} a scris în {path}, rezervat lui Adrian")
                continue
            if not path_matches(path, rules["write"]):
                errs.append(f"{tag}: {who} nu are voie să scrie în {path}")
                continue
            if st == "A" and path.startswith("messages/") and path.endswith(".md"):
                try:
                    m = parse_message_text(_show(sha, path), path)
                except ValueError as e:
                    errs.append(f"{tag}: {e}")
                    continue
                ok = any(m.get("from") == r["from"] and any(str(m.get("runtime", "")).startswith(p)
                                                            for p in r["runtime_prefix"])
                         for r in rules["may_write_as"])
                if not ok:
                    errs.append(f"{tag}: {who} a scris un mesaj ca '{m.get('from')}' ({m.get('runtime')}) — uzurpare de identitate")
        diff = git("show", "--format=", "--unified=0", sha)
        for l in diff.splitlines():
            if l.startswith("+") and not l.startswith("+++") and SECRET_RE.search(l):
                errs.append(f"{tag}: linie adăugată care seamănă cu o cheie secretă")
                break
    return errs, warns


# ---------------------------------------------------------------- bundles (think job -> publish job)
VIEW_DIRS = ("inbox/", "outbox/", "discussions/")


def make_bundle() -> dict:
    """Describe what an agent run produced, relative to HEAD: new files and appended lines only.
    Views are dropped (the publisher regenerates them). Anything else is listed as rejected."""
    out = {"new": {}, "append": {}, "rejected": []}
    status = git("status", "--porcelain=v1", "-z", "--untracked-files=all").split("\0")
    i = 0
    while i < len(status):
        entry = status[i]
        i += 1
        if not entry:
            continue
        code, path = entry[:2], entry[3:]
        if code[0] == "R" or code[1] == "R":
            out["rejected"].append({"path": path, "why": "redenumire"})
            i += 1
            continue
        if path.startswith(VIEW_DIRS):
            continue
        p = ROOT / path
        if "D" in code:
            out["rejected"].append({"path": path, "why": "ștergere"})
        elif code in ("??", "A ", "AM"):
            out["new"][path] = p.read_text(encoding="utf-8")
        else:
            old, new = _show("HEAD", path), p.read_text(encoding="utf-8")
            if new.startswith(old):
                out["append"][path] = new[len(old):]
            else:
                out["rejected"].append({"path": path, "why": "modificare (doar adăugarea la final e permisă)"})
    return out


def apply_bundle(bundle: dict, principal: str, only: tuple[str, ...] | None = None) -> list[str]:
    """Apply a bundle on the current tree. Only creates new files and appends lines, and only in paths
    the principal may write. Returns the reasons for anything refused (empty = all applied)."""
    rules = CONFIG["principals"][principal]
    refused = [] if only else [f"{r['path']}: {r['why']}" for r in bundle.get("rejected", [])]
    for path, content in bundle.get("new", {}).items():
        if only and not path_matches(path, only):
            continue
        if ".." in Path(path).parts or path.startswith("/"):
            refused.append(f"{path}: cale invalidă")
            continue
        if path_matches(path, CONFIG["protected_paths"]) and path != CONFIG["pause_file"]:
            refused.append(f"{path}: zonă protejată")
            continue
        if path_matches(path, CONFIG["owner_only_paths"]) and principal != "adrian":
            refused.append(f"{path}: rezervat lui Adrian")
            continue
        if not path_matches(path, rules["write"]):
            refused.append(f"{path}: {principal} nu are voie să scrie aici")
            continue
        f = ROOT / path
        if f.exists():
            if f.read_text(encoding="utf-8") != content:
                refused.append(f"{path}: există deja cu alt conținut")
            continue
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(content, encoding="utf-8")
    for path, extra in bundle.get("append", {}).items():
        if only and not path_matches(path, only):
            continue
        if path_matches(path, CONFIG["immutable_paths"]) or path_matches(path, CONFIG["protected_paths"]) \
                or (path_matches(path, CONFIG["owner_only_paths"]) and principal != "adrian") \
                or not path_matches(path, rules["write"]):
            refused.append(f"{path}: adăugare nepermisă")
            continue
        f = ROOT / path
        cur = f.read_text(encoding="utf-8") if f.exists() else ""
        if extra and not cur.endswith(extra):
            if cur and not cur.endswith("\n"):
                cur += "\n"
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_text(cur + extra, encoding="utf-8")
    return refused


# ---------------------------------------------------------------- costs
def month_usage(month: str) -> dict:
    entries = [u for u in read_jsonl(USAGE) if str(u.get("ts", "")).startswith(month)]
    done = {u["call_id"] for u in entries if u.get("kind") in ("actual", "release")}
    actual = [u for u in entries if u.get("kind") == "actual"]
    open_by_call: dict[str, dict] = {}
    for u in entries:
        if u.get("kind") in ("reservation", "failed") and u["call_id"] not in done:
            if u["call_id"] not in open_by_call or u["cost_usd"] > open_by_call[u["call_id"]]["cost_usd"]:
                open_by_call[u["call_id"]] = u
    open_res = list(open_by_call.values())
    total = sum(u["cost_usd"] for u in actual) + sum(u["cost_usd"] for u in open_res)
    return {"actual": actual, "open": open_res, "total": round(total, 6)}


def costs_report(month: str) -> str:
    u = month_usage(month)
    budget = CONFIG["limits"]["openai_monthly_budget_usd"]
    by_model: dict[str, list] = {}
    for e in u["actual"]:
        by_model.setdefault(e["model"], []).append(e)
    lines = [f"# Costuri OpenAI — {month}", "",
             f"- Total înregistrat: **{u['total']:.4f} USD** din bugetul de {budget} USD "
             f"({100 * u['total'] / budget:.1f}%)",
             f"- Apeluri reușite: {len(u['actual'])}; rezervări fără rezultat (numărate la cost maxim): {len(u['open'])}",
             "", "| Model | Apeluri | Tokeni intrare | Tokeni ieșire | Cost (USD) |", "| --- | --- | --- | --- | --- |"]
    for model, es in sorted(by_model.items()):
        lines.append(f"| {model} | {len(es)} | {sum(e.get('input_tokens', 0) for e in es)} | "
                     f"{sum(e.get('output_tokens', 0) for e in es)} | {sum(e['cost_usd'] for e in es):.4f} |")
    lines += ["", "Atenție: limita din cod oprește Gepeto-API înainte de buget, dar nu e o garanție absolută "
              "(prețuri schimbate, apeluri întrerupte, erori). Plafonul real e limita de cheltuieli setată în contul OpenAI. "
              "Compară cu pagina Usage din contul OpenAI."]
    return "\n".join(lines) + "\n"


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
    n.add_argument("--supersedes")
    n.add_argument("--refs", default="")
    n.add_argument("--no-reply-expected", action="store_true")
    n.add_argument("--requires-adrian", action="store_true")
    n.add_argument("--runtime")
    g = n.add_mutually_exclusive_group(required=True)
    g.add_argument("--body")
    g.add_argument("--body-file")
    sub.add_parser("pending").add_argument("--agent", required=True)
    sub.add_parser("thread").add_argument("thread")
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
    gd.add_argument("--mode", choices=["push", "pr", "prepush", "audit"], default="push")
    gd.add_argument("--activity-file", help="JSON from GET /repos/{owner}/{repo}/activity")
    gd.add_argument("--actor", help="identity to assume for commits not found in the activity log")
    gd.add_argument("--activity-type", default="push")
    sub.add_parser("bundle").add_argument("--out", required=True)
    c = sub.add_parser("costs")
    c.add_argument("--month", default=iso(now_utc())[:7])
    c.add_argument("--write", action="store_true")
    a = ap.parse_args(argv)

    try:
        if a.cmd == "new":
            if a.body is not None:
                body = a.body
            else:
                bf = Path(a.body_file).resolve()
                allowed = [ROOT.resolve(), Path("/tmp").resolve()] + (
                    [Path(os.environ["RUNNER_TEMP"]).resolve()] if os.environ.get("RUNNER_TEMP") else [])
                if os.environ.get("ACP_AGENT") and not any(bf.is_relative_to(d) for d in allowed):
                    raise Refused("Fișierul de conținut trebuie să fie în repository sau într-un dosar temporar.")
                body = bf.read_text(encoding="utf-8")
            m = new_message(a.frm, a.to, a.subject, body, mtype=a.type, priority=a.priority,
                            in_reply_to=a.reply_to, supersedes=a.supersedes,
                            refs=[r for r in a.refs.split(",") if r], reply_expected=not a.no_reply_expected,
                            requires_adrian=a.requires_adrian, runtime=a.runtime)
            print(json.dumps({"id": m["id"], "thread": m["thread"], "path": m["_path"],
                              "requires_adrian": m["requires_adrian"], "sentinel": m["_sentinel"]}, ensure_ascii=False))
        elif a.cmd == "pending":
            print(json.dumps({"paused": paused(), "items": [] if paused() else pending_for(a.agent)},
                             ensure_ascii=False, indent=2))
        elif a.cmd == "thread":
            print(transcript(a.thread))
        elif a.cmd == "status":
            if a.status not in CONFIG["statuses"]:
                raise Refused(f"Stare necunoscută: {a.status}")
            acting = os.environ.get("ACP_AGENT")
            if acting and a.by != acting:
                raise Refused("Identitate refuzată.")
            append_event({"event": "status", "thread": a.thread, "status": a.status, "by": a.by, "reason": a.reason})
            build_views()
        elif a.cmd == "build":
            build_views()
        elif a.cmd == "validate":
            errs = validate()
            print("\n".join(errs) if errs else "OK: toate mesajele sunt valide")
            return 1 if errs else 0
        elif a.cmd == "guard":
            att, aerrs = None, []
            if a.activity_file:
                att, aerrs = attribution_from_activity(json.loads(Path(a.activity_file).read_text()))
            default = {"actor": a.actor, "type": a.activity_type} if a.actor else None
            errs, warns = guard(a.base, a.head, attribution=att, default=default, mode=a.mode)
            errs = aerrs + errs
            for w in warns:
                print("AVERTISMENT:", w)
            print("\n".join("EROARE: " + e for e in errs) if errs else
                  "OK: identități verificate, istoric neatins, zone protejate respectate, niciun secret")
            return 1 if errs else 0
        elif a.cmd == "bundle":
            b = make_bundle()
            Path(a.out).write_text(json.dumps(b, ensure_ascii=False), encoding="utf-8")
            print(json.dumps({"new": sorted(b["new"]), "append": sorted(b["append"]), "rejected": b["rejected"]},
                             ensure_ascii=False))
            return 0 if (b["new"] or b["append"] or b["rejected"]) else 3
        elif a.cmd == "costs":
            rep = costs_report(a.month)
            if a.write:
                p = ROOT / "logs" / "costs" / f"{a.month}.md"
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_text(rep, encoding="utf-8")
            print(rep)
    except Refused as e:
        print(f"REFUZAT: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
