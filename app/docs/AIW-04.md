# AIW-04 — Export și import

**Stare:** implementat (misiune autonomă AIW-04 + AIW-05, 7 noiembrie 2026). PR separat, pornit din AIW-03. **Neîmbinat, nepublicat.**

## 1. Ce face
- **Exportul unui proiect:** din pagina proiectului („Exportă proiectul”) sau din meniul ⋯ din listă.
- **Exportul tuturor proiectelor**, inclusiv cele din coș: Setări → Copii de siguranță → „Exportă toate proiectele”.
- **Ce intră în arhivă:**
  - proiectul, cu istoricul numelor;
  - toată memoria: toate cele 7 tipuri, inclusiv propunerile neconfirmate, respinse și arhivate;
  - legăturile dintre informații;
  - istoricul complet al proiectului, din care se văd și versiunile anterioare.
- **Formatul:** o arhivă `.zip`, de exemplu `ai-workspace-oferta-braila-2026-11-07.zip`.
- **Descărcarea:** după export apare o fereastră cu „Descarcă arhiva”. Pe telefoanele care permit, apare și „Salvează sau trimite” (foaia de partajare: Fișiere, AirDrop, e-mail). Atingerea suplimentară e intenționată: unele telefoane salvează un fișier doar după o apăsare directă.
- **Importul:** Setări → „Importă dintr-o arhivă”. Arhiva e verificată complet înainte de orice scriere.
- **Previzualizarea**, pentru fiecare proiect din arhivă:
  - câte informații, legături și versiuni anterioare are;
  - câte propuneri neconfirmate are;
  - dacă e în coș;
  - cum se raportează la acest dispozitiv;
  - ce poți alege.
- **Duplicatele**, cu opțiunea implicită pusă prima:

  | Situația | Opțiuni |
  | --- | --- |
  | Proiect nou | **Adaugă** · Sari peste |
  | Există aici, identic | **Sari peste** · Copie nouă |
  | Există aici, cu alt conținut | **Sari peste** · Înlocuiește · Copie nouă |
  | Alt proiect cu același nume | **Copie nouă** · Sari peste |

  - „Copie nouă” primește un nume liber, de exemplu „Oferta Brăila (2)”.
  - „Înlocuiește” afișează un avertisment și îți recomandă să exporți întâi proiectul de pe acest dispozitiv.
- **Importul e atomic:** totul se scrie într-o singură tranzacție. Dacă ceva eșuează, nu se schimbă nimic. Exemple:
  - spațiul de stocare e plin;
  - un id e deja folosit aici de alt proiect;
  - proiectele de pe dispozitiv s-au schimbat după previzualizare.

## 2. Formatul arhivei (`aiw-export`, versiunea 1)
```
aiw-export.json             manifestul: format, versiune, versiunea aplicației, data, scop (un proiect / toate),
                            lista proiectelor cu fișierul și amprenta SHA-256 a fiecărui fișier,
                            rezultatul verificării jurnalului pe dispozitivul de origine (doar informativ)
projects/<id proiect>.json  { project, memory[], links[], events[] } — înregistrările exact ca pe dispozitiv;
                            events = istoricul proiectului, cu amprentele originale
CITESTE.txt                 explicație pentru oameni (ignorată la import)
```
- **Istoricul exportat** cuprinde evenimentele care descriu proiectul așa cum e acum: de la ultimul lui import încoace, dacă a fost importat.
  - Conținutul șters definitiv (date `null`) **nu** se exportă: ce ai șters rămâne șters.
- **Compatibilitatea:**
  - O versiune viitoare a aplicației citește arhivele versiunii 1.
  - O versiune mai veche refuză clar o arhivă mai nouă: „Actualizează aplicația”.
  - Proiectele din AIW-02 (fără memorie) se exportă și se importă normal (testat).
  - Baza de date nu se schimbă: **nicio migrare nouă**.

## 3. Verificarea înainte de import
Nu se scrie nimic până nu trec toate verificările.

**Verificările ZIP-ului.** ZIP-ul e scris și citit de cod propriu (`src/archive/zip.ts`), fără biblioteci noi.
- **Structura:** fără criptare, fără ZIP64, fără arhive pe mai multe volume.
- **Numele fișierelor:**
  - doar nume simple, fără `..`, fără căi absolute și fără duplicate;
  - doar fișierele așteptate: orice alt fișier, de exemplu `run.js`, duce la refuz.
- **Limite:**
  - arhiva are cel mult 64 MB;
  - un fișier despachetat are cel mult 64 MB, iar toate fișierele împreună cel mult 128 MB.
- **Protecția la „zip bomb”:** despachetarea se oprește imediat ce depășește mărimea declarată.
- **Corupția:**
  - **CRC-32** pentru fiecare fișier;
  - antetul local al fiecărui fișier trebuie să coincidă cu cuprinsul arhivei;
  - opțiunile ZIP necunoscute sunt refuzate.

**Verificările formatului** (`src/archive/archive.ts`):
- **Amprentele:** amprenta SHA-256 a fiecărui fișier de proiect trebuie să coincidă cu cea din manifest.
- **Câmpurile:**
  - fiecare înregistrare are exact câmpurile cunoscute: un câmp în plus, de exemplu `script`, duce la refuz;
  - fiecare câmp are tipul și limitele lui: lungimi, caractere de control, date ISO, id-uri;
  - fiecare legătură are ambele capete în același proiect.
- **Istoricul:**
  - fiecare eveniment are amprenta conținutului și amprenta antetului la fel ca pe dispozitivul de origine;
  - evenimentele sunt în ordine.
- **Consecvența:**
  - textul curent al fiecărei informații e egal cu ultima ei versiune din istoric;
  - fiecare stare (înlocuită / rezolvată) se potrivește cu legăturile.

