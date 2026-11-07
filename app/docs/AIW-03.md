# AIW-03 — Memoria proiectelor

**Stare:** implementat (misiune autonomă, 7–9 noiembrie 2026). PR #6, ciornă, **neîmbinat, nepublicat**.
Jurnalul complet al execuției și deciziile sunt în `AIW-03_EXECUTION_LOG.md`.

## 1. Ce face
Fiecare proiect are o **memorie structurată**, separată de a celorlalte. Nu e un jurnal de conversații și nici o pagină de notițe libere.
- **7 tipuri** de intrări: obiective, instrucțiuni și reguli, decizii, informații importante, context / starea actuală, probleme deschise, următorii pași.
- **4 tipuri de legături:** decurge din (`derived_from`), înlocuiește (`replaces`), rezolvă (`resolves`), legată de (`related_to`).
- Pentru fiecare intrare:
  - versiuni (o editare nu șterge versiunea veche);
  - semnul „important”;
  - proveniența (tu / propunere AI, sursa, confirmarea);
  - arhivă și restaurare; ștergere definitivă doar din arhivă, cu a doua confirmare.
- **Fluxuri explicite:**
  - înlocuirea unei decizii, cu motiv și cu confirmare (decizia veche rămâne);
  - rezolvarea unei probleme, cu o intrare existentă sau nouă (problema rămâne).
- **Căutare** în proiectul ales: titlu și text, fără diacritice. Versiunile anterioare doar la cerere; arhiva în vederea ei; propunerile, niciodată.
- **Istoric și verificarea integrității.**
- **Previzualizarea contextului pentru alt AI.** Doar previzualizare: nu există nicio integrare AI și nicio conexiune.

## 2. Arhitectura
```
ui/memory.tsx ──► memory/service.ts (MemoryStore) ─┐
ui/projects.tsx ─► projects/service.ts (ProjectStore) ─┤
                                                      ▼
                         storage/journaled.ts (JournaledStore) ← O SINGURĂ cale de scriere
                                                      │
                                   IndexedDB „aiw”, versiunea 2
                    projects · events (jurnal) · meta · memory · links
memory/context.ts (buildContext) ← funcție pură, citește doar memoria oficială
core/ (project.ts, journal.ts, memory.ts) ← reguli și formate, fără stocare
```
- **Nicio stocare nouă.** Memoria folosește baza, jurnalul, tranzacțiile, erorile și coordonarea între file din AIW-02. Calea de scriere a fost **mutată** (nu copiată) din `projects/service.ts` în `storage/journaled.ts`.
- **O schimbare = una sau mai multe intrări în jurnal + înregistrările noi, într-o singură tranzacție.**
  - Un singur scriitor între file (Web Locks), plus verificarea „jurnalul nu s-a mișcat”.
  - Orice eroare anulează tot.
  - Celelalte file se actualizează singure.
- Granițele dintre module (`src/modules.json`) sunt verificate de test: `memory → core, storage`; `projects → core, storage`.

## 3. Migrarea
- **Migrarea 2** (în `storage/db.ts`) adaugă depozitele `memory` (index `projectId`) și `links` (indexuri `projectId`, `from`, `to`), plus indexul `entityId` pe `events`. Nu modifică nicio înregistrare existentă.
- **Siguranța:** actualizarea IndexedDB rulează într-o singură tranzacție. Dacă un pas eșuează, browserul păstrează versiunea 1 cu toate datele (testat). La următoarea deschidere, migrarea se reîncearcă.
- **Evenimentele AIW-02 își păstrează amprenta:** câmpul nou `entityId` intră în amprentă doar când există.
- **Testată** cu o bază creată de **codul AIW-02 real**:
  - copia înghețată a fișierelor din `fe039c0`, în teste unitare;
  - aplicația AIW-02 construită din `fe039c0`, într-un browser real, pe motorul Chrome și pe motorul iPhone (`tests/e2e/migration.spec.ts`).
- **Revenirea:** nu există o migrare înapoi, intenționat. O versiune veche a aplicației care întâlnește baza la versiunea 2 primește o eroare clară („versiune mai veche în altă filă”) și nu atinge datele. Recuperarea sigură e exportul (AIW-04).

