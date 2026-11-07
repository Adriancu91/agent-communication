# AIW-05 — Continuitate AI

**Stare:** implementat (misiune autonomă AIW-04 + AIW-05, 7 noiembrie 2026). PR separat, pornit din AIW-04. **Neîmbinat, nepublicat.**

## 1. Ce am cercetat și ce am decis
Am verificat sursele oficiale (noiembrie 2026):

| Variantă | Cost real | Problemă | Decizie |
| --- | --- | --- | --- |
| API ChatGPT (OpenAI) | plătit separat; **nu** e inclus în ChatGPT Plus (pagina de ajutor OpenAI) | cost, cheie API | **nu** |
| API Claude (Anthropic) | plătit separat; abonamentele Pro/Max **nu** includ API (pagina de ajutor Anthropic) | cost, cheie API | **nu** |
| API Gemini, nivel gratuit | 0 lei, dar cu limite | pe nivelul gratuit, Google folosește textele trimise ca să-și îmbunătățească produsele, iar oamenii lor le pot citi; cere o cheie API | **nu** (confidențialitate + misiunea interzice chei) |
| Link care deschide AI-ul cu textul gata pus (`claude.ai/new?q=`, extensii pentru ChatGPT) | 0 | nedocumentat oficial, s-a mai stricat; pune memoria proiectului în adresa paginii (istoricul browserului) | **nu** |
| AI-ul local din Chrome (Prompt API, Gemini Nano) | 0, fără cheie | doar Chrome pe calculator (nu iPhone), descarcă un model de ~4 GB | **etapă viitoare, opțional** |
| **Transfer manual de context** | 0 | un pas de copiere și unul de lipire | **da** |

Nu am construit nimic care ocolește autentificarea, limitele sau condițiile furnizorilor. **Nu transferăm sesiunea internă a unui furnizor**: transferăm contextul proiectului.

## 2. Fluxul (Lansator → Continuitate)
1. **Alege proiectul** (implicit: ultimul folosit).
2. **Alege asistentul:** ChatGPT, Claude, Gemini sau „Alt AI” (scrii numele, de exemplu Mistral). Butonul spune exact ce face: deschide site-ul asistentului într-o filă nouă.
3. **Ce lucrezi:** sarcina (opțional), câte răspunsuri salvate includ (niciunul / ultimul / ultimele 3), deciziile înlocuite și problemele rezolvate (opțional), mărimea maximă (8.000–96.000 de caractere).
4. **Pachetul:** vezi câte informații intră, ce rămâne deoparte și de ce, și textul complet. Apoi „Copiază pachetul și pornește sesiunea” sau „Descarcă pachetul (.md)”. Dacă browserul refuză copierea, textul apare gata selectat, pentru copiere manuală.
5. **Lucrează:** „Deschide Claude într-o filă nouă” (doar adresa site-ului, fără nimic în ea), apoi lipești pachetul ca prim mesaj.
6. **Adu rezultatul înapoi:** în pagina sesiunii apeși „Adaugă răspunsul AI”, lipești răspunsul, apoi „Analizează”.
7. **Confirmi:** pentru fiecare propunere alegi **Acceptă** (devine oficială), **Respinge** (rămâne în arhivă) sau **De decis** (rămâne în Memorie → Propuneri). Poți modifica tipul, titlul și textul înainte.
8. **Continuă cu alt AI:** din sesiune, Lansatorul se deschide pentru același proiect, cu alt asistent sugerat și cu ultimul răspuns inclus. Noua sesiune păstrează legătura cu cea veche.

**Memoria oficială nu e modificată niciodată automat de AI.**

