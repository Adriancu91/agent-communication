# AIW-02 — Managerul de proiecte

Stare: **implementat** (plan aprobat de Adrian și Gepeto, 7 noiembrie 2026). Așteaptă aprobarea PR-ului.

## Scop
Managerul real de proiecte: creare, redenumire, ștergere cu confirmare, deschidere și organizare. Proiectele se salvează pe dispozitiv și rămân după închiderea browserului.

## Ce intră
1. **Creare:**
   - butonul „Proiect nou” deschide o foaie de jos (pe PC, o fereastră) cu numele (obligatoriu, 1–80 de caractere) și o descriere scurtă (opțională);
   - pe iPhone, câmpurile au text de 16 px sau mai mare, ca Safari să nu mărească ecranul;
   - tastatura nu acoperă butonul.
2. **Lista de proiecte:**
   - carduri cu numele, descrierea și data ultimei modificări;
   - ordonare: recente / alfabetic;
   - căutare după nume;
   - proiecte fixate sus (opțiunea „Fixează”).
3. **Deschidere:**
   - pagina proiectului (`#/proiect/<id>`): titlu, descriere, date;
   - secțiunile viitoare (fișiere, conversații, memorie) apar ca „În pregătire”;
   - butonul Înapoi merge.
4. **Redenumire:** din meniul „⋯” al proiectului. Numele vechi rămâne în istoric (regula „istoricul nu se rescrie”).
5. **Ștergere cu confirmare:**
   - fereastră de confirmare cu numele proiectului;
   - proiectul ajunge în **Coș** și poate fi restaurat;
   - ștergerea definitivă, doar din Coș, cere o a doua confirmare.
6. **Salvare pe dispozitiv:**
   - modulele `core` (formatul proiectului, validarea, jurnalul de evenimente) și `storage` (IndexedDB), după arhitectura aprobată;
   - salvarea e automată, fără buton.
7. **Protecția datelor** (datele apar acum, deci riscurile devin reale):
   - cerere de stocare persistentă (`navigator.storage.persist()`), cu starea afișată în Setări;
   - **pe iPhone, datele din Safari și cele din aplicația adăugată pe ecranul principal sunt separate** (comportament verificat; Apple nu le împarte). Cardul „Pe ecranul principal” primește avertizarea „alege un singur loc în care lucrezi; mutarea datelor se face prin export/import (AIW-04)”;
   - textul de backup e actualizat: proiectele există, dar exportul vine în AIW-04, deci aplicația nu se publică până atunci (AIW-07).
8. **Securitate:**
   - numele și descrierile se afișează doar ca text (un nume ca `<img onerror=…>` rămâne text);
   - limite de mărime;
   - nicio conexiune nouă (CSP neschimbată).

## Ce NU intră (etapele următoare)
Conținutul proiectelor (fișiere, conversații, decizii, sarcini), memoria (AIW-03), exportul/importul (AIW-04), continuitatea (AIW-05), lansatorul (AIW-06).

## Fișiere
- `app/src/core/` — formatul și validarea proiectului, jurnalul de evenimente cu amprente înlănțuite.
- `app/src/storage/` — interfața de stocare și implementarea IndexedDB.
- `app/src/projects/` — operațiile: creare, redenumire, coș, restaurare, ordonare, căutare.
- `app/src/ui/` — ecranele Proiecte, pagina proiectului, Coșul, ferestrele de confirmare.
- Câte un README scurt pentru fiecare modul nou.
- Granițele dintre module sunt deja definite în `src/modules.json`.

## Teste (pe iPhone 15, iPhone SE, Android, PC)
1. Creare → apare în listă → rămâne după reîncărcare **și după închiderea completă a browserului**.
2. Redenumire; numele vechi apare în istoric.
3. Ștergere: „Anulează” nu șterge; „Șterge” mută în Coș; restaurarea îl readuce; ștergerea definitivă cere a doua confirmare.
4. Căutare, ordonare, fixare.
5. Fără internet: toate operațiile merg; datele rămân.
6. Nume cu diacritice, emoji, nume foarte lungi, nume goale (refuzate), nume cu cod HTML (rămân text).
7. 200 de proiecte: lista rămâne fluidă pe telefon.
8. Tastatura pe iPhone: câmpul și butonul rămân vizibile; nu apare mărirea automată.
9. Inventarul datelor: proiectele stau doar în IndexedDB-ul aplicației; nicio cerere în afara aplicației.
10. Unitare: validarea numelor, jurnalul (o modificare a lanțului e detectată), operațiile din `projects`.

