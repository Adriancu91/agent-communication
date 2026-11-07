# AIW-03 — Memoria proiectelor (ARHITECTURĂ ȘI PLAN, neînceput)

Stare: **doar plan**. Implementarea începe după aprobarea lui Adrian și a lui Gepeto.

## 1. Scop
Fiecare proiect primește o **memorie reală**, separată de a celorlalte. Memoria cuprinde:
- informații importante, decizii, instrucțiuni, obiective și context;
- un istoric organizat;
- relații între informații.

Memoria e construită ca să poată fi folosită direct de modulul Continuitate (AIW-05) la transferul contextului spre alte platforme AI.

**Nu construim încă un mecanism de stocare.** Memoria folosește stocarea din AIW-02 (aceeași bază de date, același jurnal cu amprente, aceeași cale de scriere „totul sau nimic”).

## 2. Ce reutilizăm și ce schimbăm
| Piesă din AIW-02 | În AIW-03 |
| --- | --- |
| Baza `aiw` (IndexedDB) cu migrări numerotate | Adăugăm **migrarea 2**: depozitele `memory` și `links`. Proiectele existente rămân neatinse (test dedicat). |
| Jurnalul cu amprente înlănțuite (`events`) | Același jurnal, cu tipuri noi de evenimente `memory.*` și `link.*`. Un singur istoric pentru tot proiectul. |
| Calea unică de scriere din `projects/service.ts` (lacăt între file, tranzacție atomică, anulare la orice eroare, anunțarea celorlalte file) | **O mutăm într-o piesă comună** (`storage/journaled.ts`), folosită de `projects` și de `memory`. Nu o copiem: există o singură implementare, deci și reparațiile se fac într-un singur loc. |
| Ștergerea definitivă a proiectului (șterge textele din jurnal după `projectId`) | Se extinde automat la memorie: toate evenimentele memoriei au `projectId`. În plus, ștergerea proiectului șterge și intrările de memorie și legăturile lui, în aceeași tranzacție. |
| Validări, căutare fără diacritice (`core`) | Refolosite pentru titlurile și textele memoriei. |
| Erorile de stocare, mesajele clare, fereastra care păstrează textul | Identice. |

## 3. Modelul memoriei
**Intrarea de memorie** (`MemoryItem`), separată pe proiect:

| Câmp | Ce este |
| --- | --- |
| `id`, `projectId` | identitate; o intrare aparține unui singur proiect |
| `kind` | unul din cele 7 tipuri de mai jos |
| `title` | scurt, obligatoriu (cel mult 120 de caractere) |
| `body` | textul (cel mult 20.000 de caractere), text simplu cu rânduri noi, fără HTML |
| `status` | `active` · `done` (problemă rezolvată / pas făcut) · `superseded` (decizie înlocuită) · `archived` · `proposed` (propunere care așteaptă confirmarea) |
| `important` | da/nu: intrările importante intră primele în pachetul de context |
| `source` | `user` acum; mai târziu `chatgpt` / `claude` / `gemini` pentru propunerile importate (AIW-05) |
| `revisions` | versiunile anterioare ale titlului și textului (ca istoricul numelor de proiect) |
| `createdAt`, `updatedAt` | datele |
| doar la decizii: `rationale` (de ce), `alternatives` (ce s-a respins) | |

**Cele 7 tipuri:**
1. **Obiective** (`goal`): ce vrea proiectul să obțină.
2. **Instrucțiuni și reguli** (`instruction`): cum trebuie lucrat; ce trebuie să respecte orice AI.
3. **Decizii** (`decision`): ce s-a hotărât, de ce, ce alternative s-au respins.
4. **Informații importante** (`fact`): fapte, cifre, nume, date de reținut.
5. **Context / starea actuală** (`context`): unde e proiectul acum.
6. **Probleme deschise** (`issue`): ce nu e rezolvat.
7. **Următorii pași** (`step`): ce urmează.

