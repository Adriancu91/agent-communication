# AIW-08 — Chat curat și pilot automat (GPT-OSS 20B)

**Stare:** cerut de Adrian pe 8 noiembrie 2026: „să aerisim pagina, să fie mai goală ca la ChatGPT, opțiuni ascunse în meniuri, unele butoane le scoatem și i le dăm lui GPT […] utilizatorul trebuie să intre și să înceapă chatul”, plus recomandările lui Claudiu (dispecer, rezumator, cititor de documente). PR separat, pornit din AIW-07. **Neîmbinat, nepublicat.**

## 1. Ecranul curat
- **Sus rămân patru lucruri:**
  - ☰ istoricul, cu numărul de conversații;
  - modelul, la mijloc („✦ Auto” sau modelul ales);
  - ＋ conversație nouă;
  - ⋯ **Opțiuni**.
- **Sub ele:** numele proiectului, scris mic.
- **În Opțiuni (⋯) au intrat:**
  - proiectul;
  - economia (cu procentul economisit);
  - prompturile;
  - consiliul;
  - conversația cu voce;
  - contul Puter.
- **Prompturile:**
  - șirul de prompturi de deasupra casetei a dispărut;
  - prompturile gata făcute și cele proprii sunt acum în foaia Prompturi;
  - pe ecranul gol rămân patru propuneri de început.
- **Caseta de scris apare imediat, fără cardul „Conectează Puter” în față.** La primul mesaj, aplicația întreabă o singură dată:
  - **cu pilotul** (implicit pentru cine începe acum): „Pornește pilotul” sau „Aleg eu modelul”;
  - **cu un model Puter ales de mână și fără cont:** „Conectează Puter” sau „Folosește gratuit”.
- **Ce e pornit acum** (conversația cu voce, citirea cu voce tare) apare ca o pastilă deasupra casetei, de unde se oprește.

## 2. Pilotul automat („✦ Auto” în lista de modele)
Modelul gratuit GPT-OSS 20B (Pollinations, fără cont și fără cheie) face o parte din treabă, ca modelul plătit să fie folosit doar unde merită.

### Fără cont Puter
Răspunde doar modelul gratuit, ca în modul gratuit de până acum.

### Cu cont Puter
1. **Dispecerul.**
   - **Cazurile clare le hotărăște telefonul, fără să trimită nimic nicăieri:**
     - poze → Gemini 2.5 Flash-Lite, sau Gemini 3.5 Flash dacă întrebarea e lungă;
     - fișiere → la fel;
     - cod sau aplicații → Gemini 3.5 Flash, cu loc pentru un răspuns lung (2500 de tokeni);
     - întrebări foarte lungi → Gemini 3.5 Flash.
   - **O întrebare scurtă și simplă** merge întâi la modelul gratuit, care:
     - **răspunde direct**, dacă e ceva simplu (salut, mulțumire, reformulare, o traducere scurtă), iar Puter nu e folosit deloc;
     - **sau o dă mai departe**, cu o etichetă: [[MEDIU]] → Gemini 2.5 Flash-Lite; [[GREU]] → Gemini 3.5 Flash; [[COD]] → Gemini 3.5 Flash. Eticheta nu apare pe ecran.
   - **Un singur apel, nu două:** decizia și răspunsul simplu vin din aceeași cerere.
   - **Dacă modelul gratuit e ocupat, greșește sau tace 8 secunde,** întrebarea merge la Gemini 2.5 Flash-Lite.
   - **Pilotul nu alege niciodată singur modelele cele mai scumpe ($$$).** Pe acelea le alegi doar tu.
2. **Rezumatorul.**
   - Când o conversație depășește fereastra de istoric, modelul gratuit face un rezumat scurt al părții vechi (cel mult 120 de cuvinte). Păstrează cifrele, numele, datele și deciziile.
   - Rezumatul pleacă împreună cu întrebarea, așa că modelul plătit știe povestea pentru câteva zeci de tokeni.
   - Se reface la fiecare 4 mesaje vechi noi.
   - Stă doar pe acest dispozitiv (`aiw.chat.summary.<conversație>`); nu intră în memorie și nici în arhive.
3. **Cititorul de documente.**
   - Un document atașat lung (peste 6000 de caractere) e citit întâi de modelul gratuit, care copiază cuvânt cu cuvânt doar pasajele necesare pentru întrebare.
   - Modelul plătit primește întrebarea și pasajele.
   - Pornește doar dacă serviciul gratuit e liber în acel moment și are cel mult 20 de secunde. Altfel e sărit, iar întrebarea nu așteaptă.
   - Dacă cititorul nu găsește nimic util sau pică, fișierul pleacă întreg, ca înainte. Notele cu poze și un fișier tăiat la limită rămân neatinse.
   - În proiect se salvează tot fișierul, ca până acum.
