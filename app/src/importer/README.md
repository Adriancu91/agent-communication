# importer (AIW-06.1)

Citește conversațiile exportate de utilizator din contul lui de ChatGPT sau Claude (fișierul `conversations.json`,
singur sau din arhiva .zip primită pe e-mail) și le transformă într-o listă de conversații (întrebare / răspuns).
Funcții pure: fără rețea, fără stocare. Salvarea ca chat în proiect e în `continuity` (`SessionStore.importChat`),
ecranul în `ui/import.tsx`.

- ChatGPT: ramura vizibilă (de la `current_node` în sus), fără mesajele de sistem, de unelte sau ascunse.
- Claude: `chat_messages` cu `sender` human / assistant.
- Mesajele consecutive ale aceleiași părți se unesc; o conversație păstrează ultimele 400 de mesaje.

Depinde de: core. Teste: `tests/unit/importer.test.ts`, `tests/e2e/import.spec.ts`.
