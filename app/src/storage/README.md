# storage

Stocarea pe dispozitiv: IndexedDB, printr-un strat subțire scris de noi (fără bibliotecă).
- `db.ts`:
  - deschiderea bazei `aiw`, cu **migrări numerotate** (etapele următoare își adaugă depozitele aici, fără să le atingă pe cele vechi);
  - erorile browserului, traduse în câteva tipuri clare: `quota` (spațiu insuficient), `unavailable`, `blocked`, `closed`, `conflict`;
  - `exclusive()`: un singur scriitor odată, chiar cu mai multe file deschise (Web Locks).
- `journaled.ts` (AIW-03):
  - **singura cale de scriere**, comună pentru `projects` și `memory`: una sau mai multe intrări în jurnal + înregistrările noi, într-o singură tranzacție (totul sau nimic);
  - un singur scriitor între file; celelalte file sunt anunțate;
  - verificarea integrității: lanțul de amprente + un **punct de control** `{seq, hash}` păstrat în `localStorage`, în afara bazei de date.
- **Migrarea 2** (AIW-03): depozitele `memory` și `links`, plus indexul `entityId` pe `events`. Nu modifică nimic din datele existente. Dacă un pas eșuează, browserul păstrează versiunea 1 neatinsă.
- `persistence.ts`: cererea de stocare persistentă, starea ei și spațiul folosit.

**De ce IndexedDB:**
- ține date structurate și mari (proiecte, iar mai târziu conversații și fișiere);
- tranzacțiile salvează totul sau nimic;
- merge pe iPhone, Android și PC.

`localStorage` e mic, sincron și doar text; nu e potrivit pentru proiecte.

Depinde de: nimic (primește și întoarce obiecte simple). Teste: `tests/unit/projects.test.ts` (cu IndexedDB simulat), plus testele din browser.