4. **Creditul Puter s-a terminat:** pilotul continuă cu modelul gratuit, în aceeași conversație (dacă e bifat „trece singur pe gratuit”). Așteaptă până la 5 secunde, ca să nu lovească limita serviciului gratuit. Excepție: când întrebarea are poze, pentru că modelul gratuit nu vede poze.
   **Contul Puter nu s-a încărcat:** apare cardul cu „Reîncearcă”. Până atunci răspunde modelul gratuit, iar aplicația spune asta.
5. **Pe ecran:**
   - în timpul lucrului: „✦ Pilotul se uită la întrebare…”, „…citește documentul…”, „…a trimis la Gemini 3.5 Flash (grea)”;
   - sub răspuns: modelul care a răspuns;
   - conversația se numește „Auto ✦”.

### Limitele serviciului gratuit
- **Serviciul anonim Pollinations** permite cam o cerere la câteva secunde (surse publice: între 3 și 15 secunde).
- **Ajutoarele (rezumatul, cititorul)** pornesc doar când a trecut rândul (15 secunde de la ultima cerere gratuită). Altfel sunt sărite până data viitoare.
- **Nimic nu se reîncearcă în buclă.** Dacă un ajutor lipsește, chatul merge exact ca fără pilot.

### Ce pleacă unde (de aceea se cere acordul o dată)
- **Acordul pentru pilot e separat de acordul pentru modul gratuit.** Pilotul trimite mai mult, așa că îl cere și cine a folosit deja modul gratuit.
- **Cu pilotul pornit,** întrebările scurte merg întâi la Pollinations, cu memoria proiectului (în forma aleasă la Economie).
- **Tot acolo ajung:** partea veche a conversațiilor lungi (pentru rezumat) și documentele lungi (pentru pasaje).
- **„Aleg eu modelul”** oprește pilotul: atunci nu pleacă nimic la Pollinations.
- **Memoria oficială se schimbă tot numai când confirmi tu propunerile.**

## 3. Compatibilitate
- **Cine are deja un model ales îl păstrează.** Pilotul e implicit doar pentru cine începe acum.
- **Cine a mai vorbit în chat pe modelul implicit, fără să fi salvat vreo setare,** îl păstrează și el. Altfel conversația lui s-ar rupe în două.
- **Conversațiile pilotului** sunt conversații obișnuite din aplicație, cu modelul `auto`. Arhivele v3 le duc fără nicio schimbare.
- **Baza de date, jurnalul și formatul arhivei nu se schimbă.**

## 4. Teste
- **`tests/unit/pilot.test.ts`:** dispecerul de pe dispozitiv, etichetele, rezumatul, cititorul de documente, numele „Auto ✦”.
- **`tests/e2e/pilot.spec.ts`:** Puter și Pollinations sunt simulate. Verifică:
  - ecranul curat;
  - acordul cerut o dată;
  - fără cont, răspunde doar modelul gratuit;
  - întrebarea simplă e rezolvată gratis;
  - întrebarea dată mai departe nu arată eticheta;
  - când serviciul gratuit e ocupat, răspunde Puter;
  - codul merge direct la Puter;
  - documentul lung e citit și se trimit doar pasajele;
  - rezumatul pleacă împreună cu întrebarea;
  - un început propus, atins înainte de acord, se trimite după acord;
  - un model Puter ales de mână, fără cont, duce la întrebarea „Conectează Puter / Folosește gratuit”;
  - cine a mai vorbit pe modelul implicit îl păstrează;
  - cu „Aleg eu modelul”, la Pollinations nu pleacă nimic.
- **Verificare independentă:** a găsit 2 probleme grave și 5 medii. Toate au fost reparate:
  - textul pierdut după acord;
  - utilizatorii vechi mutați pe pilot;
  - acordul comun cu modul gratuit;
  - trecerea pe gratuit care lovea limita;
  - cititorul care făcea întrebarea să aștepte;
  - eroarea Puter ascunsă;
  - etichete scrise cu formatare.

  Rămân cunoscute, fără efect asupra datelor:
  - amprenta salvată a contextului nu include rezumatul și pasajele;
  - rândul „→ model” de sub răspuns ține doar până la reîncărcare;
  - estimarea costului pentru Auto folosește modelul obișnuit.
- **Testele vechi ale chatului** își țin un model fix (ca un utilizator care și-a ales unul). Deschid opțiunile din meniul ⋯, pentru că acolo s-au mutat. Fiecare schimbare are un comentariu `AIW-08`; nicio verificare nu a fost scoasă.
