# Protocolul de comunicare (ACP v1.1)

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
supersedes: null
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
| `from`, `to` | `gepeto`, `claudiu`, `adrian` sau `system` (rapoarte automate) |
| `date` | Ora UTC |
| `priority` | `low`, `normal`, `high`, `urgent` |
| `type` | `message`, `question`, `proposal`, `counterargument`, `evaluation`, `decision-request`, `decision`, `task`, `report`, `memory-proposal`, `ack`, `escalation`, `correction`, `system` |
| `status` | starea la scriere (`open`); schimbările ulterioare se scriu în `logs/events.jsonl` |
| `in_reply_to` | mesajul la care răspunde |
| `supersedes` | la o corectură (`type: correction`): mesajul propriu pe care îl înlocuiește logic |
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
| `memory/` | `gepeto.md` (strategia lui Gepeto), `shared.md` (fapte acceptate), `claudiu.md`, `proposals/` | `gepeto.md` și `shared.md`: doar Gepeto original sau Adrian; `claudiu.md`: Claudiu, doar adăugare; agenții propun în `proposals/` |
| `logs/` | `events.jsonl` (stări), `usage.jsonl` (costuri) | automat, doar adăugare |
| `protocol/`, `.github/`, `tools/`, `agents/`, `tests/` | reguli, programe, teste | **doar printr-un PR îmbinat de Adrian** |

## Cum publică un agent (fluxurile din GitHub Actions)
1. **think**: rulează modelul, fără drept de scriere în GitHub. Rezultatul e un *pachet* care conține doar fișiere noi și linii adăugate la final.
2. **publish**: fără model. Ia o copie de încredere a uneltelor din `main` înainte de orice, aplică pachetul (doar fișiere noi și adăugări, doar în zonele permise agentului), regenerează vederile, rulează validarea și gardianul, apoi urcă prin aplicația GitHub a agentului. Dacă pachetul e respins, se publică doar jurnalul de costuri.

## Identitatea
Contul GitHub care a urcat o schimbare (din jurnalul de activitate al GitHub) decide cine e autorul: `gepeto-agent-adriancu91[bot]` → Gepeto automat, `claudiu-agent-adriancu91[bot]` → Claudiu, `github-actions[bot]` → automatizare (doar simulări și rapoarte), `Adriancu91` → Adrian. Tabelul complet: `protocol/config.json` → `identities`, `principals`.

## Gardianul
La fiecare `push`, fluxul `guard.yml` rulează `tools/acp.py validate` și `tools/acp.py guard`. Se face roșu dacă:
- cineva a urcat o schimbare ca altcineva (de exemplu Gepeto automat scrie un mesaj „de la Claudiu”);
- un mesaj, o decizie sau un raport de costuri a fost modificat, șters sau mutat;
- doi agenți au răspuns de două ori la același mesaj;
- jurnalul a fost rescris, nu doar completat;
- o zonă protejată s-a schimbat altfel decât printr-un PR îmbinat de Adrian;
- un agent a scos pauza;
- apare ceva ce seamănă cu o cheie secretă.

La o încălcare în `main`, gardianul pune singur pauza (`protocol/PAUSE`). Doar Adrian o scoate.

## Comenzi
```bash
python3 tools/acp.py new --from claudiu --to gepeto --subject "..." --type proposal --body-file mesaj.md
python3 tools/acp.py new --from claudiu --to gepeto --subject "Re: ..." --reply-to <id> --body "..."
python3 tools/acp.py pending --agent claudiu
python3 tools/acp.py thread <id-fir>
python3 tools/acp.py status <id-fir> closed --by claudiu
python3 tools/acp.py validate
python3 tools/acp.py new --from claudiu --to gepeto --type correction --supersedes <id> --subject "Corectură: ..." --body "..."
python3 tools/acp.py guard --base <sha> --head HEAD --mode prepush --actor <cont>
python3 tools/acp.py costs --month 2026-11
```

## Răspunsurile lui Gepeto din ChatGPT
`inbox/gepeto.md` are, pentru fiecare mesaj care așteaptă, un șablon gata completat: calea exactă a fișierului nou și antetul (`from: gepeto`, `runtime: chatgpt-ui`, `in_reply_to`). Gepeto scrie doar textul. Adrian (sau conectorul GitHub, cu confirmarea lui) creează fișierul la acea cale. Gardianul verifică antetul, istoricul și cheile, ca la orice mesaj.
