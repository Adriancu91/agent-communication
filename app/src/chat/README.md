# chat (AIW-06)

Ce trimite chatul din aplicație către model și setările care îl fac mai ieftin. Funcții pure: fără rețea, fără stocare.

- `models.ts` — lista scurtă de modele (prin Puter), cu prețul orientativ și semnul „$ / $$ / $$$”.
- `economy.ts` — mesajul de sistem (memoria oficială: pachetul complet, tabelul compact, doar ce e important sau nimic),
  stilul răspunsului (normal / scurt / telegrafic), fereastra de istoric, limita de lungime, estimarea de tokeni.
- `prompts.ts` — cererile gata făcute și curățarea șabloanelor proprii ale utilizatorului.

Depinde de: core, memory (buildContext), continuity (pachetul, referințele, blocul de propuneri).
Legătura cu Puter (încărcarea scriptului, autentificarea, apelul) e în `ui/puter.ts`, pentru că atinge pagina.
Teste: `tests/unit/chat.test.ts`, `tests/e2e/chat.spec.ts` (cu un Puter simulat; nu se face niciun apel real).
