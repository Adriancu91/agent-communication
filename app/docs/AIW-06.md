# AIW-06 — Chat AI în aplicație (prin Puter) și interfața nouă

**Stare:** implementat la cererea lui Adrian (8 noiembrie 2026): „Rămâne cu Puter … fă o interfață mai profi, mai colorată, mai atrăgătoare, mai automatizată, prompturi predefinite și setări de economie de tokeni”. PR separat, pornit din AIW-05.1. **Neîmbinat, nepublicat.**

## 1. Ce face
- **Tab nou „Chat”:** alegi proiectul și modelul, scrii (sau alegi un șablon), iar răspunsul apare aici, scris pe măsură ce vine. Nu mai copiezi și nu mai lipești nimic.
- **Conectarea, o singură dată:**
  - butonul „Conectează-te la Puter” deschide fereastra Puter;
  - contul e gratuit și primește credit de început;
  - nu există nicio cheie de copiat;
  - aplicația nu vede parola și nu păstrează nicio cheie.
- **Plata:** fiecare mesaj se plătește din contul Puter al utilizatorului („user-pays”), nu prin aplicație. Aplicația nu are costuri.
- **Memoria proiectului ca context:**
  - modelul primește doar memoria **oficială** (confirmată), niciodată propunerile neconfirmate;
  - dacă modelul propune ceva (decizie, pas, problemă), apare cardul „N propuneri pentru memorie” → „Revizuiește și salvează”, adică aceeași revizuire ca la AIW-05;
  - **memoria oficială se schimbă tot doar prin decizia ta;**
  - până revizuiești, mesajul următor așteaptă, ca propunerile să nu se piardă.
- **Totul se salvează în proiect:** întrebările și răspunsurile intră în jurnal, la Continuitate și în export (arhiva, versiunea 3).
- **Schimbi modelul în mijlocul discuției:** conversația continuă într-un chat nou, legat de cel vechi, cu același istoric.
- **Erori explicate:** neconectat, credit terminat, fără internet, model indisponibil. Butonul „Reîncearcă” nu salvează întrebarea de două ori. „Oprește” întrerupe răspunsul.

## 2. Modele
O listă scurtă, aleasă din cele ~1000 oferite de Puter. Fiecare model are un semn de preț, „$ / $$ / $$$”, după prețurile Puter din 8 noiembrie 2026.

| Categorie | Modele |
|---|---|
| economice | Gemini 2.5 Flash-Lite (implicit), GPT-5 nano, Mistral Small, Claude Haiku 5.5, DeepSeek V4.1 Flash |
| echilibrate | GPT-5.4 mini, Gemini 3.5 Flash |
| puternice | Claude Sonnet 5.5, Gemini 2.5 Pro, GPT-5.4 |

Orice alt model Puter se poate scrie cu numele exact.

## 3. Economia de tokeni
Fiecare apel la model e „fără memorie”: contextul și o parte din conversație se trimit din nou la fiecare mesaj. Setările (butonul „⚡ Economie”) aleg cât se trimite.

| Setare | Variante |
|---|---|
| **Memoria trimisă** | completă (pachetul de la AIW-05) · **compactă** (un tabel cu câmpurile numite o singură dată, ideea formatului TOON, scrisă de la zero) · doar „Important” · deloc |
| **Stilul răspunsului** | normal · scurt · **telegrafic** (ideea „caveman”: fără umplutură; numele, cifrele și codul rămân exacte) |
| **Mesaje anterioare trimise** | 0 / 2 / 4 / 8 / 16 |
| **Lungimea maximă a răspunsului** | fără limită / 600 / 1200 / 2500 tokeni; la modelele care „gândesc”, efort de gândire redus |
| **Propuneri pentru memorie** | da / nu (instrucțiunile lor costă câteva sute de tokeni pe mesaj) |

**Trei preseturi:** Maximă · Echilibrată (implicit) · Calitate.

Sub caseta de mesaj apar, înainte de trimitere:
- estimarea tokenilor;
- „−N% față de modul complet”;
- costul aproximativ.

**Măsurat** pe un proiect de probă (28 de informații, 16 mesaje anterioare), în tokeni trimiși pe mesaj:

| Preset | Tokeni | Față de Calitate |
|---|---|---|
| Calitate | ≈2900 | — |
| Echilibrată | ≈2200 | −24% |
| Maximă | ≈880 | −70% |

