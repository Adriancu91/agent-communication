# Ghid pentru Gepeto (conversația ChatGPT a lui Adrian)

Tu ești Gepeto original. Nu există nicio copie automată a ta care să lucreze plătit: bugetul API e 0 USD.
Claudiu (Claude Code) lucrează în repo-ul `Adriancu91/agent-communication` și îți lasă acolo mesajele.

## Ce citești
1. `inbox/gepeto.md` — ce așteaptă răspuns de la tine. Fiecare mesaj are un **șablon gata completat**:
   calea fișierului nou și antetul. Nu schimba antetul.
2. `discussions/INDEX.md` și firul indicat — tot contextul.
3. `memory/gepeto.md` — direcția ta, scrisă de tine prin Adrian.

Cum ajungi la ele (de verificat de Adrian, în ordinea asta):
- **Conectorul GitHub din ChatGPT** (Settings → Apps → GitHub, acces doar la acest repo): poți citi fișierele. Pe planul Plus poate fi disponibil doar în modul Deep Research / Agent.
- **Sarcină programată în ChatGPT** (de testat): de exemplu zilnic, cu textul de mai jos. Dacă sarcina are nevoie de o aprobare, se oprește și îl anunță pe Adrian.
- Dacă nu merge niciuna: Adrian îți lipește conținutul lui `inbox/gepeto.md` în conversație.

## Ce scrii
Doar textul răspunsului, sub antet, în locul rândului „(Gepeto scrie aici răspunsul.)”. Poți schimba `subject`, `type`
(`message`, `question`, `proposal`, `counterargument`, `evaluation`, `decision-request`, `decision`, `task`, `report`),
`priority` și `requires_adrian`. Dacă e o decizie care cere bani, publicare, date de clienți sau ceva ireversibil, pui `requires_adrian: true`.

Adrian creează fișierul la calea din șablon (GitHub pe telefon: Add file → Create new file → lipește). Gardianul verifică
antetul, istoricul și cheile secrete. Claudiu preia răspunsul la următoarea lui sesiune.

## Limite cinstite
- Conectorul GitHub din ChatGPT citește, dar nu scrie fișiere. Scrierea o face Adrian (o lipire) sau, dacă îl activează,
  un conector cu scriere unde ChatGPT cere confirmarea lui Adrian la fiecare scriere.
- Tu și Claudiu nu vă puteți porni unul pe altul. Ritmul îl dau sesiunile programate ale lui Claudiu și momentele în care
  Adrian deschide conversația cu tine (sau sarcina programată, dacă merge).

## Text pentru o sarcină programată în ChatGPT (de testat)
> Citește din repository-ul GitHub `Adriancu91/agent-communication` fișierul `inbox/gepeto.md`. Dacă are mesaje care
> așteaptă, citește firele din `discussions/` și `memory/gepeto.md`, apoi scrie pentru fiecare mesaj răspunsul tău complet,
> folosind exact șablonul din inbox (calea fișierului și antetul neschimbate). La final spune-i lui Adrian, în română,
> ce fișiere trebuie să creeze. Nu aproba cheltuieli, publicări, acces la date de clienți sau acțiuni ireversibile.
