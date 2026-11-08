# AIW-07 — Poze și fișiere, voce, consiliul de modele, agentul de cod

**Stare:** cerut de Adrian pe 8 noiembrie 2026. A ales toate cele patru propuneri, de făcut pe rând. PR separat, pornit din AIW-06.1. **Neîmbinat, nepublicat.**

## 1. Poze și fișiere
- **Unde:** butonul 📎 din caseta de mesaj, sau o poză lipită direct în casetă.
- **Ce accepți:** poze, PDF, .docx și fișiere text (cod, CSV, JSON…). Cel mult 5 fișiere de mesaj, fiecare de cel mult 40 MB.
- **Totul se citește pe dispozitiv:**
  - **pozele** se micșorează (cel mult 1600 px, JPEG);
  - **PDF:** se ia textul cu pdf.js (Apache-2.0, încărcat doar când e nevoie). Dacă PDF-ul e scanat și nu are text, primele 4 pagini pleacă la model ca imagini;
  - **.docx:** textul documentului, citit cu cititorul ZIP al aplicației.
- **Ce pleacă la model:** întrebarea, urmată de textul fișierelor, și pozele ca imagini.
- **Ce se salvează în proiect:** întrebarea, cu textul fișierelor. Pozele **nu se salvează**, apar doar cu numele.
- **În discuție:** textul fișierelor e strâns sub întrebare (📎).
- **Fără întrebare:** dacă trimiți doar fișiere, întrebarea implicită e „Spune-mi pe scurt ce conține și ce e important pentru proiect”.
- **Modele care nu văd poze** (DeepSeek, modul gratuit): aplicația spune asta și nu trimite nimic.
- **Limite:** textul unui fișier, cel mult 40 000 de caractere; tot mesajul rămâne sub limita unui pas salvat.

## 2. Voce
- **🎤 Dictare:** cuvintele apar în casetă; trimiți tu.
- **🎙 Conversație cu voce (mâini libere):**
  - ascultă, trimite la pauză, citește răspunsul cu voce tare și ascultă din nou;
  - se oprește la tăcere sau când apeși butonul.
- **🔊 Citește:** pe orice răspuns. În foaia Model se poate porni „citește fiecare răspuns”.
- **De știut:**
  - **Dictarea** folosește recunoașterea vocii a browserului: Google în Chrome și Android, Apple în Safari. Aplicația nu primește și nu păstrează sunetul.
  - **Citirea cu voce tare** se face pe dispozitiv, cu vocile instalate.
  - **Fără costuri și fără chei.** Butonul nu apare unde browserul nu are recunoaștere a vocii.

## 3. Consiliul de modele ⚖
- **Ce face:** aceeași întrebare merge la 2–3 modele deodată, iar răspunsurile apar pe măsură ce vin.
- **Judecătorul:** un model ales ca judecător compară răspunsurile: unde sunt de acord, unde diferă, cine are dreptate (dacă se poate spune) și concluzia.
- **Ce se salvează:** un singur răspuns, cu secțiunile fiecărui model și concluzia. Propunerile pentru memorie vin doar de la judecător, iar modelele din consiliu sunt rugate să nu facă propuneri.
- **Dacă un model nu răspunde:** apare ca atare. Cu un singur răspuns nu există comparație.
- **Cost:** suma tuturor apelurilor. Implicit consiliul are trei modele ieftine; judecătorul e Gemini Flash-Lite.

## 4. Agentul de cod
- **Răspunsuri formatate:** titluri, liste, îngroșat, cod. Sunt construite ca elemente sigure, nu ca HTML: nimic din răspuns nu poate rula în aplicație.
- **Șablonul „⌘ Fă o aplicație”:** cere o aplicație într-un singur fișier HTML.
- **▶ Rulează:** pe orice bloc HTML, JS sau SVG, codul pornește într-o **previzualizare izolată**:
  - `sandbox.html` stă într-un `<iframe sandbox="allow-scripts">`, cu origine proprie;
  - nu vede datele aplicației, nu are internet (CSP `connect-src 'none'`), nu deschide ferestre și nu poate schimba pagina aplicației.
- **Pagina deschisă direct:** dacă cineva deschide `sandbox.html` direct sau o încadrează altfel, ea nu face nimic. Primește cod doar de la aplicație.
- **Erorile** codului apar sub previzualizare. „Cere AI-ului să repare” pune erorile în casetă, gata de trimis.
- **⇩ Descarcă:** salvează aplicația ca fișier .html.
- **CSP-ul aplicației:** `frame-src` trece de la `'none'` la `'self'`, adică doar această pagină a aplicației.

