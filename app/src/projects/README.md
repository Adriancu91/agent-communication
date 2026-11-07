# projects

Operațiile cu proiecte:
- creare, deschidere;
- redenumire, cu istoricul numelor;
- descriere;
- fixare sus;
- Coș: mutare, restaurare, ștergere definitivă doar din Coș.

Toate trec printr-o singură cale de scriere: un eveniment în jurnal + noua stare a proiectului, într-o singură tranzacție. O eroare (de exemplu spațiu insuficient) nu lasă nimic pe jumătate.

La ștergerea definitivă, proiectul dispare, iar numele și textele lui sunt șterse și din jurnal. Amprentele rămân, deci lanțul se poate verifica în continuare.

Depinde de: `core`, `storage`. Teste: `tests/unit/projects.test.ts` și `tests/e2e/projects.spec.ts`.
