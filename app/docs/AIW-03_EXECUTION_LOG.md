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

## Faza 6–7 — Interfața și testele în browser (7 nov.)
- `ui/memory.tsx`:
  - tabul Memorie, cu selector și revenire sigură;
  - memoria proiectului: 7 categorii, filtre, căutare cu versiuni anterioare, De confirmat, Arhivă;
  - pagina intrării: proveniență, versiuni, legături, înlocuire, rezolvare, arhivă, ștergere;
  - istoric și integritate; previzualizarea contextului; cardul de memorie pe pagina proiectului.
- **D13 — Fără iconița de fixare la intrările importante** (doar eticheta „★ Important”): la proiecte, iconița înseamnă „fixat sus”, iar cele două nu trebuie confundate.
- **D14 — Dialogurile redau focalizarea butonului care le-a deschis.** Găsit de testul de tastatură: după Escape, focalizarea se pierdea.
- **D15 — Ultimul proiect folosit se salvează sincron** (`useLayoutEffect`). Găsit de un test instabil (1 din 4 rulări): tabul Memorie putea deschide proiectul anterior dacă era apăsat imediat.
- **D16 — Propunerile AI în testele din browser** sunt create cu aceleași funcții din `core` (aceeași înregistrare, aceeași amprentă) prin `tests/e2e/helpers.ts → seedProposal`. Nu există o cale de creare din interfață, fiindcă nu există încă o integrare AI.
- **D17 — Eroarea „spațiu plin” în testele din browser** e simulată în pagină (aceeași `DOMException QuotaExceededError` pe care o dă browserul), ca să se testeze și pe motorul iPhone. Limita reală a fost testată în AIW-02, doar pe Chromium.
- **D18 — Migrarea în browser real** (`tests/e2e/migration.spec.ts`, `scripts/build-aiw02-baseline.mjs`): aplicația AIW-02 e construită din `fe039c0`, folosită, apoi înlocuită cu AIW-03 la aceeași adresă, cu același profil de browser.
  - **Constatat:** aplicația ține versiunea pe dispozitiv, deci versiunea nouă preia controlul după 1–3 deschideri. Datele nu sunt atinse între timp.
  - **Recomandare AIW-07:** mesajul „Versiune nouă — reîncarcă”.

## Faza 8 — Revizia independentă (alt agent, care nu a scris codul) și reparațiile
| # | Constatare | Gravitate | Reparat |
| --- | --- | --- | --- |
| 1 | `verify` citea jurnalul, apoi punctul de control: o scriere făcută între timp (în altă filă) dădea o alarmă falsă „istoricul nu se potrivește”; verificarea memoriei folosea mai multe tranzacții | medie | punctul de control e citit **înainte**; verificarea memoriei folosește **o singură tranzacție** (test „no false alarm”) |
| 2 | `done()` anula comportamentul implicit la eroarea unei cereri: o cerere eșuată în tranzacție nu oprea tranzacția, deci jurnalul putea primi un eveniment fără înregistrare (moștenit din AIW-02) | medie | eroarea unei cereri oprește acum toată tranzacția (test „a failed request inside a write aborts everything”) |
| 3 | Arhivarea deciziei care o înlocuise pe alta lăsa proiectul fără decizie curentă | medie | starea se calculează doar din legăturile care pornesc de la intrări oficiale; arhivarea, restaurarea, confirmarea și respingerea recalculează starea țintelor (test) |
| 4 | Contextul serializat conținea și titlurile propunerilor și ale intrărilor arhivate (în raportul de omisiuni) | medie | separat: `payload` (singurul care se poate trimite) și raportul pentru utilizator (test) |
| 5 | Fără punct de control, verificarea arăta „întreg” cu verde; ascunderea conținutului unei versiuni vechi nu era semnalată | mică-medie | stare nouă „Verificare parțială”; conținutul șters al unei intrări care încă există e raportat; numărul de conținuturi șterse e afișat; textul limitelor e completat (teste) |
| 6 | Memoria unui proiect din coș se putea modifica | mică | doar citire, în serviciu și în interfață (teste) |
| 7 | Problemele de integritate apăreau mereu în română | mică | coduri, traduse în interfață |
| 8 | O eroare la verificare nu afișa nimic | mică | mesaj de eroare |
| 9 | Un comentariu din `context.ts` contrazicea codul | mică | corectat |
| 10 | Commit-ul AIW-02 folosit la testul de migrare poate deveni inaccesibil după o îmbinare „squash” | mică | scriptul folosește eticheta `aiw-02-baseline` dacă există, altfel `fe039c0`. Urcarea etichetei e blocată de proxy-ul sesiunii, deci rămâne **verificare manuală pentru Adrian** (nu îmbina AIW-02 prin „squash”, sau creează eticheta) |