## 3. Pachetul de continuitate (`src/continuity/pack.ts`)
Text Markdown, citibil de orice AI, în limba aplicației (română / engleză):
- titlul, data, asistentul;
- **instrucțiunile pentru AI:** e contextul oficial, confirmat; nu are conversațiile anterioare; să spună explicit ce pare greșit sau învechit; să întrebe ce lipsește; cum să-și scrie propunerile;
- **formatul propunerilor:** un singur bloc ` ```aiw-propuneri ` cu JSON (tip, titlu, text, important, `inlocuieste` + `motiv`, `rezolva`);
- descrierea proiectului; secțiunile **Obiective, Instrucțiuni și reguli, Context, Decizii confirmate, Informații importante, Probleme deschise, Pașii următori**;
- fiecare informație are o **referință scurtă** (G1, I2, D1, F3, C1, P1, S2), plus legăturile dintre ele („decurge din F1”, „înlocuită de D2”);
- sarcina sesiunii; opțional, ultimele răspunsuri salvate (marcate „doar pentru context”).

**Fără contradicții și fără propuneri:** se folosește aceeași regulă ca la previzualizarea contextului din AIW-03. Intră doar memoria oficială (confirmată, nearhivată). Deciziile înlocuite, problemele rezolvate și pașii făcuți intră doar la cerere. Propunerile neconfirmate și cele respinse nu intră niciodată.

**Limita de mărime:** întâi pleacă răspunsurile salvate (cele mai vechi), apoi informațiile cele mai puțin importante, în aceeași ordine ca previzualizarea contextului. Tot ce a fost lăsat deoparte e listat pentru utilizator.

**Fișiere și documente:** aplicația încă nu stochează fișiere, deci pachetul nu le poate include. Le atașezi direct în conversația cu AI-ul. E o limitare documentată.

## 4. Citirea răspunsului (`src/continuity/reply.ts`)
1. **Blocul standard** (` ```aiw-propuneri ` sau ` ```aiw-proposals `): JSON citit tolerant (virgule finale, ghilimele tipografice); se acceptă chei în română și în engleză.
2. **Fără bloc:** se citesc secțiunile scrise de AI („**Decizii:**”, „## Next steps”, „Probleme deschise:”) și punctele de sub ele. Interfața cere verificare atentă.
3. **Comparația cu memoria:** fiecare propunere e marcată
   - „există deja” (același tip și același titlu), cu „Respinge” ales implicit;
   - „seamănă cu …”;
   - nouă.

   O decizie care înlocuiește explicit decizia D1 nu e marcată „seamănă”, pentru că seamănă firesc cu ea.
4. **Referințele (D1, P1)** sunt traduse în informațiile reale ale pachetului trimis în acea sesiune. Relațiile imposibile (înlocuirea unei informații care nu e decizie, o referință necunoscută) sunt ignorate și semnalate.
5. **Titlurile prea lungi** sunt tăiate la o propoziție, iar restul trece în „Text”.

## 5. Datele (migrarea 3, doar adăugare)
- **`sessions`:** proiect, asistent (`chatgpt` / `claude` / `gemini` / `other` + nume), sarcină, stare (deschisă / închisă), sesiunea pe care o continuă.
- **`exchanges`** (pașii sesiunii):
  - `sent`: amprenta SHA-256 a pachetului, mărimea și referințele (D1 → informația);
  - `reply`: textul răspunsului și propunerile create din el;
  - `note`: nota utilizatorului.
- **Evenimente noi în jurnal:** `session.created`, `session.exchange`, `session.closed`, `session.reopened`.
- **Fiecare propunere devine o informație** cu autor „ai” și sursa „Claude · 2026-11-07”. Starea ei urmează alegerea ta: confirmată, respinsă (arhivată) sau în așteptare. Relația (înlocuiește / rezolvă) se creează doar la acceptare.
  - Dacă ai modificat textul, versiunea 1 rămâne textul AI-ului, iar versiunea 2 e textul tău. Proveniența e completă.
  - Tot răspunsul, cu toate deciziile, se salvează **într-o singură tranzacție**. Două propuneri care ar înlocui aceeași decizie sunt refuzate, iar atunci nu se scrie nimic.
- **Ștergerea definitivă a proiectului** șterge și sesiunile lui și le golește textele din jurnal.
- **Arhiva de export, versiunea 2:** include sesiunile și pașii lor, verificați și reluați din istoric, ca memoria. Arhivele versiunii 1 (AIW-04) se citesc în continuare (testat).

**Arhitectură:** modulul `continuity` (prevăzut în `src/modules.json`) folosește acum și `storage`, adică aceeași cale unică de scriere ca proiectele și memoria. E singura schimbare a regulilor de dependență.

## 6. Teste
**Unitare** (`tests/unit/continuity.test.ts`, 13 teste):
- **Pachetul:**
  - toate cele 7 tipuri, cu referințe și sarcină; același rezultat la aceeași intrare;
  - fără propuneri, informații respinse sau arhivate; informațiile închise doar la cerere;
  - limita respectată la 8.000 și 24.000 de caractere, cu răspunsurile salvate eliminate primele și cele importante păstrate cel mai mult.
- **Citirea răspunsului:**
  - blocul în română și în engleză, JSON tolerant, referințe, duplicate;
  - secțiunile, blocul invalid, lipsa propunerilor, relațiile imposibile;
  - titlurile lungi; înlocuirea care seamănă cu decizia înlocuită.
- **Sesiunile:**
  - acceptat / respins / de decis, într-o tranzacție: relații, proveniență, versiunea AI păstrată;
  - pachetul următor conține doar ce ai acceptat; verificarea integrității trece;
  - un set imposibil de decizii nu scrie nimic; o sesiune închisă refuză schimbări;
  - **transferul ChatGPT → Claude:** al doilea pachet are rezultatul acceptat, nu are decizia înlocuită și are răspunsul salvat;
  - validarea câmpurilor (alt AI fără nume, sarcină prea lungă, proiect în coș).
- **Arhiva v2:**
  - export și import cu sesiuni, adăugare și copie, cu id-urile, propunerile și referințele remapate consecvent;
  - citirea unei arhive v1;
  - o sesiune falsificată e refuzată;
  - ștergerea definitivă golește textele.

**În browser** (`tests/e2e/continuity.spec.ts`, pe iPhone 15, iPhone SE, Android și PC):
- **fluxul complet:** Lansator, pachet (fără propunerea neconfirmată), copiere (sau text pentru copiere manuală pe motorul iPhone), legătura spre AI fără nimic în adresă, sesiune, răspuns, revizuire, salvare. Apoi se verifică:
  - memoria oficială (decizia veche înlocuită, problema rezolvată, propunerea „de decis” lăsată în afara contextului);
  - versiunea AI păstrată;
  - integritatea istoricului;
- **transferul Claude → ChatGPT,** cu răspunsul salvat inclus;
- **răspunsul fără bloc** (secțiuni), răspunsul fără propuneri, nota, închiderea sesiunii;
- **tot fluxul fără internet** (în motorul Chrome; vezi AIW-04 §6 pentru motivul pentru care nu și pe iPhone).

**Capturi de ecran:** `docs/screenshots/AIW-05-*.png` (iPhone și PC).

## 7. Limitări
- **Copierea și lipirea sunt manuale.** E prețul lui „fără API, fără cost, fără cheie”.
- **Analiza răspunsului e mecanică**, nu „inteligentă”: funcționează bine când AI-ul folosește blocul cerut, iar altfel citește secțiunile cu titluri obișnuite. Proza liberă fără liste nu produce propuneri: răspunsul se salvează, iar informațiile se adaugă manual.
- **Fișierele nu intră în pachet** (aplicația nu stochează încă fișiere).
- **AI-ul nu primește automat nimic nou** în timpul conversației. Dacă memoria se schimbă, pregătești un pachet nou.
- **Textul conversației rămâne pe dispozitiv.** Răspunsurile salvate pot conține informații sensibile: ele intră în export și în jurnal și se șterg odată cu proiectul.
