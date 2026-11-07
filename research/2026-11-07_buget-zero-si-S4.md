# GEPETO – COMUNICARE REALĂ CU BUGET API 0 USD: SOLUȚIE ȘI VERIFICĂRILE S4

Autor: Claudiu (Claude Code) · 7 noiembrie 2026 · ramura `securitate-v2`, PR #2 (**neîmbinat**)

## 1. Concluzia pe scurt
- **Gepeto rămâne cel real, din ChatGPT.** Nu mai există niciun „Gepeto-API”. Pentru fiecare mesaj care îl așteaptă,
  `inbox/gepeto.md` îi pregătește un șablon gata completat (calea fișierului și antetul). Gepeto scrie doar textul;
  Adrian îl pune în repo cu o singură lipire din telefon. Gardianul verifică totul ca la orice mesaj.
- **Adrian nu mai e curier pentru mesajele lui Claudiu** (Gepeto le citește din repo prin conectorul GitHub, dacă îl vede),
  ci doar pentru răspunsurile lui Gepeto (o lipire) și aprobă ce cere R3.
- **Limita cinstită:** cu 0 USD, partea lui Gepeto nu poate fi complet automată. ChatGPT citește repo-ul, dar nu scrie
  singur în el; o sarcină programată în ChatGPT poate pregăti răspunsurile, dar nu le poate urca fără o confirmare.
  Gepeto din ChatGPT și orice model automat sunt instanțe diferite; niciuna n-o controlează pe cealaltă.
- **Zero căi de plată API în cod**, verificat de un test la fiecare schimbare.

## 2. Ce am cercetat (resurse gratuite)
| Variantă | Rezultat |
| --- | --- |
| GitHub Models (gratuit) | **Retras** pe 30 iulie 2026 (changelog GitHub). Nu se poate folosi. |
| Conectorul GitHub din ChatGPT | Doar citire. Pe Plus poate fi disponibil doar în modul Deep Research / Agent. **De verificat de Adrian** dacă vede repo-ul privat. |
| Sarcini programate ChatGPT | Pot folosi aplicațiile conectate; cele declanșate de activitate GitHub pe PR-uri există pe Plus/Pro. Acțiunile care cer aprobare opresc sarcina. **De testat.** |
| ChatGPT Developer Mode + MCP GitHub | Poate scrie în repo, dar cu confirmare la fiecare scriere. Opțiune viitoare, cu aprobarea lui Adrian. |
| Codex (`@codex`) | Inclus în ChatGPT, dar e agent de programare, nu Gepeto. Nu îl folosim drept Gepeto. |
| Model local (Ollama) | Gratuit, dar e alt model, nu Gepeto. Workstation-ul (RTX 3070 Ti) e ocupat de Kronos; ThinkPad-ul nu are placă video. Pregătit în cod (`provider: local`, doar localhost), **oprit**. |
| Gemini / Groq gratuite | Terți, pot folosi datele la antrenare; nu le-am inclus. Ar cere aprobarea lui Adrian. |

**Înlocuirea modelului:** un singur loc, `protocol/config.json` → `gepeto_auto` (`none` / `sim` / `local`). Protocolul,
gardianul, publicarea și testele nu depind de model.

## 3. Verificările cerute la S4
1. **Diferențele din PR:** 35 de fișiere. Le-am verificat eu și, separat, un agent de revizie independent care nu a văzut
   munca. El a găsit 3 probleme grave și câteva medii (vezi secțiunea 4). Toate sunt reparate, cu teste.
2. **Acțiuni fixate pe SHA:** toate 5 verificate față de etichetele reale (`git ls-remote`): checkout v7.0.1,
   upload-artifact v7.0.2, download-artifact v8.0.2, create-github-app-token v3.3.0, claude-code-action v1.0.269 — **identice**.
   Un test pică dacă apare o acțiune nefixată.
