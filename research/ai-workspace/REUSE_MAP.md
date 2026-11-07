# REUSE_MAP — ce păstrăm, adaptăm, dezactivăm sau propunem pentru eliminare

Nimic nu se șterge fără aprobarea lui Adrian. „REMOVE CANDIDATE” înseamnă doar propunere.

Legendă: **KEEP** = păstrăm cum e · **ADAPT** = păstrăm ideea/formatul, îl rescriem pentru aplicație · **DISABLE** = oprit în prima versiune · **REMOVE CANDIDATE** = propus pentru eliminare.

## Tabelul pe scurt
| Componentă | Categorie | În AI Workspace devine |
| --- | --- | --- |
| Formatul mesajelor (antet + markdown) | **ADAPT** | formatul intrărilor din proiect și al exportului |
| `logs/events.jsonl` (jurnal în care doar se adaugă) | **ADAPT** | jurnalul proiectului, cu amprente înlănțuite |
| Corecturi prin mesaje noi (`supersedes`) | **KEEP** (regula) | editările nu șterg istoricul |
| Memoria per agent + „AI-ul propune, omul aprobă” | **ADAPT** | Memory Engine structurat per proiect |
| Decizii + aprobări doar de Adrian | **ADAPT** | jurnalul de decizii al proiectului |
| Sarcini (`tasks/`, doar README) | **ADAPT** | „următorii pași” / probleme deschise |
| Șabloanele pentru Gepeto din ChatGPT (`inbox/gepeto.md`) | **ADAPT** | AI Continuity: pachet de context + import răspuns |
| `tools/acp.py` validare + vederi | **ADAPT** | portat în TypeScript (`core/`) |
| Gardianul (`acp.py guard` + `guard.yml`) | **KEEP** pentru repo · DISABLE pentru aplicație | protejează în continuare repo-ul; în aplicație, verificările de import |
| Publicatorul separat de AI (`publish.py`) | **KEEP** principiul | importul cu previzualizare și confirmare |
| Căutarea de chei secrete | **ADAPT** | avertizare la export/import |
| `protocol/config.json` (drepturi pe căi) | **KEEP** pentru repo | — |
| `protocol/RULES.md` R1–R7 | **KEEP** | regulile produsului (buget 0, aprobări umane) |
| Testele (52) | **KEEP** + ADAPT | rămân pentru back-office; devin specificația testelor TypeScript |
| `gepeto.yml`, `claudiu.yml` | **DISABLE** | pornesc doar la cerere; Claudiu neactivat |
| `costs.yml` (raport lunar) | **DISABLE** | nu are ce măsura cu buget 0 |
| `agents/gepeto/run_auto.py` | **DISABLE** | oprit (`none`); util doar pentru teste |
| Vederile `inbox/outbox/discussions` | **KEEP** pentru repo | în aplicație, ecranele le înlocuiesc |
| `logs/usage.jsonl` | **REMOVE CANDIDATE** (după PR #2) | nimic de numărat la 0 USD |
| `tools/acp.py` comenzile `costs`/`month_usage` | **REMOVE CANDIDATE** | idem |
| Ramurile `test/guard-tamper`, `test/ciclu-v2` | **REMOVE CANDIDATE** | doar Adrian le poate șterge |
| `research/` (rapoarte vechi) | **KEEP** | istoric |

## Detaliu pentru fiecare componentă reutilizată

### 1. Formatul mesajelor — ADAPT
- **Ce face acum:** fiecare mesaj e un fișier `.md` cu antet (id, fir, de la, către, tip, stare, răspuns la, înlocuiește, cere Adrian, runtime).
- **Valoare:** se citește pe telefon, e înțeles de orice AI și nu depinde de o bază de date. E formatul perfect pentru **export** și pentru **pachetul de context**.
- **Modificări:**
  - antetul se generalizează: `project`, `kind` (note / decision / task / conversation / context-pack / ai-reply), `source` (claude.ai / chatgpt / gemini / utilizator);
  - se păstrează `supersedes` și `requires_owner`;
  - parser în TypeScript, compatibil cu cel din Python (aceleași teste de exemplu).
- **Riscuri:** două implementări (Python și TS) se pot despărți în timp. Soluție: fișiere de test comune (`fixtures/`) rulate de ambele.

### 2. Jurnalul în care doar se adaugă — ADAPT
- **Ce face:** `events.jsonl` ține trimiterile și stările; gardianul interzice rescrierea.
- **Valoare:** istoric de încredere pentru decizii, memorie și importuri.
- **Modificări:** în browser nu există git, deci fiecare eveniment primește amprenta celui dinainte (SHA-256). Aplicația verifică lanțul la pornire și la import, iar o rupere se semnalează. Lanțul nu împiedică ștergerea, dar o face **vizibilă**; exportul periodic e copia de siguranță.
- **Riscuri:** utilizatorul își poate șterge datele din browser (e dreptul lui). Lanțul nu e o protecție împotriva proprietarului, ci împotriva corupției și a importurilor modificate.

### 3. Memoria — ADAPT
- **Ce face:** `memory/<agent>.md` + `memory/proposals/`. AI-ul doar propune; Adrian aprobă.
- **Valoare:** regula de aur pentru Memory Engine: **nimic nu intră în memoria proiectului fără confirmarea utilizatorului**.
- **Modificări:** memoria per proiect, pe secțiuni fixe:
  - obiective;
  - reguli;
  - starea actuală;
  - decizii;
  - probleme deschise;
  - următorii pași;
  - glosar.

  Fiecare schimbare e un eveniment cu sursă (utilizator, import de la AI).
- **Riscuri:** memoria crește și pachetul de context devine prea mare. Soluție: limite de mărime și rezumate scrise de utilizator sau de AI, tot cu confirmare.

### 4. Decizii și aprobări — ADAPT
- **Ce face:** convenție (README) + protecția gardianului pentru `decisions/approvals/`.
- **Valoare:** separă „AI-ul propune” de „omul decide”.
- **Modificări:** decizia devine o intrare `kind: decision` (ce, de ce, alternative, cine, când), cu starea propusă → aprobată / respinsă **doar** prin acțiunea utilizatorului.

### 5. Șabloanele pentru Gepeto — ADAPT (cea mai directă reutilizare)
- **Ce face:** pentru fiecare mesaj care așteaptă, generează contextul și un răspuns cu antet gata completat; omul îl lipește înapoi.
- **Valoare:** **este** AI Continuity: pachet de context → AI extern → răspuns importat, transparent și confirmat.
- **Modificări:**
  - generator de „pachet de context” per proiect și per țintă (Claude, ChatGPT, Gemini), cu limită de caractere;
  - butoane „Copiază” și „Deschide site-ul”;
  - un câmp „Lipește răspunsul”, cu previzualizare și confirmare înainte de salvare.

### 6. Publicatorul separat de AI — KEEP principiul
- **Ce face:** AI-ul nu scrie direct; un pas fără AI validează și publică.
- **Valoare:** în aplicație, același principiu pentru tot ce vine de la un AI: **nimic nu se aplică automat**.
- **Modificări:** în locul unui job GitHub, un ecran de import cu diferențe, validare și buton de confirmare.

### 7. Gardianul — KEEP pentru repo, DISABLE pentru aplicație
- **Ce face:** protejează istoria repo-ului, identitățile și zonele protejate.
- **Valoare:** rămâne paza back-office-ului (colaborarea Gepeto–Claudiu și viitoarea sincronizare prin GitHub).
- **Modificări:** zona protejată se extinde la `app/` (codul aplicației), ca orice schimbare de cod să treacă prin PR aprobat de Adrian.
- **Riscuri:** nu protejează datele din browser. Acolo protecția e exportul, lanțul de amprente și validarea la import.

### 8. Testele — KEEP + ADAPT
- **Ce fac:** 52 de teste pentru protocol, injecții, identitate, istoric, plăți și workflow-uri.
- **Valoare:** sunt deja specificația a ce trebuie refuzat.
- **Modificări:** cele de protocol devin fișiere de exemplu comune; aplicația primește teste proprii (parser, export/import cap-coadă, injecție în textul importat, lanțul de amprente, „nicio cerere de rețea spre API-uri”).

### 9. Căutarea de chei secrete — ADAPT
- **Ce face:** gardianul refuză chei API și tokenuri în commit-uri.
- **Valoare:** utilizatorii lipesc des chei în conversații. Aplicația avertizează înainte de export și înainte de a copia contextul pentru un AI.

## Ce reconstruim de la zero
- Interfața (ecrane pentru telefon și PC).
- Stocarea în browser.
- Arhiva de export/import.
- Lansatorul de site-uri.
- Generatorul de pachete de context.

Nimic din acestea nu există azi.