**Constatare suplimentară, găsită de CI (GitHub Actions) pe motorul iPhone.** Componenta de funcționare offline (moștenită din AIW-01) putea răspunde cu „nimic” în timpul unei actualizări, iar utilizatorul vedea o pagină de eroare.
- **Reparat:** la o căutare fără rezultat în cache, folosește rețeaua; fără rețea, folosește pagina aplicației din orice cache. Niciodată nu răspunde cu „nimic”.
- **Test nou:** „an update never shows an error page” (Chrome și iPhone), cu versiunea N → N+1 și redeschideri repetate.
- Versiunea AIW-02 (nepublicată) are încă defectul; testul de migrare îl tolerează la prima deschidere și îl notează.

**După reparații:** 63 de teste unitare și 159 în browser trec (`npm run verify`, ieșire 0).

## Faza 8b — A doua revizie independentă (alt agent, de la zero) și reparațiile
Reparațiile 2, 4, 5, 6 și 7 au fost confirmate. Constatări noi:
| # | Constatare | Gravitate | Reparat |
| --- | --- | --- | --- |
| 1 | O legătură obișnuită nouă recalcula starea țintei numărând și legăturile din intrări arhivate: problema redevenea „rezolvată”, iar verificarea integrității arăta memoria ca deteriorată după o folosire normală | medie-mare | recalcularea folosește doar sursele oficiale (test) |
| 2 | Ștergerea definitivă lăsa în jurnal explicația unei legături eliminate anterior | medie (confidențialitate) | se șterg textele tuturor legăturilor care au atins vreodată intrarea (test) |
| 3 | „O decizie se înlocuiește o singură dată” se putea ocoli prin restaurarea unui înlocuitor arhivat | mică | restaurarea e refuzată cu un mesaj clar (test) |
| 4 | Scriptul de bază prefera eticheta (mutabilă) commit-ului fix | mică | commit-ul fix întâi; eticheta doar dacă indică același commit |

După reparații: **66 de teste unitare** trec.

## Faza 7 și 9 — Raportul final de testare (7 nov. 2026, seara)

### Linia de bază față de final
| Suită | Început (`8510eb1`) | Final (`d8ec857`) |
| --- | --- | --- |
| Unitare (Vitest) | 26 / 5 fișiere | **66 / 6 fișiere** (memory.test.ts: 40) |
| Browser (Playwright, 4 profiluri) | 72 trecute, 16 sărite | **159 trecute, 37 sărite, 0 eșuate** (196 de cazuri) |
| Licențe | OK | OK (nicio dependență nouă; `package.json` și `package-lock.json` neschimbate) |
| `npm audit` | 0 vulnerabilități | 0 vulnerabilități |

**Testele sărite sunt intenționate:**
- testele care pornesc browsere proprii (închidere/redeschidere, migrare, actualizare) rulează o dată pe motor, din profilul PC;
- testul de tastatură rulează doar pe desktop;
- limita reală de spațiu se poate micșora doar în Chromium;
- WebKit din Playwright nu rulează service workers în contextele obișnuite.

### Rulări
1. **Copie curată 1 (`d8ec857`):** `npm ci --ignore-scripts`, `node scripts/build-aiw02-baseline.mjs`, `npm run verify`. Ieșire 0: 66 unitare, 159 browser.
2. **Copie curată 2** (același commit, `node_modules`, `dist`, `.baseline` și `test-results` șterse, totul reinstalat). Ieșire 0: 66 unitare, 159 browser.
3. **GitHub Actions pe `d8ec857`:**
   - `app`: succes (inclusiv construirea AIW-02 și testul de migrare);
   - `guard`: succes.