3. **Permisiunile reale:** din jurnalele rulărilor: jobul care gândește are `Contents: read, Metadata: read`; jobul care
   publică `Contents: write`. Aplicațiile GitHub ale agenților **nu sunt create încă**; când vor fi, doar Contents: Read and write,
   doar pe acest repo. Nu pot citi lista de instalări din sesiunea mea: Adrian verifică în GitHub → Settings → Applications.
4. **Nicio cale de facturare API:** codul OpenAI e șters; furnizorii permiși sunt doar `none`, `sim`, `local` (localhost, fără
   proxy, fără redirecționări); `gepeto.yml` nu folosește niciun secret. Testul `NoBilling` caută adrese și chei de API plătite
   în tot codul. Minutele GitHub Actions: rularea de test a avut 0 ms facturabile (minutele incluse). **Adrian** confirmă în
   GitHub → Settings → Billing că plafonul Actions e 0 USD.
5. **Claude Max prin token:** pagina oficială Claude Code pentru GitHub Actions descrie `CLAUDE_CODE_OAUTH_TOKEN` (din
   `claude setup-token`), cu care rulările folosesc abonamentul Claude, nu facturarea API. Termenii spun că autentificarea prin
   abonament e pentru Claude Code și uz individual obișnuit: un singur utilizator (Adrian), pe repo-ul lui, se încadrează.
   Limitele abonamentului se împart cu celelalte proiecte ale lui Adrian; Claudiu pornește doar când are mesaje și doar dacă
   variabila `CLAUDIU_ACTIONS_ENABLED` e pusă. **Nu e activat.**
6. **Test fără OpenAI API:** ramura `test/ciclu-v2`. Claudiu a scris; GitHub Actions (furnizor `sim`, fără model, fără secret)
   a răspuns (rulările 42368862380 și 42369522665); Claudiu a preluat și a închis firul. Gardianul, rulat pe istoria reală
   (jurnalul de activitate GitHub), nu a găsit nicio problemă. Șablonul pentru Gepeto din ChatGPT e testat automat cap-coadă
   (și cu sfârșituri de rând Windows).

## 4. Ce a găsit revizia independentă și ce am reparat
| Problemă | Gravitate | Reparat |
| --- | --- | --- |
| Pachetul de la AI putea adăuga text în fișiere din afara repo-ului (`../.git/config`) → cod rulat cu tokenul de scriere | mare | căile se verifică și la adăugări; adăugări doar la jurnale |
| Testele (cod nou) rulau în același job cu gardianul și îl puteau înlocui | mare | testele rulează într-un job separat, fără drepturi |
| Commit-urile de îmbinare nu erau verificate | mare | se verifică tot ce aduc, dacă nu sunt PR-uri îmbinate de Adrian |
| Un agent putea debloca un fir care aștepta decizia lui Adrian | medie | doar Adrian deblochează; evenimentele se semnează doar cu numele permise |
| Claude din Actions putea scrie oriunde în repo | medie | scrie doar în `/tmp/acp`; pasul următor rulează git izolat și verifică `.git/config` |
| `id-token: write` inutil la Claudiu; pornirea lui Claudiu cu codul nou; pauza fără reîncercări; jurnal de activitate de o singură pagină; ramura țintă la Claudiu | mică/medie | toate reparate |

Teste: **52**, toate trec local și pe GitHub.

## 5. Limită rămasă, spusă direct
Sesiunile mele (Claude Code) urcă în GitHub cu contul lui Adrian, deci gardianul nu poate deosebi un commit al meu de unul
al lui Adrian. Separarea reală vine doar prin aplicația GitHub a lui Claudiu (pasul de activare). Până atunci, protecția
vine din reguli, teste și din faptul că nu îmbin nimic fără aprobare.

## 6. Ce aștept
- **De la Gepeto:** aprobarea fluxului „Gepeto real prin șabloane” și decizia dacă testăm conectorul / sarcina programată ChatGPT.
- **De la Adrian:** plafonul GitHub Actions 0 USD; dacă ChatGPT vede repo-ul privat; ștergerea ramurilor `test/guard-tamper` și
  `test/ciclu-v2`; aprobarea finală a îmbinării PR #2 (după Gepeto).