La răspuns se adaugă economia din stilul scurt sau telegrafic. Tabelul compact singur câștigă puțin când informațiile au texte lungi. Câștigul mare vine din fereastra de istoric, din „doar Important” și din răspunsurile scurte.

## 4. Șabloane
- **Gata făcute** (RO/EN): Rezumat, Pașii următori, Verifică deciziile, Riscuri, Plan pe etape, Explică simplu, Raport, Extrage din text.
- **Pe ecranul gol:** patru carduri de început trimit cererea dintr-o atingere.
- **În caseta de mesaj:** șabloanele doar completează textul (nimic nu se trimite, deci nu costă, fără confirmarea ta).
- **„Șabloanele mele”:** până la 30, păstrate pe dispozitiv.

## 5. Interfața nouă
- Culori „aurora” (indigo → violet → roz), în tema deschisă și în cea întunecată.
- Titluri cu degradeu, carduri cu umbră fină, butoane principale colorate.
- Bara de taburi cu indicator colorat, plus o siglă în bara laterală (pe calculator).
- Tot ce era verificat rămâne verificat:
  - bara de taburi opacă;
  - butoane de cel puțin 44 px;
  - fără derulare laterală, pe iPhone, iPhone SE, Android și PC, inclusiv în chat.

## 6. Securitate și date
- **Puter.js** (Apache-2.0, versiunea 2.6.5):
  - e inclus **neschimbat** în `vendor/puter/puter.js`;
  - amprenta SHA-256 e verificată la construire și în teste;
  - se încarcă doar când deschizi Chatul, nu și pentru lucrul fără internet;
  - licențele lui și ale bibliotecilor din el sunt în `licenses.txt`.
- **CSP:** `connect-src` permite în plus exact `https://api.puter.com wss://api.puter.com`. Nimic altceva (fără `unsafe-inline`, fără `*`).
- **Textul „Datele tale”** din Setări spune acum clar ce pleacă la Puter și când: doar în Chat, doar dacă îl folosești, doar memoria oficială în forma aleasă.
- **Setările de chat și șabloanele proprii** stau pe dispozitiv (localStorage), nu în proiect. Un răspuns cu propuneri nerevizuite stă tot acolo până îl revizuiești.

## 7. Tehnic
| Unde | Ce |
|---|---|
| `src/chat/` (modul nou, funcții pure) | `models.ts`, `economy.ts` (mesajul de sistem, tabelul compact, fereastra de istoric, opțiunile apelului, estimări), `prompts.ts` |
| `src/ui/puter.ts` | încărcarea Puter.js, conectarea, apelul cu răspuns pe bucăți, oprirea, clasificarea erorilor |
| `src/ui/chat.tsx` | ecranul și foile Model, Economie, Șabloane, Istoric, Cont |
| `core/session.ts` | furnizorul `inapp` (numele = modelul) și pasul `ask` (întrebarea, cu amprenta contextului trimis) |
| `SessionStore` | `startChat()`, `ask()`; răspunsul se salvează cu `applyReply()`, ca înainte |
| Arhiva, **versiunea 3** | aceeași formă ca 2, plus chaturile; doar proiectele cu chat se scriu în versiunea 3; o arhivă 1 sau 2 se citește în continuare; o arhivă 2 care pretinde că are chaturi e refuzată |
| `vite.config.ts` | copiază `vendor/puter.js` în build și îl scoate din lista offline |

## 8. Capturi de ecran
`docs/screenshots/AIW-06-*.png`:
- iPhone: conectarea, chatul gol, discuția cu propuneri, Economia, modelele;
- PC: discuția, Economia, Memoria.

## 9. Teste
- **Unitare** (`tests/unit/chat.test.ts`, 17):
  - tabelul compact: doar memoria oficială, referințele, escaparea;
  - „doar Important”, „deloc”, stilurile;
  - citirea propunerilor prin referințele compacte;
  - fereastra de istoric și unirea mesajelor;
  - opțiunile apelului, setările, prețurile, șabloanele;
  - chaturile în proiect: ordinea, regulile, continuarea cu alt model;
  - exportul și importul la versiunea 3, plus refuzul chaturilor într-o arhivă 2;
  - amprenta Puter.js.
