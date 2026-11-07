# AI_WORKSPACE_AUDIT — auditul repo-ului `agent-communication`

Autor: Claudiu · 7 noiembrie 2026 · ramura `ai-workspace/audit` (pornită din `securitate-v2`). `main` și PR #2 nu au fost atinse.

## 0. Concluzia în trei fraze
1. Repo-ul e un **„birou de mesaje” între agenți, care rulează pe server** (Python + git + GitHub Actions). AI Workspace e o **aplicație în browser**. Codul Python nu rulează în browser, deci **nu se reutilizează codul ca atare**, ci **formatele, regulile și testele**, care se rescriu în TypeScript.
2. Cel mai valoros lucru pentru noul produs e **formatul**: mesaje markdown cu antet, imuabile, plus un jurnal de evenimente în care doar se adaugă. Acesta poate deveni chiar **formatul de export al unui proiect**: îl citește un om și îl înțelege orice AI.
3. Gardianul, publicatorul și workflow-urile rămân valoroase ca **back-office** (colaborarea Gepeto–Claudiu pe GitHub și, mai târziu, o sincronizare opțională prin GitHub). Pentru prima versiune a aplicației nu sunt necesare.

## 1. Cum am verificat
- Am citit tot codul: `tools/acp.py` (~1.000 de rânduri), `tools/publish.py`, `agents/gepeto/run_auto.py`, 4 workflow-uri și 3 fișiere de teste. În total sunt ~1.800 de rânduri Python.
- Am rulat testele: **52/52 trec** local; pe GitHub, gardianul trece pe PR #2 (rularea 42369959973).
- Am verificat **comportamentul real**, nu doar testele:
  - două cicluri complete fără API pe ramura `test/ciclu-v2` (rulările 42368862380 și 42369522665);
  - gardianul, rulat pe istoria reală;
  - un revizor independent, care a găsit 3 probleme grave în cod deja testat. Asta confirmă că **un test trecut nu înseamnă siguranță**. Le-am reparat, iar el le-a reverificat.
- Am verificat setările repo-ului prin API: repo privat, Pages oprit, **`main` fără protecție și fără reguli (rulesets)**. Secretele și variabilele de Actions nu le pot citi din sesiunea mea (proxy-ul blochează). Eu nu am adăugat niciunul.
- Am măsurat dacă site-urile AI acceptă să fie încorporate (vezi §6).

## 2. Structura (ramura `securitate-v2`, 39 de fișiere pe `main`, 38 schimbate în PR #2)
| Dosar / fișier | Ce face | Cod real sau convenție |
| --- | --- | --- |
| `tools/acp.py` | Protocolul: creează mesaje, vederi, validare, gardian, pachete (bundle), rapoarte | cod (Python, doar biblioteca standard) |
| `tools/publish.py` | Publicatorul: aplică pachetul unui agent, verifică și urcă | cod |
| `agents/gepeto/run_auto.py` | Gepeto automat (`none`/`sim`/`local`), oprit implicit | cod |
| `agents/*/SYSTEM.md`, `AUTOMATION.md`, `CHATGPT.md` | Instrucțiuni pentru agenți | text |
| `protocol/config.json` | Identități, drepturi pe căi, zone protejate, limite, buget 0 | configurare |
| `protocol/RULES.md`, `ROLES.md`, `PROTOCOL.md` | Regulile R1–R7, rolurile, formatul | text |
| `messages/AAAA/LL/*.md` | Mesajele, imuabile | date |
| `logs/events.jsonl`, `logs/usage.jsonl` | Jurnale în care doar se adaugă | date |
| `inbox/`, `outbox/`, `discussions/` | Vederi generate pentru telefon | generat |
| `memory/gepeto.md`, `shared.md`, `claudiu.md`, `proposals/` | Memorie per agent + propuneri | text liber |
| `decisions/`, `decisions/approvals/` | Decizii și aprobările lui Adrian | **doar convenție** (README); nicio unealtă nu le creează sau validează, doar gardianul le protejează |
| `tasks/` | Sarcini | **doar convenție** (README, gol) |
| `research/` | Rapoarte | text |
| `.github/workflows/` | guard, gepeto, claudiu, costs | automatizare |
| `tests/` | 52 de teste (protocol, securitate, workflow-uri) | cod |

## 3. Componentele, verificate una câte una
**Sistemul de mesaje (ACP).**
- Ce are: un fișier markdown per mesaj, cu antet (id, fir, de la, către, tip, stare, răspuns la, înlocuiește, cere Adrian, runtime).
- Corecturile se fac doar prin mesaje noi.
- Verificat: validarea, firele, ordinea în aceeași secundă, sfârșiturile de rând Windows.
- Puternic: ușor de citit de un om și de orice AI.
- Slab: e legat de git (ordinea vine din jurnal, identitatea din cine a urcat).

**Jurnalul imuabil.**
- Ce are: `events.jsonl`, în care doar se adaugă (status, trimis); gardianul verifică faptul că nu e rescris.
- Ce lipsește: un lanț de amprente (hash). Imuabilitatea vine **doar** din istoria git plus gardian.
- Într-un browser nu există git, deci imuabilitatea trebuie refăcută (amprente înlănțuite).

**Memoria.**
- Ce are: fișiere markdown libere per agent; Gepeto și cea comună pot fi scrise doar de Adrian; agenții doar propun.
- Valoare: regula „AI-ul propune, omul aprobă”.
- Slab: memoria nu are structură (obiective, reguli, stare, probleme, pași), așa cum cere Memory Engine.

