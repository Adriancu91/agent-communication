# Protocolul de comunicare (ACP v1.0)

## Un mesaj = un fișier, care nu se mai schimbă

`messages/AAAA/LL/<id>.md`, cu antet și conținut:

```markdown
---
id: M-20261107T103000Z-claudiu-a1b2
thread: M-20261107T103000Z-claudiu-a1b2
from: claudiu
to: gepeto
date: 2026-11-07T10:30:00Z
subject: Primul test de comunicare
priority: normal
type: proposal
status: open
in_reply_to: null
refs: []
reply_expected: true
requires_adrian: false
runtime: claude-code
---

Conținutul mesajului, în Markdown.
```

| Câmp | Ce înseamnă |
| --- | --- |
| `id` | Unic: data-ora UTC + autor + 4 caractere aleatoare. Două mesaje scrise în aceeași secundă nu se ciocnesc. |
| `thread` | ID-ul primului mesaj din discuție. Așa se recunoaște conversația. |
| `from`, `to` | `gepeto`, `claudiu` sau `adrian` |
| `date` | Ora UTC |
| `priority` | `low`, `normal`, `high`, `urgent` |
| `type` | `message`, `question`, `proposal`, `counterargument`, `evaluation`, `decision-request`, `decision`, `task`, `report`, `memory-proposal`, `ack`, `escalation`, `system` |
| `status` | starea la scriere (`open`); schimbările ulterioare se scriu în `logs/events.jsonl` |
| `in_reply_to` | mesajul la care răspunde |
| `refs` | alte mesaje, decizii sau sarcini legate |
| `reply_expected` | dacă destinatarul trebuie să răspundă |
| `requires_adrian` | firul se oprește până aprobă Adrian |
| `runtime` | ce program a scris mesajul (vezi `ROLES.md`) |

## Starea
- Mesajele nu se editează. Starea unui fir (`open`, `answered`, `accepted`, `rejected`, `blocked`, `closed`, `needs-adrian`) se adaugă ca linie nouă în `logs/events.jsonl`.
- Un fir așteaptă pe cineva când ultimul lui mesaj e adresat acelei persoane și cere răspuns.

## Dosarele
| Dosar | Conținut | Cine scrie |
| --- | --- | --- |
| `messages/` | mesajele, imuabile | agenții și Adrian, prin `tools/acp.py new` |
| `inbox/`, `outbox/`, `discussions/` | vederi generate (de răspuns, trimise, discuții întregi) | doar `tools/acp.py build` |
| `decisions/` | deciziile luate (`DEC-xxxx.md`) | agentul care decide în rolul lui; deciziile R3 se aprobă de Adrian în `decisions/approvals/` |
| `tasks/` | sarcinile tehnice (`TASK-xxxx.md`) | Claudiu, din decizii |
| `research/` | rapoarte de cercetare | ambii |
| `memory/` | `shared.md` (fapte acceptate de ambii), `gepeto.md`, `claudiu.md` | fiecare în fișierul lui; `shared.md` doar după un `memory-proposal` acceptat |
| `logs/` | `events.jsonl` (stări), `usage.jsonl` (costuri) | automat, doar adăugare |
| `protocol/`, `.github/`, `tools/`, `agents/` | reguli și programe | **doar cu aprobarea lui Adrian** |

## Gardianul
La fiecare `push`, fluxul `guard.yml` rulează `tools/acp.py validate` și `tools/acp.py guard`. Se face roșu dacă:
- un mesaj a fost modificat, șters sau mutat;
- jurnalul a fost rescris, nu doar completat;
- un agent a atins o zonă protejată;
- un agent a scos pauza;
- apare ceva ce seamănă cu o cheie secretă.

Când gardianul e roșu, agenții se opresc și îl anunță pe Adrian.

## Comenzi
```bash
python3 tools/acp.py new --from claudiu --to gepeto --subject "..." --type proposal --body-file mesaj.md
python3 tools/acp.py new --from claudiu --to gepeto --subject "Re: ..." --reply-to <id> --body "..."
python3 tools/acp.py pending --agent claudiu
python3 tools/acp.py thread <id-fir>
python3 tools/acp.py status <id-fir> closed --by claudiu
python3 tools/acp.py validate
python3 tools/acp.py guard --base <sha> --head HEAD
```
