# AI Workspace — modificări

Nicio versiune nu e publicată. Fiecare etapă e un PR separat, neîmbinat până la aprobarea lui Adrian.

## AIW-06.1 — Import din cont, modul gratuit, reparații după testul pe iPhone (PR separat, ciornă)
- **Tabul Lansator devine Import:** conversațiile exportate din contul tău de ChatGPT sau Claude devin chaturi ale proiectului, pe care le continui în Chat. Fișierul e citit doar pe dispozitiv.
- **Modul gratuit:** GPT-OSS 20B prin serviciul public Pollinations, fără cont și fără cheie; comutare automată când se termină creditul Puter (cu acordul cerut o dată).
- **Reparații:**
  - foaia Cont se închide;
  - estimarea de tokeni nu mai stă peste caseta de mesaj;
  - titlurile nu mai sunt tăiate;
  - sesiunile proiectelor din coș nu mai apar;
  - linkul spre Puter a fost scos.
- **CSP:** în plus exact `https://text.pollinations.ai`.

## AIW-06 — Chat AI în aplicație + interfața nouă (PR separat, ciornă)
- **Tab nou „Chat”:** discuți cu un model AI direct în aplicație. Te conectezi o singură dată la Puter (cont gratuit, fără chei); fiecare mesaj se plătește din contul tău Puter, nu prin aplicație.
- **Memoria proiectului ca context;** propunerile modelului trec prin aceeași revizuire. Memoria oficială se schimbă tot doar prin decizia ta.
- **Economie de tokeni:** memorie completă / compactă / doar importantă / deloc, răspuns normal / scurt / telegrafic, fereastra de istoric, limita de lungime; trei preseturi; estimare și „−N%” înainte de trimitere.
- **Modele:** listă scurtă cu semn de preț ($ / $$ / $$$) și orice alt model Puter după nume; schimbarea modelului continuă discuția.
- **Șabloane:** 8 gata făcute și până la 30 proprii.
- **Interfață nouă:** culori „aurora”, carduri, butoane colorate, bară de taburi cu indicator; tema întunecată.
- **Tehnic:**
  - Puter.js 2.6.5 (Apache-2.0) inclus neschimbat, cu amprenta verificată;
  - CSP: în plus exact `https://api.puter.com` și `wss://api.puter.com`;
  - arhiva trece la versiunea 3 (versiunile 1 și 2 se citesc în continuare).

## AIW-05.1 — Flux aproape automat (PR separat, ciornă)
- **„Trimite la AI” cu o atingere:**
  - pe telefon, prin meniul de partajare, direct în aplicația ChatGPT / Claude / Gemini;
  - pe calculator, un clic copiază pachetul și deschide site-ul AI.
- **Răspunsul se aduce înapoi cu o atingere:** aplicația citește singură clipboardul. Pe Android, răspunsul poate fi partajat direct către AI Workspace.
- **Analiza pornește singură.** „Acceptă tot ce e nou și salvează” rezolvă confirmarea dintr-o atingere.
- **Corectură:** analiza așteaptă încărcarea memoriei, deci comparația și relațiile sunt mereu corecte.

## AIW-05 — Continuitate AI (PR separat, ciornă)
- **Lansatorul** devine fluxul de lucru cu AI: proiect → asistent (ChatGPT, Claude, Gemini, alt AI) → sarcină → pachet de continuitate → copiere / descărcare → deschiderea site-ului AI într-o filă nouă.
- **Pachetul de continuitate:** memoria oficială pe secțiuni, cu referințe scurte (D1, P2), instrucțiuni pentru AI, sarcina, opțional ultimele răspunsuri; limită de mărime; fără propuneri neconfirmate și fără contradicții.
- **Sesiuni** (tabul Continuitate): pachetul dat, răspunsurile aduse înapoi, note, închidere / redeschidere, continuare cu alt AI.
- **Reintroducerea răspunsului:** propunerile sunt găsite (bloc standard sau secțiuni), comparate cu memoria și confirmate de tine: acceptă / respinge / de decis, cu editare; relațiile (înlocuiește / rezolvă) se aplică doar la acceptare.
- **Exportul** include și sesiunile (formatul arhivei, versiunea 2; versiunea 1 se citește în continuare).
- **Tehnic:** migrarea 3 (doar adăugare), fără API, fără chei, fără conexiuni noi.

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
