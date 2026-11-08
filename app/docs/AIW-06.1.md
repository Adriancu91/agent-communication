# AIW-06.1 — Import din contul tău, modul gratuit și reparațiile din testul pe iPhone

**Stare:** cerut de Adrian pe 8 noiembrie 2026, după testul pe telefon. PR separat, pornit din AIW-06. **Neîmbinat, nepublicat.**

## 1. Ce a cerut Adrian și ce s-a făcut
| Cererea | Ce s-a făcut |
|---|---|
| „Din meniul Contul Puter nu pot să ies” | Butonul **Închide**; foile care doar arată ceva (Cont, Istoric, Model, Economie) se închid și la o atingere în afara lor. Formularele nu se închid așa, ca să nu se piardă textul scris. |
| „Scrisul cu tokeni peste caseta de chat nu-mi place” | Nu mai e sub casetă. Economia apare pe butonul ⚡ („Echilibrată · −33%”), iar estimarea completă e în foaia Economie. Textul din casetă e mai scurt („Scrie un mesaj…”). |
| „La Continuitate titlul e prea mare și nu se vede tot” | Titlurile mari se micșorează pe ecrane înguste și nu mai sunt tăiate; butonul trece sub titlu. |
| „Apar sesiuni care au fost șterse” | Sesiunile proiectelor din coș nu mai apar la Continuitate (revin dacă restaurezi proiectul). |
| „Scoate linkul spre pagina Puter” | Scos. Rămân doar conectarea, deconectarea și revenirea în aplicație. |
| „Lansatorul îl eliminăm sau îl transformăm în import din conversațiile din propriul cont” | Tabul **Lansator** a devenit **Import** (vezi 2). Pagina Lansator există în continuare, din Continuitate → „Pornește o sesiune”. |
| „Conversații doar în chat… un buton care ne conectează la LLM-uri gratuite, fără API, când se termină creditele Puter sau comutare automată” | **Modul gratuit** (vezi 3). |

## 2. Import din contul tău de ChatGPT sau Claude
1. **Exportul** îl ceri tu, din contul tău:
   - ChatGPT: Setări → Controale de date → Exportă datele;
   - Claude: Setări → Confidențialitate → Exportă datele.
   - Primești pe e-mail o arhivă .zip.
2. **În Import:** alegi proiectul, apoi arhiva (sau doar `conversations.json` din ea), bifezi conversațiile și apeși „Importă”.
3. **Ce devine fiecare conversație:** un chat al proiectului, marcat „ChatGPT ⇣” sau „Claude ⇣”. Îl deschizi în Chat și poți scrie mai departe, cu orice model; istoria vine cu întrebarea.

**Ce rămâne neschimbat:**
- fișierul e citit **doar pe dispozitiv** și nu pleacă nicăieri;
- memoria oficială nu se schimbă: propunerile le ceri apoi în Chat și le confirmi tu.

**Limite:**
- fișier de cel mult 150 MB; din arhivă se citește doar `conversations.json`, de cel mult 80 MB;
- o conversație păstrează ultimele 400 de mesaje;
- imaginile și mesajele interne ale uneltelor nu se importă;
- conversațiile importate deja sunt marcate, ca să nu le aduci de două ori din greșeală.

**Gemini nu e inclus încă:** exportul lui (Google Takeout) are alt format și îl putem adăuga separat.

## 3. Modul gratuit
- **Modelul gratuit:** primul din listă, **GPT-OSS 20B** (model deschis). Merge prin serviciul public **Pollinations**, fără cont, fără cheie și fără cost.
- **Fără conectare la Puter:** în cardul de conectare există butonul „Folosește modul gratuit”.
- **Comutarea automată:** când creditul Puter se termină, aceeași întrebare continuă pe modelul gratuit, într-un chat nou legat de cel vechi. Pornită implicit; se poate opri din foaia Model.
- **Acordul:** prima dată când ar pleca ceva la Pollinations automat, aplicația **întreabă o singură dată**. Pollinations e altă firmă, iar memoria trimisă ajunge acolo. Dacă alegi singur modelul gratuit, asta e acordul tău.
- **Limitele serviciului:**
  - e mai lent, are o limită de folosire rezonabilă și un singur model;
  - setările de lungime de la Economie nu se aplică acolo;
  - aplicația îi respectă limitele: o cerere o dată, fără reîncercări repetate;
  - la „ocupat”, spune să aștepți câteva secunde.