## Riscuri
| Risc | Măsură |
| --- | --- |
| Date pierdute înainte de export (AIW-04) | nu se publică până la AIW-07; avertizare în Setări |
| Safari și aplicația de pe ecranul principal au date separate | avertizare clară; mutarea prin export/import |
| Stocarea refuzată (navigare privată) | mesaj clar „datele nu vor fi păstrate în acest mod” |
| Ștergere din greșeală | Coș + confirmare dublă |

## Decizii (Adrian și Gepeto)
1. Ștergerea: Coș cu restaurare.
2. Ștergerea definitivă: cere o a doua confirmare (o căsuță „Înțeleg că nu se mai poate recupera”).
3. Organizarea: căutare, ordonare recente/alfabetic, fixare sus. Dosarele și etichetele sunt amânate.
4. La creare: nume obligatoriu, descriere opțională. Culorile și iconițele sunt amânate.

## Cum s-a făcut
- **Stocarea** e IndexedDB, printr-un strat scris de noi; aplicația nu include nicio bibliotecă nouă.
  - Baza `aiw` are trei depozite: `projects`, `events` (jurnalul) și `meta`, cu **migrări numerotate**: memoria, conversațiile și fișierele se adaugă ca pași noi.
  - De ce IndexedDB: date structurate și mari, tranzacții „totul sau nimic”, merge pe iPhone, Android și PC. `localStorage` ține doar preferințe (limba, ordinea, avertizarea citită).
- **O singură cale de scriere:**
  - fiecare schimbare = un eveniment în jurnal + noua stare a proiectului, într-o singură tranzacție;
  - un singur scriitor odată, chiar cu mai multe file deschise (Web Locks);
  - celelalte file se actualizează singure (BroadcastChannel).
- **Jurnalul** are amprente SHA-256 înlănțuite. La ștergerea definitivă, numele și descrierile proiectului sunt șterse și din jurnal; amprentele rămân, deci lanțul se verifică în continuare.
- **Stocarea persistentă** se cere după primul proiect creat (o acțiune a utilizatorului). Setări arată răspunsul browserului și spațiul folosit, fără să promită că datele sunt „permanente”.
- **Erorile de stocare** se traduc în mesaje clare: spațiu insuficient, navigare privată, versiune veche în altă filă, conflict.
  - Fereastra rămâne deschisă cu tot ce a fost scris, iar nimic nu rămâne salvat pe jumătate.
  - Ștergerea în Coș are buton „Anulează” timp de câteva secunde.
- **iPhone:** avertizarea despre spațiile separate (Safari / ecranul principal) apare pe ecranul Proiecte (până la „Am înțeles”) și mereu în Setări.

## Rezultate
- **26 de teste unitare** (cu IndexedDB simulat): validări, căutare fără diacritice, ordonare românească, jurnalul (orice modificare e detectată, ștergerea definitivă păstrează lanțul valid), operațiile, 20 de schimbări simultane, o scriere care eșuează la jumătate.
- **72 de teste în browser** pe iPhone 15, iPhone SE, Android și PC, inclusiv:
  - închiderea completă a browserului, atât pe motorul Chrome, cât și pe motorul iPhone;
  - spațiul plin (pe motorul Chrome, singurul unde limita se poate micșora);
  - 200 de proiecte: încărcare ~90–150 ms, căutare ~30–80 ms, ordonare ~110–190 ms.

  Suita a rulat de două ori la rând, fără erori.

**Găsit și reparat de teste:**
1. Dacă salvarea în jurnal eșua după ce proiectul fusese deja scris, browserul păstra jumătatea reușită. Acum orice eroare anulează explicit toată tranzacția (testul unitar „o scriere care eșuează la jumătate”).
2. Pe iPhone, în Coș, numele proiectului se înghesuia într-o coloană îngustă (litere pe rânduri separate). Acum numele are rândul lui, iar butoanele stau dedesubt (test de lățime).

## Limite
- Spațiul plin se poate simula automat doar în Chromium. Pe iPhone, mesajul folosește același cod, dar nu e testat automat.
- Proiectele nu au încă export: aplicația nu se publică înainte de AIW-04 (export) și AIW-07.
