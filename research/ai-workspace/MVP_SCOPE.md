# MVP_SCOPE — ce intră în prima versiune și ce amânăm

Ordinea respectă prioritățile cerute: telefon și PC → proiecte → salvare/export → memorie → continuitate → browser → extindere.

## Intră în MVP (v0.1)
**1. Acces de pe telefon și PC**
- Un link pe GitHub Pages, ecrane gândite întâi pentru telefon.
- Se poate adăuga pe ecranul principal și merge fără internet.
- Română și engleză din prima zi (ca în suita office).

**2. Proiecte**
- Creare, redenumire, arhivare (fără ștergere definitivă din prima, ci un coș cu confirmare), căutare după nume.
- Fiecare proiect are:
  - instrucțiuni (text);
  - intrări: notițe, conversații salvate (lipite), decizii, sarcini;
  - fișiere atașate mici (limită de mărime per fișier și per proiect).
- Istoric: orice modificare e o intrare nouă; vechea versiune rămâne vizibilă.

**3. Salvare și export**
- Stocare în browser; cere stocare persistentă și afișează clar dacă browserul a refuzat.
- Export complet al unui proiect (`.aiw.zip`) și backup al tuturor proiectelor.
- Import cu verificare și previzualizare. Restaurarea nu suprascrie nimic fără confirmare.
- Memento de backup (de exemplu la 7 zile), important mai ales pe iPhone.

**4. Memorie**
- Secțiunile fixe: obiective, reguli, stare actuală, decizii, probleme deschise, următorii pași.
- Editare de către utilizator. Propunerile venite din răspunsuri AI importate intră doar cu confirmare.

**5. Continuitate între AI-uri**
- „Pregătește contextul” pentru Claude, ChatGPT sau Gemini, cu text adaptat, limită de mărime și previzualizare.
- Avertizare dacă textul conține ceva ce seamănă a cheie secretă.
- Butoane „Copiază” și „Deschide”, plus „Lipește răspunsul”, care salvează răspunsul ca intrare (`ai-reply`) și poate propune actualizări de memorie (cu confirmare).

**6. Lansatorul de site-uri**
- Taburi cu site-urile preferate (implicit ChatGPT, Claude, Gemini, GitHub); se deschid în filă nouă.
- Încorporare doar pentru site-urile care o permit; site-urile AI nu se încorporează.

**Calitate**
- Teste automate: format, jurnal, export/import cap-coadă, injecție în textul importat, „fără rețea”.
- Verificarea manuală pe Chrome Android, Safari iPhone și Chrome/Edge pe PC.

## Amânate (nu în MVP)
| Funcție | De ce |
| --- | --- |
| Sincronizare automată între dispozitive | cere stocare externă, decizie de securitate separată |
| Conturi de utilizator / server | contrazice „fără server, 0 USD” |
| Apeluri directe la API-uri AI | buget 0 USD; și ar cere chei |
| Browser integrat complet | imposibil tehnic pentru site-urile AI (refuză încorporarea) |
| Extensie de browser | instalare obligatorie; pe iPhone doar prin App Store |
| Fișiere mari, dosare întregi, deschiderea fișierelor de pe disc | limitele browserului diferă mult între telefoane |
| Colaborare cu alți oameni | nu e în viziunea primei versiuni |
| Legătura aplicației cu back-office-ul Gepeto–Claudiu | după ce PR #2 e aprobat și MVP-ul merge |
| Publicare publică/marketing | doar cu aprobarea lui Adrian |

## Criterii de „gata” pentru MVP
1. Un proiect creat pe telefon, exportat, importat pe PC, arată identic, cu memoria și istoricul.
2. Un pachet de context lipit în ChatGPT/Claude/Gemini e înțeles fără explicații suplimentare (testat manual cu fiecare).
3. Aplicația nu face nicio cerere de rețea în afara propriului site (verificat automat și în instrumentele browserului).
4. Toate testele trec; gardianul repo-ului trece; Adrian a aprobat publicarea.