**Relațiile** (`Link`) leagă două intrări **din același proiect**:
| Relație | Exemplu |
| --- | --- |
| **decurge din** (`because`) | decizia „Folosim ZIP” decurge din obiectivul „Proiecte mutabile între dispozitive” |
| **înlocuiește** (`supersedes`) | decizia nouă înlocuiește decizia veche, care devine automat `superseded` |
| **rezolvă** (`resolves`) | pasul „Adaug export” rezolvă problema „Datele se pot pierde” |
| **legat de** (`relates`) | orice altă legătură |

Reguli:
- fără legături cu sine însăși;
- fără legături între proiecte;
- fără legături duplicate;
- când o intrare e ștearsă definitiv, legăturile ei dispar odată cu ea.

**Istoricul organizat:**
- o cronologie pe proiect, construită din jurnal (cine/ce/când: „Decizie adăugată”, „Problemă rezolvată”, „Instrucțiune modificată”…);
- filtre după tip;
- versiunile anterioare ale fiecărei intrări, păstrate în `revisions`.

**Propunerile** (`status: proposed`): modelul și filtrul „De confirmat” există de acum, dar în AIW-03 doar utilizatorul scrie în memorie. Importul din răspunsurile AI (AIW-05) va crea doar propuneri; niciuna nu intră în memorie fără confirmarea utilizatorului.

## 4. Pregătirea pentru Continuitate (AIW-05)
Funcția pură `memory/context.ts → buildContext(project, items, links, opțiuni)` produce o **vedere structurată** a memoriei. Formatarea pentru fiecare AI vine în AIW-05.
- **Ordinea:**
  1. instrucțiuni;
  2. obiective;
  3. context;
  4. decizii active (cu „de ce”);
  5. informații importante;
  6. probleme deschise;
  7. următorii pași.

  În fiecare grupă, intrările importante vin primele.
- **Se exclud** intrările arhivate și deciziile înlocuite, iar propunerile apar marcate separat. Problemele rezolvate și pașii făcuți sunt excluși implicit.
- Relațiile apar ca trimiteri scurte („decurge din: …”).
- **O limită de mărime** (implicit ~24.000 de caractere): taie mai întâi intrările neimportante, iar ce s-a omis e raportat.
- Rezultatul e date simple (JSON), testat unitar. În AIW-03 nu are interfață; o previzualizare simplă apare în AIW-05.

## 5. Interfața (în stilul aprobat, întâi pentru iPhone)
- **Pagina proiectului:** cardul „Conținutul proiectului” devine **„Memoria proiectului”**, cu numărul de intrări pe tipuri și butonul „Deschide memoria”.
- **Ecranul memoriei** (`#/proiect/<id>/memorie`):
  - titlul proiectului; căutare; filtre pe tipuri (rând de butoane derulabil pe telefon);
  - lista grupată pe tipuri, cu steluță pentru important și starea (rezolvată, făcut, înlocuită, propunere);
  - butonul „Adaugă” deschide o foaie de jos: tip, titlu, text, important; la decizii și „De ce” / „Alternative respinse”.
- **Pagina unei intrări:**
  - textul complet;
  - schimbarea stării („Marchează rezolvată”, „Marchează făcut”, „Înlocuită de…”);
  - **Legături** („Leagă de…”: alegi relația și intrarea, cu căutare);
  - **Versiuni anterioare**;
  - Arhivează / Restaurează; ștergerea definitivă doar din arhivă, cu a doua confirmare (ca la Coș).
- **Istoricul proiectului** (`#/proiect/<id>/istoric`): cronologia, cu filtre.
- **Tabul „Memorie”** deschide memoria ultimului proiect folosit, cu un selector de proiect sus. Fără proiecte: mesaj și butonul „Proiect nou”.
- **Texte:** română și engleză; fără HTML în textele utilizatorului.

## 6. Module și fișiere
| Director | Ce conține | Depinde de |
| --- | --- | --- |
| `core/memory.ts` | tipurile, validarea, regulile relațiilor, căutarea | — |
| `storage/journaled.ts` | **calea comună de scriere** (mutată din `projects`) | `core` |
| `storage/db.ts` | migrarea 2 (`memory`, `links` și indexurile lor) | — |
| `projects/` | folosește calea comună; ștergerea definitivă include memoria | `core`, `storage` |
| `memory/` (modul nou) | operațiile cu memoria, istoricul, `buildContext` | `core`, `storage` |
| `ui/memory*.tsx` | ecranele | toate de mai sus |

