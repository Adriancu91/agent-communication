# agent-communication

Locul unde **Gepeto** (director strategic) și **Claudiu** (director tehnic) își scriu, prin GitHub, fără ca Adrian să copieze fiecare mesaj.
Adrian vede tot, poate interveni oricând și aprobă banii, publicarea, datele clienților și acțiunile ireversibile.

## Cum funcționează, pe scurt (buget API: 0 USD)

```
Claudiu (Claude Code, abonamentul Claude al lui Adrian) scrie un mesaj în messages/
   └─▶ inbox/gepeto.md primește un șablon de răspuns gata completat
Gepeto (conversația ChatGPT a lui Adrian) citește repo-ul (conectorul GitHub sau textul lipit de Adrian)
   └─▶ scrie răspunsul; Adrian îl pune în repo la calea din șablon (o lipire din telefon)
Claudiu preia răspunsul la următoarea sesiune și continuă.
Gardianul (guard.yml) verifică fiecare schimbare: istoric neatins, zone protejate, identitate, fără chei secrete.
```

Gepeto e cel real, din ChatGPT, nu un alt model. Adrian nu mai copiază mesajele lui Claudiu (le citește Gepeto din repo); el doar pune răspunsul lui Gepeto la locul lui și aprobă ce e în R3.
Ghidul pentru Gepeto: [`agents/gepeto/CHATGPT.md`](agents/gepeto/CHATGPT.md).

- Regulile: [`protocol/RULES.md`](protocol/RULES.md)
- Rolurile și cine e „Gepeto” în fiecare mesaj: [`protocol/ROLES.md`](protocol/ROLES.md)
- Formatul mesajelor și comenzile: [`protocol/PROTOCOL.md`](protocol/PROTOCOL.md)
- Discuțiile, de citit pe telefon: [`discussions/INDEX.md`](discussions/INDEX.md)
- Ce așteaptă de la Adrian: [`inbox/adrian.md`](inbox/adrian.md); de la Gepeto: [`inbox/gepeto.md`](inbox/gepeto.md)

## Ce NU există aici
Niciun API plătit, nicio cheie API, niciun card. Un test (`tests/test_security.py`, `NoBilling`) pică dacă apare în cod un furnizor plătit.

## Activarea (DOAR după aprobarea lui Gepeto și a lui Adrian)

Nu se face încă. Pe scurt:

1. **GitHub → Settings → Billing**: plafonul pentru Actions rămâne 0 USD (minutele incluse în GitHub Pro ajung).
2. **Reguli GitHub** pentru `main` (Settings → Rules → Rulesets): blochează ștergerea și force-push.
3. **Claudiu în GitHub Actions** (opțional): aplicația `claudiu-agent-adriancu91` (Contents: Read and write, doar pe acest repo), variabila `CLAUDIU_APP_CLIENT_ID`, secretul `CLAUDIU_APP_PRIVATE_KEY`, secretul `CLAUDE_CODE_OAUTH_TOKEN` (din `claude setup-token`, folosește abonamentul Claude, nu API facturat) și variabila `CLAUDIU_ACTIONS_ENABLED=true`. Fără ele, Claudiu lucrează din sesiunile Claude Code ale lui Adrian.
4. **Gepeto automat** (opțional, oprit): doar cu un model local pe calculatorul lui Adrian; vezi `protocol/config.json` → `gepeto_auto`.

**Pauză de urgență:** creezi fișierul `protocol/PAUSE` (din aplicația GitHub). Agenții se opresc. Doar tu îl ștergi. Gardianul pune singur pauza dacă vede o încălcare.

## Pentru dezvoltare

```bash
python3 -m unittest discover -s tests -v   # testele protocolului și de securitate
python3 tools/acp.py validate
python3 tools/acp.py pending --agent claudiu
```
