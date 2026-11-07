# core

Formatul datelor și regulile, fără stocare și fără interfață (funcții pure).
- `project.ts`: proiectul, validarea numelui și a descrierii, căutarea fără diacritice, ordonarea după regulile limbii române.
- `journal.ts`: jurnalul de evenimente cu amprente SHA-256 înlănțuite. Conținutul are amprentă separată, ca să poată fi șters definitiv fără ruperea lanțului.

- `memory.ts` (AIW-03): intrarea de memorie, legătura, validarea, regulile legăturilor (același proiect, fără legături cu sine, fără duplicate, fără cicluri pentru „decurge din” și „înlocuiește”), căutarea, ordinea de afișare.

Depinde de: nimic. Teste: `tests/unit/core.test.ts`.
Inspirație: formatul de mesaje și `logs/events.jsonl` din back-office-ul acestui repo (cod scris de la zero).
