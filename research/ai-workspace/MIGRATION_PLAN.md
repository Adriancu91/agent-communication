# MIGRATION_PLAN — pașii exacți de transformare

Fiecare pas: ramură separată → PR → testele și gardianul trec → **Adrian aprobă și îmbină**. Nimic nu se șterge și nu se publică fără aprobare. `main` rămâne funcțional după fiecare pas.

## Pasul 0 — Decizii (Adrian + Gepeto)
1. Aprobarea direcției din aceste 6 documente.
2. Soarta PR #2 (securitatea v2), care e **baza** recomandată: conține reparațiile găsite la revizie. Recomandare: îmbinat întâi, apoi restul.
3. Răspunsuri la întrebările din §„Decizii deschise”.

## Pasul 1 — Siguranța repo-ului (Adrian, ~10 minute, fără cod)
1. Settings → Rules → Rulesets pentru `main`: blochează ștergerea și force-push, cere PR.
2. Settings → Billing: plafon GitHub Actions 0 USD.
3. Ștergerea ramurilor `test/guard-tamper` și `test/ciclu-v2`.

## Pasul 2 — Pregătirea repo-ului (PR „AIW-01”)
- `fixtures/`: exemple de intrări valide și invalide; testele Python existente le folosesc.
- În `protocol/config.json`, `app/` și `fixtures/` devin zone protejate.
- `README.md`: secțiunile „AI Workspace (produs)” și „Back-office Gepeto–Claudiu”.
- `costs.yml` rămâne oprit (doar la cerere); `logs/usage.jsonl` și comanda `costs` sunt marcate „de eliminat” (se elimină doar la aprobare).
- **Test:** toate cele 52 de teste vechi + testele noi pentru exemple.

## Pasul 3 — Scheletul aplicației (PR „AIW-02”)
- `app/` cu Vite + TypeScript + Preact, PWA, CSP strictă, română/engleză.
- Un ecran gol „Proiecte”, construit local.
- Workflow `app.yml`: teste la PR, doar citire, acțiuni fixate pe SHA. **Fără publicare.**
- Testul de granițe între module și testul „fără rețea”.

## Pasul 4 — `core` + `storage` (PR „AIW-03”)
- Portarea parserului de format, a validării și a jurnalului cu amprente din `tools/acp.py`.
- Testele rulează aceleași exemple din `fixtures/` ca Python.
- Stocarea în IndexedDB + `persist()`.

## Pasul 5 — Proiecte + export/import (PR „AIW-04”)
- Ecranele de proiect, intrările și istoricul.
- Arhiva `.aiw.zip` cu verificări; backup și restaurare.
- **Test cap-coadă:** creare → export → ștergere → import → identic.

## Pasul 6 — Memorie (PR „AIW-05”)
- Secțiunile fixe, editare și propuneri cu confirmare.

## Pasul 7 — Continuitate (PR „AIW-06”)
- Pachetul de context per țintă, căutarea de chei secrete, importul răspunsului.
- Testat manual cu Claude, ChatGPT și Gemini (Adrian lipește; eu verific rezultatul).

## Pasul 8 — Lansator (PR „AIW-07”)
- Taburi, deschidere în filă nouă, încorporare doar unde se permite.

## Pasul 9 — Verificare și publicare de test (cu aprobarea lui Adrian)
1. Revizie independentă de securitate (alt agent), ca la PR #2.
2. Testare pe telefoanele lui Adrian.
3. Un workflow de publicare pe GitHub Pages, **pornit manual**, cu `pages: write` doar în jobul de publicare. Prima publicare: doar după „da”-ul lui Adrian.

## Ce rămâne neschimbat
`tools/`, `protocol/`, `agents/`, `messages/`, `logs/`, gardianul și workflow-urile existente: back-office-ul Gepeto–Claudiu continuă să funcționeze în paralel.

## Decizii deschise (pentru Adrian și Gepeto)
1. Aplicația stă în **acest repo** (recomandarea mea: refolosește gardianul, istoria și testele) sau într-un repo nou, separat?
2. Numele de pe link: `adriancu91.github.io/agent-communication/` (numele repo-ului) sau un repo/domeniu cu nume de produs?
3. Licența codului aplicației (proprietar, ca restul proiectelor tale, sau open-source)?
4. Prima sincronizare după MVP: manuală (export/import) sau un repo GitHub privat al utilizatorului?
