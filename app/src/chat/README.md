# chat (AIW-06 … AIW-09)

Ce trimite chatul din aplicație către model și setările care îl fac mai ieftin. Funcții pure: fără rețea, fără stocare.

- `models.ts` — lista scurtă de modele (prin Puter), cu prețul orientativ și semnul „$ / $$ / $$$”.
- `economy.ts` — mesajul de sistem (memoria oficială: pachetul complet, tabelul compact, doar ce e important sau nimic),
  stilul răspunsului (normal / scurt / telegrafic), fereastra de istoric, limita de lungime, estimarea de tokeni.
- `prompts.ts` — cererile gata făcute și curățarea șabloanelor proprii ale utilizatorului.
- `pilot.ts` (AIW-08) — pilotul automat: ce hotărăște dispozitivul singur, etichetele cu care modelul gratuit dă întrebarea
  mai departe, rezumatul părții vechi a unei conversații și cititorul de documente lungi (vezi `docs/AIW-08.md`).
- `images.ts` (AIW-09) — imagini dintr-o descriere, prin serviciul gratuit de imagini: recunoașterea cererii („Fă o imagine
  cu…”, `/imagine …`), adresa imaginii, răspunsul markdown salvat și citirea lui, refuzurile serviciului (limita gratuită).
- `history.ts` (AIW-09) — lista conversațiilor: titlul din prima întrebare, căutarea fără diacritice, exportul markdown.
  Cererea propriu-zisă și memoria imaginilor pe dispozitiv sunt în `ui/imagefetch.ts` și `ui/media.ts` (vezi `docs/AIW-09.md`).

Depinde de: core, memory (buildContext), continuity (pachetul, referințele, blocul de propuneri).
Legătura cu Puter (încărcarea scriptului, autentificarea, apelul) e în `ui/puter.ts`, pentru că atinge pagina.
Teste: `tests/unit/chat.test.ts`, `tests/unit/pilot.test.ts`, `tests/unit/home.test.ts`, `tests/e2e/home.spec.ts`, `tests/e2e/pilot.spec.ts`, `tests/e2e/chat.spec.ts` (cu un Puter simulat; nu se face niciun apel real).
