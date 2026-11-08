# chat (AIW-06)

Ce trimite chatul din aplicație către model și setările care îl fac mai ieftin. Funcții pure: fără rețea, fără stocare.

- `models.ts` — lista scurtă de modele (prin Puter), cu prețul orientativ și semnul „$ / $$ / $$$”.
- `economy.ts` — mesajul de sistem (memoria oficială: pachetul complet, tabelul compact, doar ce e important sau nimic),
  stilul răspunsului (normal / scurt / telegrafic), fereastra de istoric, limita de lungime, estimarea de tokeni.
- `prompts.ts` — cererile gata făcute și curățarea șabloanelor proprii ale utilizatorului.
- `pilot.ts` (AIW-08) — pilotul automat: ce hotărăște dispozitivul singur, etichetele cu care modelul gratuit dă întrebarea
  mai departe, rezumatul părții vechi a unei conversații și cititorul de documente lungi (vezi `docs/AIW-08.md`).

Depinde de: core, memory (buildContext), continuity (pachetul, referințele, blocul de propuneri).
Legătura cu Puter (încărcarea scriptului, autentificarea, apelul) e în `ui/puter.ts`, pentru că atinge pagina.
Teste: `tests/unit/chat.test.ts`, `tests/unit/pilot.test.ts`, `tests/e2e/pilot.spec.ts`, `tests/e2e/chat.spec.ts` (cu un Puter simulat; nu se face niciun apel real).