## 4. Modelul de date
**`MemoryEntry`** (depozitul `memory`):
| Câmp | Rol |
| --- | --- |
| `id` | `M-<uuid>`, stabil |
| `projectId` | obligatoriu; o intrare aparține unui singur proiect |
| `category` | unul din cele 7 tipuri |
| `title` (≤ 120) | titlul intrării |
| `body` (≤ 20.000) | text simplu, cu rânduri noi |
| `important` | da / nu |
| `status` | `active` · `replaced` · `resolved`; se **calculează din legături** (nu poate contrazice legăturile) |
| `archived` | arhivată / nu (separat de stare: restaurarea readuce exact starea) |
| `author` | `user` / `ai` (proveniența) |
| `source` | text, doar dacă a fost dat (niciodată inventat) |
| `confirmation` | `confirmed` / `pending` / `rejected` |
| `confirmedAt` | data confirmării |
| `createdAt`, `updatedAt` | datele |
| `version` | numărul versiunii curente |
| `v` | versiunea formatului (1) |

**Versiunile** nu sunt dublate: evenimentele `memory.created` și `memory.edited` din jurnal poartă titlul, textul și numărul versiunii. Ele sunt deja legate de lanțul de amprente.

**`MemoryLink`** (depozitul `links`): `id` (`L-<uuid>`), `projectId`, `from`, `to`, `type`, `reason`, `createdAt`, `v`.
| Relație | Sens | Reguli |
| --- | --- | --- |
| `derived_from` | A decurge din B | fără cicluri |
| `replaces` | decizia nouă → decizia veche | doar decizii; ținta devine `replaced`; fără cicluri; o decizie se înlocuiește o singură dată (și restaurarea unui înlocuitor vechi e refuzată dacă decizia a fost înlocuită între timp) |
| `resolves` | X → problema | ținta e o problemă, sursa nu; ținta devine `resolved` |
| `related_to` | A ↔ B | duplicatul e verificat în ambele sensuri |

Reguli comune:
- același proiect; fără legături cu sine; fără duplicate;
- legăturile noi sunt permise doar între intrări confirmate și nearhivate;
- la ștergerea definitivă a unei intrări, legăturile ei dispar, iar starea capătului celălalt se recalculează (o decizie al cărei înlocuitor e șters redevine activă);
- tot la ștergerea definitivă, se șterg și explicațiile **tuturor** legăturilor care au atins intrarea, inclusiv ale celor eliminate anterior.

Starea „înlocuită” sau „rezolvată” vine **doar din legături care pornesc de la intrări oficiale**: dacă înlocuitorul e arhivat, decizia veche redevine curentă, iar la restaurare redevine „înlocuită”.

**Evenimentele noi din jurnal:**
- `memory.created`, `.edited`, `.important`, `.archived`, `.restored`, `.confirmed`, `.rejected`, `.status`, `.purged`;
- `link.created`, `link.removed`.

## 5. Propunerile AI
- Pot fi create doar programatic (`MemoryStore.propose`). În AIW-03 nu există nicio integrare AI.
- Rămân `pending`: nu apar în memoria oficială, în căutare sau în context, și nu pot fi legate.
- Au o vedere proprie, „De confirmat”, unde utilizatorul le poate:
  - **confirma:** devin oficiale; data confirmării se păstrează, iar autorul rămâne „propunere AI”;
  - **respinge:** sunt arhivate, nu pot fi restaurate în memorie și pot fi șterse definitiv.

## 6. Integritatea — ce garantează și ce NU
- **Mecanismul:**
  - fiecare eveniment are amprenta SHA-256 a celui anterior, iar conținutul are amprentă separată (poate fi șters definitiv fără ruperea lanțului);
  - după fiecare scriere, ultimul `{seq, hash}` se salvează ca **punct de control** în `localStorage`, în afara IndexedDB;
  - `verify` mai verifică dacă textul curent al fiecărei intrări e identic cu ultima ei versiune din jurnal, dacă fiecare legătură are ambele capete și dacă fiecare stare corespunde legăturilor.
- **Detectează** (testat):
  - o versiune veche modificată;
  - un eveniment șters din mijloc;
  - evenimente reordonate;
  - ultimele evenimente tăiate (prin punctul de control);
  - o intrare modificată direct în bază.
- **NU detectează** (documentat și testat ca limită): pe cineva cu acces complet la dispozitiv care rescrie consecvent tot jurnalul **și** punctul de control (sau care șterge punctul de control și taie ultimele evenimente). Un lanț păstrat pe același dispozitiv nu poate fi o dovadă absolută. Interfața spune asta explicit.

