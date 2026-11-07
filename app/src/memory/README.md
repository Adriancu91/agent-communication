# memory

Memoria proiectelor (AIW-03): intrări pe 7 tipuri, legături de 4 tipuri, versiuni, proveniență, propuneri AI, verificarea integrității și pregătirea contextului pentru alte AI-uri.

- `service.ts` — `MemoryStore`, toate operațiile, prin **calea comună de scriere** (`storage/journaled.ts`):
  - **Intrări:**
    - creare de către utilizator (oficială imediat), propunere AI (`propose`, rămâne „în așteptare”), confirmare / respingere;
    - editare cu versiune nouă, important, arhivare / restaurare;
    - ștergere definitivă (doar din arhivă).
  - **Legături:** `link`, `unlink`, `replaceDecision` (înlocuirea explicită a unei decizii), `resolveIssue` (rezolvarea unei probleme cu o intrare existentă sau nouă).
  - **`verify(projectId)`:** lanțul jurnalului + punctul de control + consistența memoriei cu istoricul ei.
- `context.ts` — `buildContext`: vedere deterministă, doar din memoria oficială, cu ordine fixă, prioritate pentru „important”, limită de mărime și raport de omisiuni. Nu modifică memoria. Nu trimite nimic.

**Depinde de:** `core`, `storage`.

**Teste:**
- `tests/unit/memory.test.ts`: migrare, izolare, versiuni, proveniență, relații, integritate, căutare, context;
- `tests/e2e/memory.spec.ts`, `tests/e2e/migration.spec.ts`.