- **În browser** (`tests/e2e/chat.spec.ts`, 10 × 4 dispozitive). Puter e **simulat**: niciun apel real, iar orice cerere spre exterior pică testul. Testele verifică:
  - conectarea și răspunsul pe bucăți;
  - salvarea și reîncărcarea;
  - propunerile → revizuirea → memoria oficială;
  - preseturile și schimbarea modelului;
  - eroarea „credit terminat” și „Reîncearcă”;
  - șabloanele;
  - așezarea pe ecran, în tema deschisă și în cea întunecată;
  - răspunsul care sosește după schimbarea chatului;
  - reîncercarea după schimbarea modelului;
  - un răspuns partajat din afară nu ajunge într-un chat din aplicație.
- **Teste vechi atinse**, fiecare cu comentariu:
  - `build.test.ts`: CSP-ul permite exact originea Puter aprobată, iar `vendor/puter.js` e singurul fișier lăsat în afara listei offline;
  - `memory.spec.ts`: tema întunecată are acum alt fundal, iar testul verifică în continuare că e întunecat.

## 10. Verificarea independentă
O verificare separată a codului a găsit 9 probleme reale și 4 mai mici. Toate au fost reparate, iar pentru cele importante există teste noi:

| # | Problema | Rezolvarea |
|---|---|---|
| 1 | Un răspuns care sosea după ce treceai la alt chat apărea în chatul greșit, iar propunerile lui puteau fi acceptate de două ori | Răspunsul stă la chatul lui; e oferit la revizuire doar dacă întrebarea lui e încă ultimul pas |
| 2 | „Reîncearcă” după schimbarea modelului sau a memoriei trimitea alt context decât cel înregistrat | Reîncercarea merge doar cu același model și același context; altfel întrebarea revine în casetă |
| 3 | Un răspuns partajat dintr-o aplicație AI putea ajunge într-un chat din aplicație | Chaturile din aplicație nu mai apar în „Răspuns primit”. Un chat se poate închide sau redeschide din pagina sesiunii |
| 4 | Alegerea unui chat din Istoric uneori nu făcea nimic | Reparat |
| 5 | Enter și cardurile de început puteau trimite înainte să se încarce memoria și chaturile | O singură verificare, „gata de trimis”, pentru toate căile |
| 6 | Erorile de conectare apăreau ca „necunoscute” | Mesaje proprii pentru fereastră blocată, fereastră închisă, cont care cere o acțiune și prea multe cereri |
| 7 | Butonul contului putea porni conectarea înainte să se încarce Puter | Butonul așteaptă încărcarea |
| 8 | Cu „propuneri: nu”, propunerile din modul complet se pierdeau | Nu se mai pierd. În modul complet, instrucțiunile fac parte din pachet, iar comutatorul arată asta |
| 9 | Două file deschise puteau revizui același răspuns de două ori | Filele se sincronizează. Revizuirea e oferită doar cât întrebarea e ultimul pas |

**Mai mici:**
- un proiect fără chat se exportă tot în versiunea 2, ca versiunea anterioară a aplicației să-l poată citi;
- conectarea nu mai creează conturi Puter temporare;
- efortul de gândire e „low”, acceptat de toate modelele;
- derularea nu te mai trage în jos cât citești mai sus;
- caseta de mesaj apare abia după conectare, ca să nu acopere butonul de conectare pe ecrane mici.

**Rezultat:**
- `npm run verify`: 131 de teste unitare;
- în browser, 230 trecute și 41 sărite (WebKit, ca înainte);
- un test vechi a picat o dată pe iPhone SE (`trash with confirmation…`: o măsurătoare de poziție în timpul unei animații); repetat de 5 ori, a trecut de fiecare dată.

## 11. Limitări cunoscute
- **Ferestrele proprii ale Puter** („credit scăzut”, confirmarea e-mailului) pot apărea fără stil: CSP-ul aplicației interzice stilurile scrise direct în pagină și nu l-am slăbit pentru ele. Mesajele aplicației explică oricum situația.
- **Pe iPhone, browserul poate bloca fereastra de conectare** dacă nu pornește direct din atingere. Aplicația spune atunci ce să faci.

## 12. Ce nu pot verifica eu
- **Conectarea reală la Puter și un mesaj real**, din mediul meu de lucru. Le testează Adrian pe telefon și pe PC după publicare.
- **Creditul gratuit de început:** cât e și cât ține depinde de Puter și se poate schimba.
- **Prețurile din listă** sunt orientative, din 8 noiembrie 2026.