**Decizii și sarcini.**
- Ce au: doar un README cu formatul dorit, fără unealtă și fără validare.
- Valoarea e în idee (decizii R3 aprobate doar de om, arhivă de decizii), nu în cod.

**Gardianul.**
- Ce face:
  - identitatea vine de la GitHub (cine a urcat);
  - zone protejate, căi „doar proprietarul”, imuabilitate, jurnale în care doar se adaugă;
  - verificări de uzurpare de identitate, căutare de chei secrete, verificarea îmbinărilor;
  - doar Adrian deblochează un fir;
  - pauză automată la o încălcare.
- Calitate: după revizie, solid. Rulează dintr-o copie de încredere luată de dinainte de schimbare.
- Limită: depinde de git și de API-ul GitHub; în browser nu se poate muta ca atare.

**Publicatorul separat de AI.**
- Ce face: jobul AI nu are drepturi de scriere și produce un pachet; un job fără AI îl verifică și îl urcă.
- Valoare: principiul e exact ce trebuie și în aplicație. Orice text venit de la un AI (lipit de utilizator) intră doar prin import cu previzualizare, validare și confirmare.

**Workflow-urile.**
- Toate cele 5 acțiuni externe sunt fixate pe SHA (verificat).
- Drepturi minime, fără `pull_request_target`, fără expresii `${{ }}` în scripturi.
- `gepeto.yml` și `claudiu.yml` pornesc doar la cerere. Claudiu e **neactivat** (fără token, fără aplicație).

**Testele.**
- Ce acoperă:
  - 52 de teste;
  - injecții de instrucțiuni în textul agenților;
  - un Claudiu compromis, identitate, istoric, autonomie;
  - lipsa căilor de plată, publicatorul, workflow-urile;
  - regresiile găsite la revizie.
- Valoare mare **ca specificație**: descriu exact ce trebuie să refuze sistemul.

**Dependențe externe.**
- Python: doar biblioteca standard.
- Acțiuni externe:
  - `actions/checkout`, `upload-artifact`, `download-artifact` (GitHub, MIT);
  - `create-github-app-token` (GitHub, MIT);
  - `anthropics/claude-code-action` (MIT).
- Niciun serviciu plătit, nicio cheie API.

## 4. Starea Git și riscuri găsite
- `main` are **versiunea veche (v1)**. Versiunea sigură (v2, cu reparațiile) e doar în PR #2, **neîmbinat**.
- `main` **nu are protecție**: se poate rescrie istoria sau șterge ramura. Activarea regulilor e în planul de activare și ține de Adrian.
- Ramurile de test `test/guard-tamper` și `test/ciclu-v2` așteaptă să fie șterse de Adrian.
- Sesiunile mele urcă cu contul lui Adrian, deci gardianul nu le poate deosebi de commit-urile lui Adrian.

## 5. Ce înseamnă pentru AI Workspace
| Cerința din viziune | Ce există deja | Distanța |
| --- | --- | --- |
| A. Project Manager | Un singur „proiect” (repo-ul). Fire, decizii, memorie ca fișiere | mare: lipsesc proiectele multiple, interfața, importul/exportul |
| B. Browser Workspace | Nimic | totul nou, cu limitele reale din §6 |
| C. Memory Engine | Memorie per agent + regula „AI-ul propune, omul aprobă” | medie: trebuie structurată |
| D. AI Continuity | Șabloanele pentru Gepeto din `inbox/gepeto.md` (pachet de context + răspuns cu antet) | **mică**: e exact mecanismul, doar generalizat |
| E. Local Data & Export | Formatul markdown + jsonl, gata de mutat | medie: lipsesc stocarea în browser, arhiva .zip și importul |

## 6. Limite tehnice reale, verificate
- **Site-urile AI nu pot fi încorporate.** Antetele măsurate pe 7 noiembrie 2026:
  - chatgpt.com: `X-Frame-Options: SAMEORIGIN`;
  - claude.ai: `SAMEORIGIN`;
  - gemini.google.com: `DENY`;
  - perplexity.ai: `SAMEORIGIN`;
  - chat.mistral.ai: `SAMEORIGIN`;
  - google.com: `SAMEORIGIN`;
  - GitHub refuză și el încorporarea (documentat; nu l-am putut măsura din sesiune);
  - un site obișnuit, cum e Wikipedia, se poate încorpora.

  Deci „browserul integrat” devine un **lansator**: taburi care deschid fiecare site în fila sau fereastra lui, plus context copiat sau pus în link. Ocolirea acestor antete (proxy, extensie care le șterge) ar încălca termenii furnizorilor și securitatea autentificării: **nu o facem**.
- **Linkuri cu întrebarea pre-completată:** ChatGPT acceptă `chatgpt.com/?q=…`; Claude a acceptat `claude.ai/new?q=…`, dar sunt rapoarte că uneori nu merge. Nu ne bazăm pe ele: varianta sigură e **copierea în clipboard** plus deschiderea site-ului.
- **GitHub Pages:** site-ul e **public pe internet chiar dacă repo-ul e privat** (pe planul Pro). Codul aplicației e deci vizibil. Datele utilizatorului nu ajung niciodată acolo; stau doar în browserul lui. Pages nu oferă stocare și nici sincronizare.
- **Stocarea pe iPhone:** Safari șterge datele unui site după 7 zile de folosire a Safari fără vizită pe site. Aplicațiile adăugate pe ecranul principal sunt scutite. Deci pe iPhone: „Adaugă pe ecranul principal” + export de siguranță periodic, obligatoriu.