Granițele sunt deja declarate în `src/modules.json` (`memory → core, storage`) și verificate de test. Fiecare modul nou are README.

## 7. Pași (un singur PR, commit-uri mici, fiecare cu testele trecute)
1. **Refactorizare fără schimbări vizibile:** calea de scriere mutată în `storage/journaled.ts`. Toate cele 98 de teste existente trebuie să treacă neschimbate.
2. **Migrarea 2:** test cu o bază creată de codul AIW-02 (proiecte, coș, istoric), redeschisă cu codul nou. Datele sunt identice, iar lanțul jurnalului rămâne valid.
3. **`core/memory.ts` + modulul `memory`:** operații, relații, revizii, arhivă, ștergere definitivă, cascada la ștergerea proiectului, cu teste unitare.
4. **`buildContext`** + teste: ordinea, excluderile, limita de mărime.
5. **Interfața:** ecranul memoriei, pagina intrării, legături, istoric, tabul Memorie.
6. **Teste în browser + documentație + PR.**

## 8. Teste (pe iPhone 15, iPhone SE, Android, PC)
**Unitare:**
- validări (titlu gol sau prea lung, text prea lung, tip necunoscut);
- relații interzise (cu sine, între proiecte, duplicate);
- versiunile anterioare;
- „înlocuiește” marchează automat decizia veche;
- arhivă și restaurare;
- ștergerea definitivă a intrării șterge legăturile și textul din jurnal;
- ștergerea definitivă a proiectului șterge toată memoria lui (și din jurnal);
- migrarea 1→2 păstrează datele;
- o scriere care eșuează la jumătate nu lasă nimic;
- `buildContext` (ordine, important primul, excluderi, limită, omisiuni raportate).

**În browser:**
- adăugarea fiecărui tip;
- editare cu versiuni;
- legături în ambele sensuri;
- filtre și căutare fără diacritice;
- rezolvat / făcut / înlocuită;
- arhivă, restaurare, ștergere definitivă cu a doua confirmare;
- memorie separată între două proiecte (nimic nu „curge” dintr-unul în altul);
- păstrarea după închiderea completă a browserului (Chrome și iPhone);
- fără internet;
- 1.000 de intrări într-un proiect (timpi măsurați);
- spațiu plin (Chromium);
- textul multi-linie pe iPhone (tastatura nu acoperă butonul);
- diacritice și emoji;
- HTML în texte afișat ca text simplu.

## 9. Riscuri
| Risc | Măsură |
| --- | --- |
| Refactorizarea căii de scriere strică proiectele | pasul 1 separat; toate testele vechi trebuie să treacă neschimbate |
| Migrarea pierde date | test cu o bază reală AIW-02; migrările nu modifică depozitele vechi |
| Interfață prea complicată pe telefon | tipuri fixe, relații puține (4), legături adăugate doar din pagina intrării |
| Memorie prea mare pentru un AI | `buildContext` cu limită și prioritate pentru „important” |
| Date pierdute înainte de export | avertizările rămân; nu se publică înainte de AIW-04 |
| Texte periculoase lipite în memorie | afișare doar ca text; căutarea cheilor secrete vine odată cu pachetul de context (AIW-05) |

## 10. Decizii pentru Adrian și Gepeto
1. Cele **7 tipuri** de memorie (obiective, instrucțiuni, decizii, informații, context, probleme, pași): le aprobați așa?
2. Cele **4 relații** (decurge din, înlocuiește, rezolvă, legat de): ajung pentru început?
3. **Tabul „Memorie”** deschide memoria ultimului proiect folosit, cu selector (recomandat), sau o listă a tuturor proiectelor?
4. **Textul:** simplu, cu rânduri noi (recomandat), iar formatarea (titluri, liste) mai târziu?
5. **Ștergerea** intrărilor: arhivă + ștergere definitivă cu a doua confirmare, ca la proiecte (recomandat)?
