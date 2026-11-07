# AI Workspace (`app/`)

Aplicație web pentru telefon și PC: proiecte, memorie pe proiect și continuitate între AI-uri.
Statică (GitHub Pages), local-first, fără server, fără API-uri, fără servicii plătite. Nume provizoriu; licență proprietară.

## Starea: AIW-02 (managerul de proiecte), peste AIW-01 (fundația)
AIW-02: proiecte salvate pe dispozitiv (creare, deschidere, editare, istoric de nume, fixare, căutare, ordonare, Coș cu restaurare, ștergere definitivă cu a doua confirmare), stocare persistentă cerută și raportată cinstit, avertizarea pentru iPhone. Detalii: `docs/AIW-02.md`.

### AIW-01
- Interfața de bază, gândită întâi pentru iPhone:
  - bară de taburi jos, cu zonele sigure ale ecranului;
  - ținte de atingere de cel puțin 44 px;
  - text de 17 px; temă deschisă/întunecată după telefon.
- Pe PC, bara devine laterală.
- Ecranele: Proiecte, Memorie, Continuitate, Lansator, Setări. Primele patru sunt goale până la etapele următoare.
- Română / engleză, alegerea se ține minte.
- Funcționează fără internet după prima încărcare (service worker propriu, doar fișierele aplicației).
- Adăugarea pe ecranul principal e opțională; avertizarea de backup apare mereu în Setări.
- Securitate:
  - CSP strictă: doar propriul site, fără scripturi străine, fără `unsafe-inline`/`eval`, fără încadrare;
  - nicio conexiune externă.

## Comenzi (în `app/`)
| Comandă | Ce face |
| --- | --- |
| `npm ci` | instalează exact versiunile din `package-lock.json` |
| `npm run dev` | server local de lucru |
| `npm run build` | construiește în `dist/` |
| `npm test` | teste unitare (texte RO/EN, granițe între module, CSP, lista fișierelor fără internet) |
| `npm run e2e` | teste în browser: iPhone 15 și iPhone SE (motorul Safari), Android, PC |
| `npm run licenses` | verifică licențele tuturor pachetelor (doar permisive) |
| `npm run verify` | toate de mai sus |

## Structura
- `src/main.tsx` — pornirea.
- `src/core/` — formatul proiectului și jurnalul (funcții pure).
- `src/storage/` — IndexedDB, migrări, erori, stocare persistentă.
- `src/projects/` — operațiile cu proiecte.
- `src/ui/` — interfața.
- `src/modules.json` — ce module pot importa ce module (verificat de test).
- Modulele următoare (`memory`, `continuity`, `archive`, `launcher`, `security`) apar în etapele lor.

## Dependențe
- În aplicație: doar `preact` (MIT).
- Pentru construire și teste: `vite`, `vitest`, `typescript`, `@playwright/test`, `@types/node`, `fake-indexeddb` (MIT / Apache-2.0).
- Verificate automat de `npm run licenses`.
