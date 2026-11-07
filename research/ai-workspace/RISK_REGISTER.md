# RISK_REGISTER — riscuri tehnice, de securitate, costuri și limitări

Probabilitate / impact: M = mare, m = mediu, s = scăzut.

| # | Risc | Prob. | Impact | Măsură |
| --- | --- | --- | --- | --- |
| R1 | **Datele dispar pe iPhone** (Safari șterge datele unui site nevizitat 7 zile în Safari) | M | M | aplicația se adaugă pe ecranul principal (scutită); cerere de stocare persistentă; memento de backup; avertizare vizibilă |
| R2 | Utilizatorul curăță datele browserului sau schimbă telefonul și pierde tot | M | M | export simplu, backup complet, memento periodic; mesaj clar „datele stau doar pe acest dispozitiv” |
| R3 | **Așteptări greșite de la Browser Workspace** (oamenii cred că vor vedea ChatGPT în aplicație) | M | m | numele și textul spun „lansator”; explicație la primul tab; nu promitem încorporarea |
| R4 | Linkurile cu întrebarea pre-completată (`?q=`) se schimbă sau dispar la furnizori | m | s | clipboard ca metodă principală; linkul doar ca bonus |
| R5 | **Codul e public** (Pages publică site-ul chiar din repo privat) | sigur | s | nu există secrete în cod (test); datele nu trec prin Pages; proprietatea se protejează prin licență, nu prin ascundere |
| R6 | Text malițios în răspunsuri AI lipite (injecție de instrucțiuni, HTML/scripturi) | m | M | afișare fără HTML; CSP strictă; nimic nu se aplică automat; teste cu atacuri (reluate din `tests/test_security.py`) |
| R7 | Arhivă de import modificată sau construită rău intenționat (căi `../`, fișiere uriașe, „bombe zip”) | m | m | verificarea căilor, a mărimilor, a amprentelor și a versiunii; previzualizare înainte de import |
| R8 | Chei secrete lipite în proiecte, apoi exportate sau trimise unui AI | M | M | căutare de chei la export și la „Pregătește contextul”, cu avertizare |
| R9 | **`main` neprotejat** (se poate rescrie istoria) | m | M | Adrian activează regulile (rulesets) pentru `main`, pas din planul de activare |
| R10 | Sesiunile Claude urcă cu contul lui Adrian; gardianul nu le deosebește | sigur | m | aplicația GitHub a lui Claudiu la activare; până atunci, fără îmbinări fără PR aprobat |
| R11 | Două implementări ale formatului (Python, TypeScript) se despart | m | m | exemple comune în `fixtures/`, testate de ambele |
| R12 | O dependență open-source își schimbă licența sau e compromisă | s | M | puține dependențe, versiuni fixe, fișier de blocare, verificarea licențelor la fiecare actualizare |
| R13 | **Cost:** depășirea minutelor GitHub Actions incluse | s | s | workflow-uri doar la cerere sau la PR; plafon 0 USD în contul GitHub (de confirmat de Adrian) |
| R14 | Cost ascuns: un serviciu de sincronizare ar cere plată | m | m | sincronizarea e amânată și se alege doar dintre variante gratuite, cu aprobare |
| R15 | Limitele GitHub Pages (site public, ~1 GB, trafic limitat) | s | s | aplicația are câțiva MB; datele nu stau pe Pages |
| R16 | Pachetul de context e prea mare pentru un AI sau pentru clipboard | m | s | limită de mărime, alegerea secțiunilor, rezumat confirmat de utilizator |
| R17 | Termenii furnizorilor AI (automatizare, extragere de date) | s | M | nu automatizăm conturile și nu citim conversațiile lor; utilizatorul copiază singur |
| R18 | Telefoanele slabe și ecranele mici | m | m | interfață ușoară (Preact), testată pe un Android ieftin și pe iPhone |
| R19 | Complicarea produsului (prea multe module prea devreme) | m | m | MVP strict; module noi doar cu un plus clar |
| R20 | Confuzia între back-office (Gepeto–Claudiu) și produs | m | s | directoare separate, README clar, gardianul protejează ambele |

## Limitări asumate în MVP
- Fără sincronizare automată.
- Fără browser integrat pentru site-urile AI.
- Fără apeluri AI din aplicație.
- Datele trăiesc pe un singur dispozitiv până la export.