## 5. Ideea „cod QR” pentru economie (cerută de Adrian, simulată)
Am măsurat un mesaj de test cu tokenizerul o200k (cel al modelelor GPT-4o):

| Varianta | Tokeni |
|---|---|
| text normal | 119 |
| comprimat gzip, apoi scris în caractere | 239–266 |
| hex | 353 |
| coduri pe cuvânt, plus dicționarul de care AI-ul are nevoie | 411 |

**Concluzia:** comprimarea **mărește** costul. Ce economisește cu adevărat e în ⚡ Economie.

## 6. Teste
- **Unitare** (`tests/unit/attachments.test.ts`):
  - fișierele intră în mesaj, iar un bloc de cod din fișier nu poate închide blocul;
  - limitele;
  - pozele în ultimul mesaj;
  - modelele fără vedere;
  - textul pentru citirea cu voce tare.
- **În browser** (`tests/e2e/chat.spec.ts`):
  - poză, PDF și .docx citite și trimise;
  - un model fără vedere nu primește poza;
  - dictarea și conversația cu voce (recunoaștere și voce simulate);
  - consiliul cu judecător;
  - agentul de cod: rulare izolată, fără acces la baza de date și fără rețea, erori trimise la reparat;
  - `sandbox.html` deschis direct nu rulează nimic.
- **Teste vechi atinse:**
  - `build.test.ts`: pdf.js poate încărca un PDF și de la o adresă, dar aplicația îi dă doar octeții fișierului; testul verifică că fișierele lui nu conțin adrese externe;
  - `boundaries.test.ts`: pdf.js e permis doar în `ui/files.ts`;
  - `chat.spec.ts`: răspunsurile sunt acum formatate (titlurile ca titluri, îngroșat ca îngroșat).

## 7. Verificarea independentă
**Securitatea a trecut verificarea:**
- nu există ieșire din previzualizarea izolată și nu există cod injectat prin răspunsuri;
- pdf.js primește doar octeții fișierului, iar în PDF nu rulează scripturi;
- pozele refăcute prin canvas pierd datele EXIF și locația GPS.

Au fost găsite 10 probleme, toate reparate:
1. **Conversația cu voce** folosea o copie veche a ecranului (fișiere trimise din nou, fără istoric, chat nou la fiecare tură). Acum folosește mereu starea de acum.
2. **Unele expresii regulate** nu pot fi citite de iPhone-urile mai vechi, iar aplicația nu ar fi pornit deloc. Au fost rescrise.
3. **PDF-urile scanate** puteau ieși ca pagini albe. Acum aplicația aduce decodoarele pdf.js (JBIG2, JPEG 2000) și detectează paginile scanate una câte una.
4. **„Reîncearcă”** și trecerea pe modul gratuit trimiteau întrebarea fără poză. Acum întrebarea revine în casetă, cu rugămintea de a atașa poza din nou.
5. **Consiliul:**
   - costul estimat e acum suma tuturor apelurilor;
   - dacă judecătorul cade, răspunsurile modelelor (deja plătite) rămân.
6. **Citirea cu voce tare:**
   - butonul de oprire apare și la citirea automată;
   - pe iPhone, vocea e „deblocată” din atingere, iar fiecare bucată are o limită de timp;
   - conversația cu voce se oprește singură la orice eroare.
7. **Numele fișierelor** se curăță (caracterele ascunse blocau trimiterea).
8. **Textul unui fișier** pleacă din nou doar cu ultimul mesaj care avea fișiere; cele mai vechi au doar o notă scurtă.
9. **Pozele mari de pe telefon** se decodează direct micșorate.
10. **Previzualizarea** pornește o singură dată, iar mesajele de eroare sunt scurtate.

**Instalarea:** pdf.js (aproximativ 1,8 MB, plus decodoarele) **nu** e salvat pentru lucrul fără internet. Se încarcă doar când atașezi un PDF, așa că noua versiune a aplicației se instalează la fel de repede ca înainte. Testul vechi de actualizare pica tocmai din cauza mărimii lui.

**Teste:** `npm run verify`: 144 de teste unitare; în browser, 273 trecute și 41 sărite. Două teste au picat o dată (o actualizare simulată în motorul iPhone, care raportează o „eroare internă” a motorului de test, și un text care nu ajunsese încă în casetă); repetate de 4 ori, au trecut de fiecare dată.

**Compatibilitate:** citirea PDF-urilor cere Safari 17.4+ pe iPhone. Pe telefoane mai vechi apare „fișierul nu se poate citi”; restul aplicației merge.