**Testul exhaustiv:** am modificat pe rând fiecare octet al unei arhive reale, iar fiecare modificare e refuzată. Excepție fac doar octeții fără înțeles: data fișierelor și numărul de versiune ZIP.

**Ce nu poate garanta verificarea:** amprentele nu sunt o semnătură (aplicația nu are chei, intenționat). Cineva care modifică arhiva **și** recalculează consecvent toate amprentele o poate face acceptată. Verificarea detectează:
- deteriorarea;
- modificările făcute de mână;
- arhivele care nu sunt ale noastre.

**Nimic din arhivă nu se execută:** fișierele sunt citite doar ca date JSON.

## 4. Cum se scrie importul în jurnal
Jurnalul fiecărui dispozitiv e un lanț de amprente și nu poate primi evenimente cu numere și legături de pe alt dispozitiv. De aceea, importul procedează astfel:
1. **Un eveniment nou, `project.imported`**, cu:
   - modul ales (adăugare, copie, înlocuire);
   - amprenta manifestului, care identifică exact arhiva;
   - data exportului, versiunea aplicației și proiectul sursă.
2. **Istoricul din arhivă, adăugat eveniment cu eveniment** la jurnalul dispozitivului:
   - fiecare eveniment păstrează **data lui originală**, tipul, informația la care se referă și conținutul;
   - versiunile anterioare și istoricul legăturilor se văd la fel ca pe dispozitivul de origine;
   - lanțul dispozitivului rămâne valid.
3. **Copia nouă:** toate id-urile (proiect, informații, legături) sunt înlocuite consecvent, inclusiv cele din istoric. Dacă numele s-a schimbat, se adaugă un eveniment de redenumire.
4. **Înlocuirea:**
   - proiectul, memoria și legăturile de aici sunt înlocuite;
   - **evenimentele vechi rămân în jurnal**, deci nimic nu se șterge din istorie și lanțul rămâne verificabil;
   - istoricul afișat, versiunile și verificarea integrității pornesc de la ultimul `project.imported` al proiectului (`currentEvents()` în `core/journal.ts`).

## 5. Fișiere
| Fișier | Rol |
| --- | --- |
| `src/archive/zip.ts` | scriere / citire ZIP, CRC-32, limite, nume sigure |
| `src/archive/archive.ts` | formatul `aiw-export` v1 și verificarea strictă |
| `src/archive/service.ts` | `TransferService`: export dintr-o singură citire, previzualizare, import atomic |
| `src/ui/backup.tsx` | cardul din Setări, fereastra „Arhiva e gata”, previzualizarea importului |
| `src/core/journal.ts` | `project.imported`, `eventHash()`, `currentEvents()` |
| `src/storage/journaled.ts` | un eveniment poate avea data lui (istoricul importat) |

Modulul `archive` era deja prevăzut în arhitectură (`src/modules.json`: `archive → core, storage, security`). Folosește doar `core` și `storage`.

## 6. Teste
**Unitare** (`tests/unit/archive.test.ts`, 14 teste):
- ZIP dus-întors: necomprimat, comprimat, CRC;
- refuzuri: nume nesigure, CRC, arhivă tăiată, „zip bomb”, limite;
- **un proiect cu toate cele 7 tipuri**, versiuni, toate tipurile de legături, o propunere, una respinsă și una arhivată, mutat pe un dispozitiv curat:
  - toate înregistrările, versiunile (cu date) și legăturile sunt identice;
  - verificarea integrității trece pe dispozitivul nou;
  - contextul pentru AI e identic octet cu octet și nu conține propunerile;
- toate proiectele, dus-întors între două dispozitive, cu înlocuire; istoria veche rămâne în jurnal;
- copie nouă: id-uri noi, nume liber, legături și versiuni păstrate;
- același nume; proiecte AIW-02 fără memorie;
- arhive modificate: fișier schimbat; istorie falsă cu amprente recalculate; memorie care nu se potrivește cu istoria; legătură ruptă; câmp străin; fișier străin; versiune mai nouă; fișier care nu e al nostru;
- **atomicitatea:** un id ocupat face ca **niciun** proiect din arhivă să nu fie importat, iar jurnalul rămâne neschimbat;
- refuzul când dispozitivul s-a schimbat după previzualizare; refuzul unei opțiuni neoferite;
- **modificarea fiecărui octet** al unei arhive.

**În browser** (`tests/e2e/archive.spec.ts`, pe iPhone 15, iPhone SE, Android și PC):
- export → import pe un „dispozitiv” curat (alt context de browser): cele 7 tipuri, versiunea anterioară, legătura, propunerea rămasă în afara contextului, verificarea integrității;
- arhive deteriorate sau străine refuzate, fără nicio schimbare;
- duplicate: identic → nimic de importat; schimbat → înlocuire; același nume → „Comun (2)”;
- exportul tuturor proiectelor și importul **fără internet** (doar în motorul Chrome: în teste, motorul iPhone al Playwright nu pornește fiabil service worker-ul; aceeași regulă ca în AIW-01 și AIW-03).

## 7. Limitări
- **Arhiva nu e criptată.** Interfața o spune. Criptarea cu parolă e o opțiune pentru mai târziu.
- **Nu există sincronizare automată.** Mutarea între dispozitive e manuală (export → import), conform bugetului zero și principiului „datele rămân pe dispozitiv”.
- **„Înlocuiește” nu face o fuziune.** Modificările făcute aici după export nu se mai văd, deși rămân în jurnal. Pentru cazurile nesigure există „Copie nouă”.
- **Pe iPhone,** aplicația de pe ecranul principal și Safari au stocări separate. Exportul și importul sunt calea de a muta proiectele între ele.
