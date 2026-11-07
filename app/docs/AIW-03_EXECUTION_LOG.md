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
