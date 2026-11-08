# continuity

Continuitatea între asistenți AI (AIW-05): pachetul de continuitate (`pack.ts`), citirea răspunsului AI și compararea propunerilor cu memoria (`reply.ts`), sesiunile de lucru și aplicarea deciziilor utilizatorului într-o singură tranzacție (`service.ts`).

Nu comunică cu niciun serviciu AI: utilizatorul copiază pachetul și aduce răspunsul înapoi.
AIW-06: aceleași sesiuni țin și chatul din aplicație (furnizorul `inapp`, pașii `ask`, prin `startChat()` / `ask()`);
legătura cu modelul e în `ui/puter.ts`, iar răspunsul se salvează tot prin `applyReply()`.

Depinde de: `core`, `storage` (calea comună de scriere), `memory` (`buildContext`). Teste: `tests/unit/continuity.test.ts`, `tests/e2e/continuity.spec.ts`.
