# AIW-03 — Jurnalul de execuție

Misiunea: „AIW-03 — Autonomous Execution Mission” (Adrian și Gepeto, 7 noiembrie 2026). Execuție autonomă până luni, 9 noiembrie 2026.
Limite respectate pe tot parcursul:
- fără API-uri sau servicii plătite;
- fără modificări pe `main`, fără îmbinări, fără publicare;
- fără ștergerea de ramuri sau date;
- fără schimbarea setărilor repo-ului.

## Faza 0 — Audit și linia de bază (7 nov. 2026, ~17:15)

### Starea repo-ului
| Element | Stare reală (verificată prin API-ul GitHub și git) |
| --- | --- |
| `main` | `a18540f` — versiunea veche a back-office-ului; **fără protecție** (API: „Branch not protected”) |
| PR #2 | deschis, neîmbinat (`securitate-v2` → `main`) |
| PR #3 | ciornă, neîmbinat (`ai-workspace/audit` → `securitate-v2`) |
| PR #4 | ciornă, neîmbinat (`aiw-01/fundatie@496440b` → `main`) |
| PR #5 | ciornă, neîmbinat (`aiw-02/manager-proiecte@fe039c0` → `aiw-01/fundatie`) |
| Ultima versiune validă AIW-02 | `fe039c0` pe `aiw-02/manager-proiecte` (PR #5) |
| Planul AIW-03 | `8510eb1` pe `aiw-03/plan` = `fe039c0` + `app/docs/AIW-03.md` |

### Ramura de lucru
- **Ramura:** `aiw-03/memorie`, pornită din `aiw-03/plan` (`8510eb1`).
- **Ținta PR-ului:** `aiw-02/manager-proiecte`. Codul AIW-02 nu e în `main`, deci construirea pe `main` ar pierde AIW-01 și AIW-02. PR-ul are ca țintă ramura AIW-02, ca diferența să conțină doar AIW-03.
- **Arborele de lucru la pornire:** curat.

### Linia de bază (copie curată: `git worktree` la `8510eb1`, `npm ci --ignore-scripts`, `npm run verify`)
| Suită | Rezultat |
| --- | --- |
| `tsc --noEmit` | OK |
| `vite build` | OK |
| Vitest (unitare) | **26 trecute** / 5 fișiere |
| Licențe | OK, toate permisive |
| Playwright (browser) | **72 trecute, 16 sărite intenționat, 0 eșuate** (4 profiluri: iPhone 15, iPhone SE, Pixel 7, Desktop Chrome 1366×800) |

Comenzi, în `app/`: `npm ci --ignore-scripts`, apoi `npm run verify` (= `typecheck`, `build`, `test`, `licenses`, `e2e`).
Raportul anterior („98 de teste”) e confirmat: 26 + 72.

### Stocarea AIW-02, citită din cod (nu din rezumate)
- **`storage/db.ts`:**
  - IndexedDB `aiw`; `MIGRATIONS[]` numerotate, iar `DB_VERSION = MIGRATIONS.length` (acum 1);
  - depozite: `projects` (cheie `id`), `events` (cheie `seq`, index `projectId`), `meta` (cheie `key`);
  - `exclusive()` = Web Locks `aiw-write`, cu o coadă locală ca rezervă;
  - `toStorageError` traduce erorile browserului în tipuri; `onversionchange` închide conexiunea.
- **`projects/service.ts` → `change()`:** singura cale de scriere.
  - Citește coada jurnalului și starea curentă, calculează noua stare și evenimentul (SHA-256 în afara tranzacției).
  - Într-o tranzacție `readwrite`: verifică faptul că jurnalul nu s-a mișcat, scrie, adaugă evenimentul; orice eroare = `abort`.
  - Apoi anunță celelalte file (BroadcastChannel `aiw-changes`).
- **`core/journal.ts`:** amprenta evenimentului = SHA-256(canonical{seq, ts, type, projectId, dataHash, prev}). Conținutul are amprentă separată (`dataHash`), deci poate fi șters fără ruperea lanțului.

### Riscuri de dependență și migrare
1. **Migrarea 2 trebuie să păstreze bazele AIW-02.** IndexedDB rulează actualizarea într-o singură tranzacție: dacă un pas eșuează, versiunea rămâne 1 și datele rămân neatinse. De testat explicit.
2. **Amprenta evenimentelor nu are voie să se schimbe pentru evenimentele vechi.** Câmpul nou `entityId` intră în amprentă doar când există, deci evenimentele AIW-02 se verifică la fel ca înainte.
3. **Ștergerea definitivă a unui proiect** trebuie să șteargă și memoria lui, în aceeași tranzacție.
4. **Dependența de PR #5:** dacă PR #5 se schimbă, ramura AIW-03 trebuie rebazată (fără rescrierea istoriei publice: îmbinare, nu `rebase` forțat).

## Decizii autonome
(Formatul fiecărei decizii: ce s-a ales, alternativele, motivul.)

**D1 — Ramura și ținta PR-ului.**
- Ales: `aiw-03/memorie` din `aiw-03/plan`, cu ținta `aiw-02/manager-proiecte`.
- Alternative: `main` (nu are AIW-01/02); `aiw-01/fundatie` (nu are AIW-02).
- Motiv: e singura bază care conține codul de care depinde memoria.

**D2 — Calea comună de scriere.**
- Ales: `storage/journaled.ts` (`JournaledStore.write`), extrasă din `projects/service.ts`; `ProjectStore` și `MemoryStore` primesc aceeași instanță (o conexiune, un jurnal, un canal între file).
- Alternativă: o a doua cale în `memory` (copie) — respinsă, misiunea interzice duplicarea.

**D3 — Versiunile intrărilor stau în jurnal, nu într-un depozit separat.**
- Evenimentele `memory.created` și `memory.edited` poartă titlul, textul și numărul versiunii.
- Motiv: o singură sursă. Versiunile sunt deja legate de lanțul de amprente, deci orice modificare a unei versiuni vechi e detectată.
- Alternativă: depozitul `versions` (date duplicate, a doua sursă de adevăr).

**D4 — `entityId` în evenimente** (intrarea sau legătura despre care e evenimentul) intră în amprentă **doar când există**. Evenimentele AIW-02 își păstrează amprenta (testat cu baza creată de codul AIW-02 real).

**D5 — Punctul de control** `{seq, hash}` se ține în `localStorage` (`aiw.checkpoint:<bază>`), **în afara** IndexedDB.
- Motiv: lanțul singur nu vede tăierea ultimelor evenimente. Punctul de control o vede, dacă nu a fost rescris și el.
- Limita e documentată și testată (testul „limitation…”).

**D6 — Starea „înlocuită” / „rezolvată” se calculează din legături** (`statusFromLinks`) și se recalculează la orice adăugare sau ștergere de legătură și la ștergerea definitivă.
- Motiv: nicio stare nu poate rămâne fără legătura care o justifică (fără referințe rupte).

**D7 — Arhiva e un câmp separat (`archived`)**, nu o stare. Restaurarea readuce exact starea dinainte (de exemplu o decizie înlocuită rămâne înlocuită).

**D8 — Propunerile respinse** sunt marcate `rejected` și arhivate; nu pot fi restaurate în memorie și pot fi șterse definitiv din arhivă.

**D9 — Ștergerea definitivă** se face doar din arhivă (doi pași, ca la Coș). Elimină legăturile și șterge textele din jurnal (inclusiv motivele legăturilor). Recalculează starea capătului celălalt: o decizie al cărei înlocuitor e șters redevine activă.

**D10 — Cicluri** interzise pentru `derived_from` și `replaces`. `resolves` are reguli de categorie (ținta e o problemă, sursa nu e o problemă), deci nu poate face cicluri. `related_to` e simetrică: duplicatul e verificat în ambele sensuri.

**D11 — Limita de mărime a contextului** se măsoară pe ce primește AI-ul (proiect + secțiuni), fără raportul de omisiuni.
- Găsit de test: raportul crește când se scot intrări, iar măsurarea lui făcea limita imposibil de atins.

**D12 — Erorile proprii aplicației** (validare, reguli de legături) trec prin calea de scriere neschimbate. Doar erorile browserului devin `StorageError`.
- Găsit de test: altfel interfața ar fi spus „eroare necunoscută” în loc de motivul real.

## Faza 1–5 — Rezultate intermediare (7 nov.)
- Pasul 1 (commit `9bbfab9`): calea comună + migrarea 2. 26 unitare + 72 în browser trec.
- Modelul (`core/memory.ts`), modulul `memory` (operații, relații, fluxurile de înlocuire și rezolvare, integritate), `memory/context.ts`.
- **57 de teste unitare trec** (26 vechi + 31 noi), inclusiv:
  - migrarea unei baze create de **codul AIW-02 real** (copie înghețată în `tests/fixtures/aiw02/`);
  - migrarea eșuată;
  - scrierea întreruptă;
  - două file;
  - cele 7 teste de integritate.