4. O rulare anterioară, înaintea reparațiilor (`3450994`), a avut un eșec în CI: defectul componentei offline la actualizare. A fost reparat și acoperit de un test nou.

### Matricea dispozitivelor (toate **simulate**; niciun dispozitiv fizic)
| Profil | Motor | Ce s-a verificat |
| --- | --- | --- |
| iPhone 15 | WebKit (motorul Safari) | toate ecranele, memoria, căutarea, propunerile, integritatea, contextul, tema întunecată, eroarea de scriere |
| iPhone SE | WebKit | la fel, pe ecran mic (fără derulare laterală, ținte ≥ 44 px) |
| Pixel 7 | Chromium | la fel |
| PC 1366×800 | Chromium | la fel, plus tastatura |
| Profil persistent Chromium | Chromium | închiderea browserului; offline real (rețea tăiată, cu probă inversă); migrarea AIW-02 → AIW-03; actualizarea N → N+1 |
| Profil persistent iPhone 15 | WebKit | închiderea browserului; migrarea AIW-02 → AIW-03; actualizarea N → N+1 |

**Pe un iPhone fizic nu s-a verificat nimic.** Lista de verificări manuale e în `AIW-03.md` §10.

### Offline și două file
- **Offline real** (Chromium): prima încărcare cu internet, browser închis complet, server oprit și orice conexiune forțată printr-un proxy inexistent, browser redeschis.
  - Aplicația pornește, 0 cereri eșuate.
  - Se creează un proiect și o intrare de memorie fără internet.
  - Proba inversă: un profil gol nu deschide aplicația.
- **Două file:** o intrare adăugată într-o filă apare în cealaltă (browser).
- **Scrieri simultane:** 15 scrieri concurente din două „file” lasă jurnalul valid (unitar).
- **O verificare a integrității în timpul unei scrieri din altă filă** nu dă alarmă falsă (unitar).

### Integritatea (teste unitare + browser)
| Situație | Rezultat |
| --- | --- |
| Editări legitime | verifică (ok) |
| Bază nouă și bază migrată din AIW-02 real | verifică (ok) |
| Versiune veche modificată | detectat (`contentModified`) |
| Eveniment șters din mijloc | detectat (`gap`) |
| Evenimente reordonate | detectat |
| Ultimele evenimente tăiate | detectat prin punctul de control (`behind`) |
| Intrare modificată direct în bază | detectat (`content:<id>`) |
| Conținutul unei versiuni vechi „șters” pe ascuns, cât intrarea încă există | detectat (`erased:<id>`) |
| Punctul de control lipsește | „verificare parțială” (nu „întreg”) |
| **Limită:** jurnalul tăiat **și** punctul de control șters | nu poate fi detectat; documentat, testat ca limită, explicat în interfață |

### Rețea și securitate
- **Nicio cerere externă** în niciun test (verificat pe toate ecranele memoriei).
- **Codul construit** nu conține funcții de rețea; singurul `fetch` e în componenta offline, doar spre propriul site.
- **CSP** neschimbată.
- **Textul utilizatorului** e afișat doar ca text; testat cu `<img onerror>` și `<script>`.
- **Nicio dependență nouă.**
- **`app.yml`:**
  - doar `fetch-depth: 0` și pasul local care construiește AIW-02;
  - drepturile rămân `contents: read`, fără secrete, fără publicare, acțiuni fixate pe SHA.

### Ce NU s-a făcut (limite respectate)
- fără îmbinări și fără modificări pe `main`;
- fără publicare;
- fără ramuri sau date șterse;
- fără schimbări de setări;
- fără API-uri, servicii plătite sau secrete;
- încercarea de a urca o etichetă git a fost refuzată de proxy-ul sesiunii; nu s-a insistat, iar eticheta locală a fost ștearsă.