## 7. Contextul pentru alt AI (pregătire pentru AIW-05)
`buildContext(proiect, intrări, legături, { maxChars = 24000, includeClosed = false })`:
1. **Doar memoria oficială** (confirmată și nearhivată). Propunerile, intrările respinse și cele arhivate sunt excluse, apar în `omitted` cu motivul lor.
2. **Deciziile înlocuite, problemele rezolvate și pașii făcuți** sunt excluși, cu excepția cazului `includeClosed`.
3. **Ordinea secțiunilor:**
   1. instrucțiuni;
   2. obiective;
   3. context;
   4. decizii;
   5. informații;
   6. probleme;
   7. pași.

   În fiecare secțiune: important, apoi cel mai recent, apoi `id`.
4. **Limita** se măsoară pe ce ar primi AI-ul (proiect + secțiuni). Intrările se scot pe rând, de la cea mai puțin importantă:
   - întâi cele neimportante, apoi cele importante;
   - secțiunile de la coadă spre cap; în secțiune, de jos în sus;
   - instrucțiunile la urmă.

   Fiecare intrare scoasă apare în `omitted` cu motivul `sizeLimit`.
5. **Doar intrările proiectului dat**, indiferent ce primește funcția.
6. **Ieșire deterministă** (aceleași date = aceeași ieșire, octet cu octet, testat), cu `id`-uri stabile și proveniență. Memoria nu se modifică (testat).

## 7b. Actualizările aplicației (constatat la testare)
Aplicația funcționează fără internet, deci păstrează versiunea pe dispozitiv. După o actualizare, **prima deschidere poate arăta încă versiunea veche**; versiunea nouă preia controlul la una dintre deschiderile următoare (măsurat: 1–3 deschideri). Abia atunci rulează migrarea; datele nu sunt atinse între timp (testat).

**Recomandare pentru AIW-07 (publicare):** un mesaj „Versiune nouă disponibilă — reîncarcă”.

## 8. Teste
Lista exactă și rezultatele sunt în `AIW-03_EXECUTION_LOG.md`, secțiunea „Raport de testare”.
- **Teste unitare** (`npx vitest run`): migrare, izolare, intrări și versiuni, proveniență, relații, integritate, căutare, context.
- **Teste în browser** (`npx playwright test`), pe iPhone 15 și iPhone SE (WebKit), Pixel 7 (Chromium) și PC:
  - toate cele 7 tipuri; validare; versiuni; arhivă și ștergere; înlocuire; rezolvare; legături; căutare;
  - propuneri; text periculos; izolare; tabul Memorie; cardul de pe pagina proiectului;
  - integritate; context; tastatură; două file; tema întunecată; eroare de scriere;
  - închiderea browserului; fără internet; migrarea din aplicația AIW-02 reală.

## 9. Limite cunoscute
- **Spațiul plin** e simulat în pagină (aceeași eroare `QuotaExceededError` pe care o dă browserul), pe toate motoarele. Limita reală de spațiu se poate micșora doar în Chromium (testat în AIW-02).
- **Fără internet după actualizare:** motorul WebKit din teste nu rulează service workers. Pe iPhone, funcționarea fără internet și scutirea aplicației adăugate pe ecranul principal se verifică **manual** (lista de mai jos).
- **Testele „iPhone” sunt simulări** (motorul WebKit din Playwright, cu dimensiunile iPhone), nu un iPhone fizic.
- **Integritatea** nu e o dovadă absolută (secțiunea 6).
- **Textele lungi** nu au formatare (decizie aprobată: text simplu).

## 10. Verificări manuale pentru Adrian (înainte de publicare)
1. **Pe un iPhone real, în Safari:**
   - creează un proiect, adaugă câte o intrare de fiecare tip, înlocuiește o decizie, rezolvă o problemă;
   - închide Safari complet, redeschide: totul e acolo.
2. **Același iPhone, aplicația adăugată pe ecranul principal:**
   - memoria creată în Safari NU apare (spații separate, avertizarea o spune);
   - creează o intrare acolo, oprește internetul (mod avion), redeschide aplicația: merge și intrarea e acolo.
3. **Pe Android (Chrome) și pe PC:** aceiași pași; în plus, deschide aplicația în două file și adaugă o intrare într-una: apare în cealaltă.
4. **În Istoric și verificare:** „Verifică acum” dă „Istoricul e întreg”.
5. **Tema întunecată a telefonului:** ecranele memoriei se citesc bine.
