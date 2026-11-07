# AI Workspace — modificări

Nicio versiune nu e publicată. Fiecare etapă e un PR separat, neîmbinat până la aprobarea lui Adrian.

## AIW-04 — Export și import (PR separat, ciornă)
- **Export** al unui proiect (din pagina lui sau din meniul ⋯) sau al tuturor proiectelor (Setări), într-o arhivă `.zip`: memoria completă, legăturile, istoricul și versiunile.
- **Import** din Setări, cu verificarea completă a arhivei înainte de orice scriere și cu previzualizare.
- **Duplicate:** sari peste, înlocuiește (cu avertisment) sau copie nouă (cu id-uri noi și un nume liber).
- **Import atomic:** ori se importă tot ce ai ales, ori nimic.
- **Arhive deteriorate sau modificate** sunt refuzate, cu un mesaj clar; datele de pe dispozitiv nu se schimbă.
- **Tehnic:**
  - ZIP scris de la zero (fără biblioteci noi), cu protecție la „zip bomb”;
  - evenimentul `project.imported`;
  - istoricul importat își păstrează datele originale;
  - nicio migrare nouă a bazei de date.

## AIW-03 — Memoria proiectelor (PR #6, ciornă)
- **Memorie** separată pentru fiecare proiect, cu 7 tipuri: obiective, instrucțiuni și reguli, decizii, informații importante, context / starea actuală, probleme deschise, următorii pași.
- **Legături** de 4 tipuri: decurge din, înlocuiește, rezolvă, legată de. Fără legături între proiecte, cu sine, duplicate sau în cerc.
- **Înlocuirea unei decizii:** explicită, cu motiv obligatoriu; decizia veche rămâne, marcată „înlocuită”.
- **Rezolvarea unei probleme:** problema rămâne, marcată „rezolvată”, cu legătură spre soluție.
- **Versiuni:** fiecare editare păstrează versiunea anterioară, iar versiunile vechi se pot afișa.
- **Proveniență:** autor (tu / propunere AI), sursă, confirmare. Propunerile AI rămân „de confirmat” până le confirmi și nu intră în context.
- **Arhivă și ștergere:** arhivare / restaurare; ștergerea definitivă doar din arhivă, cu a doua confirmare; legăturile se curăță.
- **Căutare** fără diacritice, doar în proiectul ales; versiunile anterioare doar la cerere; arhiva în vederea ei.
- **Istoric și verificarea integrității**, cu limitele explicate onest.
- **Previzualizarea contextului pentru alt AI** (doar previzualizare; nimic nu se trimite).
- **Tabul Memorie** deschide ultimul proiect folosit, cu selector și revenire sigură.
- **Tehnic:**
  - calea de scriere din AIW-02 a devenit comună;
  - migrarea 2 a bazei de date, testată cu aplicația AIW-02 reală;
  - dialogurile redau focalizarea butonului care le-a deschis.

## AIW-02 — Managerul de proiecte (PR #5, ciornă)
Proiecte pe dispozitiv: creare, editare, istoric de nume, fixare, căutare, ordonare, Coș, ștergere definitivă, stocare persistentă, avertizarea pentru iPhone.

## AIW-01 — Fundația (PR #4, ciornă)
Interfața pentru iPhone / Android / PC, română / engleză, funcționare fără internet, CSP strictă.
