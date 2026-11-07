# AIW-01 — Fundația aplicației și interfața

## Scop
Scheletul aplicației AI Workspace: construire, interfață pentru iPhone/Android/PC, română/engleză, funcționare fără internet după prima încărcare, politica de securitate și testele. Fără date ale utilizatorului încă.

## Pași (făcuți)
1. Vite + TypeScript + Preact, cu versiuni fixe (`package-lock.json`).
2. Interfața, gândită întâi pentru iPhone:
   - bară de taburi jos; zonele sigure (breton, bara de jos);
   - `100dvh`; ținte ≥ 44 px; text de 17 px;
   - temă după telefon; pe ecrane late, bară laterală.
3. Navigare prin `#/ruta`: butonul Înapoi merge, iar GitHub Pages nu dă niciodată 404.
4. Texte în română și engleză, cu aceleași chei (verificat).
5. Service worker propriu, generat la construire cu lista exactă a fișierelor. Doar același site, fără nimic din afară.
6. CSP strictă în `index.html`. `referrer: no-referrer`.
7. Setări:
   - limba;
   - „Datele tale”;
   - avertizarea de backup (mereu vizibilă);
   - starea fără internet;
   - adăugarea pe ecranul principal (opțională, cu pașii pentru iPhone și Android);
   - versiunea.
8. Harta granițelor dintre module (`src/modules.json`) și testul ei.
9. Verificarea licențelor; workflow-ul `app.yml` (doar teste, doar citire, acțiuni fixate pe SHA).

## Fișiere
`app/` (tot), `.github/workflows/app.yml`.

## Test
- `npm run verify` în `app/`.
- **8 teste unitare + 24 de teste în browser**, pe 4 ecrane: iPhone 15, iPhone SE, Pixel 7, PC 1366×800. Verifică:
  - toate ecranele se deschid fără erori și fără nicio cerere în afara site-ului;
  - nimic nu se derulează lateral; toate butoanele au ≥ 44 px;
  - bara e jos pe telefon și laterală pe PC;
  - limba se schimbă și se ține minte;
  - CSP blochează o cerere spre alt site;
  - **cu serverul oprit de tot**, aplicația se redeschide și navighează;
  - adăugarea pe ecranul principal e opțională; avertizarea de backup e vizibilă.

**Găsit și reparat în timpul testelor:**
- Serverele trimit `Vary: Origin`, iar fără `ignoreVary` aplicația **nu** pornea fără internet pe niciun telefon. Testul care a găsit problema rămâne, plus un test unitar.
- Pe capturile de iPhone, textul se vedea prin bara de jos (semi-transparentă). Acum bara e opacă, iar un test verifică asta.

## Limite cunoscute
- Testul fără internet nu rulează pe motorul WebKit în Playwright (nu suportă service workers în teste). Pe iPhone se verifică manual înainte de publicare (AIW-07).
- Ecranele Proiecte, Memorie, Continuitate și Lansator sunt goale, marcate „În pregătire”.
- Nu e publicată nicăieri. Publicarea pe GitHub Pages vine în AIW-07, cu aprobarea lui Adrian.

## Riscuri
- Versiuni noi de Vite/TypeScript pot schimba comportamentul: versiunile sunt fixe; actualizările se fac doar prin PR.
- Safari poate șterge datele: avertizarea există deja; backupul vine în AIW-04.

## Surse
- WebKit: limita de 7 zile pentru datele site-urilor nevizitate și scutirea aplicațiilor de pe ecranul principal (webkit.org/blog/10218).
- MDN: Service Worker API, `Cache.match` (opțiunea `ignoreVary`), CSP.

## Verificarea finală (cerută de Adrian și Gepeto, 7 noiembrie 2026)
Testele noi sunt în `tests/e2e/verify.spec.ts` și `tests/unit/build.test.ts` și rulează la fiecare PR.

1. **Unde stau datele.** După folosirea tuturor ecranelor și schimbarea limbii, pe dispozitiv există doar:
   - `localStorage`: `aiw.lang` (limba aleasă);
   - cache-ul aplicației `aiw-…`, care conține fișierele aplicației, nu date.

   Nu există cookie-uri, `sessionStorage` sau baze de date (IndexedDB). Toate cererile din sesiune sunt `GET` spre adresa proprie a aplicației: 3 fișiere (pagina, codul, stilurile), nimic încărcat spre un server. Codul construit nu conține nicio funcție de rețea, iar CSP blochează orice alt site.
2. **Fără internet, scenariu real**, testat automat în Chromium (Chrome / Edge / Android):
   1. prima încărcare cu internet;
   2. **închiderea completă a browserului**;
   3. serverul oprit **și** rețeaua tăiată (toate conexiunile forțate printr-un proxy mort);
   4. redeschiderea browserului cu același profil.

   Aplicația se deschide, toate cele 5 ecrane merg, limba e păstrată: 3 cereri, 0 eșuate. **Proba inversă:** cu un profil gol și rețeaua tăiată, aplicația NU se deschide (`ERR_PROXY_CONNECTION_FAILED`), chiar cu serverul pornit. Deci tăierea rețelei e reală, iar aplicația vine de pe dispozitiv.
3. **Toate resursele offline:** tot ce a cerut aplicația online se află în cache, iar cache-ul conține exact lista generată la construire (pagina, cod, stiluri, manifest, iconițe, licențe).
4. **Riscuri de pierdere a datelor:** azi nu există date de pierdut (doar limba). Textele din Setări descriu corect comportamentul actual. Riscuri pentru etapele următoare: vezi planul AIW-02 (pe iPhone, datele din Safari și cele din aplicația de pe ecranul principal sunt **separate**).
5. **Dependențe și Actions:**
   - în aplicație intră doar `preact` (MIT); 86 de pachete servesc doar la construire și teste, toate cu licențe permisive;
   - `npm audit`: 0 vulnerabilități; toate pachetele vin din registry.npmjs.org;
   - `app.yml`: drepturi doar de citire, fără secrete, fără publicare, `npm ci --ignore-scripts`, acțiuni fixate pe SHA (reverificate).

**Schimbări făcute la verificare** (fără schimbări de design):
- s-a oprit un mic cod standard al Vite care putea face cereri (doar spre propriile fișiere), inutil aici;
- s-a adăugat `licenses.txt` cu licența bibliotecilor incluse (licența MIT cere ca notificarea să însoțească codul, iar minificarea șterge comentariile).

**Limită:** pe iPhone (Safari), funcționarea fără internet se verifică manual după prima publicare de test (AIW-07), deoarece motorul WebKit din testele automate nu rulează service workers.
