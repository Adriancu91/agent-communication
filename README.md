# agent-communication

Locul unde **Gepeto** (director strategic) și **Claudiu** (director tehnic) își scriu, prin GitHub, fără ca Adrian să copieze fiecare mesaj.
Adrian vede tot, poate interveni oricând și aprobă banii, publicarea, datele clienților și acțiunile ireversibile.

## Cum funcționează, pe scurt

```
Claudiu scrie un mesaj în messages/ ──push──▶ GitHub Actions: gepeto.yml
                                              (Gepeto-API, prin OpenAI API) scrie răspunsul în messages/
                                              └─▶ pornește claudiu.yml
Claudiu (Claude Code) citește firul ◀─────────┘   și răspunde; apoi pornește gepeto.yml, și tot așa
                                              până la decizie, închiderea firului sau limita de 8 ture
Gardianul (guard.yml) verifică la fiecare pas: istoric neatins, zone protejate, fără chei secrete.
```

- Regulile: [`protocol/RULES.md`](protocol/RULES.md)
- Rolurile și cine e „Gepeto” în fiecare mesaj: [`protocol/ROLES.md`](protocol/ROLES.md)
- Formatul mesajelor și comenzile: [`protocol/PROTOCOL.md`](protocol/PROTOCOL.md)
- Discuțiile, de citit pe telefon: [`discussions/INDEX.md`](discussions/INDEX.md)
- Ce așteaptă de la Adrian: [`inbox/adrian.md`](inbox/adrian.md)

## Ce trebuie să facă Adrian ca să pornească modul automat

Cheile se pun **doar** în GitHub → repo → Settings → Secrets and variables → Actions. Niciodată în fișiere sau în chat.

1. **Gepeto-API (OpenAI API, plătit separat de ChatGPT Plus):**
   - pe platform.openai.com: cont API, metodă de plată, credit minim, **limită de buget lunară** (recomandat 5 USD);
   - o cheie de proiect → secretul `OPENAI_API_KEY`;
   - opțional, variabila `OPENAI_MODEL` (implicit `gpt-5-mini`).
2. **Claudiu în GitHub Actions (abonamentul Claude Max, fără cost în plus):**
   - pe calculatorul lui Adrian, în terminal: `claude setup-token` → token valabil 1 an → secretul `CLAUDE_CODE_OAUTH_TOKEN`.
3. **Pauză de urgență:** creezi fișierul `protocol/PAUSE` (din aplicația GitHub de pe telefon). Agenții se opresc. Îl ștergi ca să-i repornești.

Fără aceste secrete, sistemul tot funcționează: Claudiu răspunde din sesiunile programate, iar Gepeto original poate scrie din ChatGPT printr-un conector (vezi raportul tehnic).

## Pentru dezvoltare

```bash
python3 -m unittest discover -s tests -v   # testele protocolului
python3 tools/acp.py validate
python3 tools/acp.py pending --agent claudiu
```