- **Securitate:**
  - CSP-ul permite în plus exact `https://text.pollinations.ai`;
  - codul care vorbește cu el e un fișier separat, încărcat doar când e folosit, și nu conține altă adresă (verificat de test).
  - Textul „Datele tale” din Setări spune acum și asta.

**Variante gratuite verificate și lăsate deoparte:**
- **Qwen rulat chiar pe telefon** (WebGPU): ar însemna o descărcare de ~0,5–1 GB și ar merge greu pe telefon. Îl putem adăuga ca opțiune separată dacă vrei.
- **Serviciile care cer cheie sau cont separat**: nu le-am folosit, ca să nu ai nimic de configurat.

**De știut:** adresa folosită e cea publică, fără cheie. Pollinations recomandă pentru aplicații noi o adresă cu cheie. Azi cea fără cheie merge: am verificat cu o cerere reală, cu răspuns „Salut!”. Dacă o închid, modul gratuit va spune că serviciul nu răspunde, iar modelele Puter merg în continuare.

## 4. Teste
**`npm run verify`:** 138 de teste unitare; în browser, 251 trecute și 41 sărite (WebKit, ca înainte).

**Teste noi:**
- **unitare** (`tests/unit/importer.test.ts`):
  - exporturile ChatGPT (ramura vizibilă, fără sistem, unelte sau imagini) și Claude;
  - conversațiile lungi, fișierele necunoscute, citirea doar a `conversations.json` din arhivă;
  - chatul importat: închis, în ordine, cu numele originii; trece prin export/import și jurnal;
  - modelul gratuit; întrebarea repetată trimisă o singură dată.
- **în browser** (`tests/e2e/import.spec.ts`, plus teste noi în `chat.spec.ts`):
  - importul și continuarea gratuită fără cont Puter;
  - un fișier greșit;
  - comutarea automată, cu acordul cerut o dată;
  - foaia Cont se închide;
  - un formular nu se închide la o atingere în afara lui.
- Serviciile externe sunt **simulate**; orice altă cerere spre exterior pică testul.

**Teste vechi atinse**, fiecare cu comentariu:
- `shell.spec.ts` și `verify.spec.ts`: tabul Lansator e acum Import, iar pagina Lansator e verificată în continuare;
- `build.test.ts`: CSP-ul are originea Pollinations, iar un singur fișier separat are voie să o contacteze;
- `chat.spec.ts` (din AIW-06):
  - estimarea s-a mutat pe butonul Economie;
  - testul „credit terminat” oprește întâi comutarea automată, ca să verifice în continuare mesajul de eroare.

## 5. Verificarea independentă
A găsit 9 probleme. Toate sunt reparate:

1. Acord cerut **înainte** ca ceva să plece automat la Pollinations.
2. Comutarea automată pe gratuit:
   - nu mai pornește dacă ai plecat de pe chat;
   - nu mai scrie setări vechi;
   - leagă chatul nou de cel cu întrebarea.
3. Formularele nu se mai închid la o atingere în afara lor; foile doar de citit se închid doar dacă și apăsarea a început în afară.
4. Un nume de model ca „constructor” nu mai strică numele asistentului.
5. Adresa fără cheie a serviciului gratuit poate fi închisă de Pollinations: e notată la 3, cu ce se întâmplă atunci.
6. Răspunsurile gratuite nu mai sunt marcate greșit „tăiate”.
7. Limite mai mici pentru fișierele de import, cu un mesaj clar.
8. „Selectează tot” bifează doar ce se vede; căutarea golește selecția; marcajul „importată deja” se actualizează.
9. Titlurile lungi tăiate nu mai pot strica arhiva.
