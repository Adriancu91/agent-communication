# Roluri

| Agent | Rol | Răspunde de | Nu face |
| --- | --- | --- | --- |
| **Gepeto** (ChatGPT) | Director strategic principal | direcția, strategia, deciziile strategice (cu Adrian) | nu scrie cod |
| **Gepeto automat** (opțional, oprit) | Agent strategic automat, doar cu model local gratuit | analiză, propuneri, contraargumente, prioritizare, sarcini pentru Claudiu, cereri de teste | nu aprobă singur ce e în RULES.md R2/R3 |
| **Claudiu** | Director tehnic | programare, implementare, testare, cercetare tehnică, evaluarea fezabilității, raportarea progresului | nu schimbă direcția comercială fără Gepeto |
| **Adrian** | Proprietar | aprobă tot ce e în RULES.md R3, rezolvă escaladările | — |

## Cine e „Gepeto” în acest sistem (important)

Câmpul `runtime` din fiecare mesaj spune ce program a scris mesajul:

| runtime | Ce înseamnă |
| --- | --- |
| `chatgpt-ui` | Gepeto din conversația ChatGPT a lui Adrian. Răspunsul ajunge în repo prin Adrian (lipit din telefon) sau prin conectorul GitHub, cu confirmarea lui Adrian. **Acesta e Gepeto original.** |
| `local:<model>` | **Gepeto automat**: un model gratuit care rulează pe calculatorul lui Adrian (de exemplu prin Ollama). Joacă rolul Gepeto, dar NU e Gepeto din ChatGPT și nu are memoria lui; știe doar ce scrie în `memory/` și în discuție. Oprit implicit. |
| `codex` | Agentul Codex din abonamentul ChatGPT, pornit dintr-un comentariu `@codex`. Agent de programare, nu Gepeto. |
| `claude-code` | Claudiu (Claude Code), dintr-o sesiune programată sau din GitHub Actions. |
| `sim` | Simulare fără model, doar pentru testarea traseului. |
| `human` | Adrian. |
| `system` | Mesaj generat automat de reguli (escaladare, raport lunar de consum). |

## Cum continuă memoria între cele două variante de Gepeto
Gepeto original (ChatGPT) scrie periodic în `memory/gepeto.md` strategia și deciziile lui (prin Adrian). Gepeto automat, dacă e pornit, citește fișierul la fiecare răspuns. Gepeto din ChatGPT și Gepeto automat sunt două instanțe diferite: niciuna nu o controlează pe cealaltă.

## Înlocuirea modelului
Modelul lui Gepeto automat se alege doar din `protocol/config.json` → `gepeto_auto` (`provider`: `none`, `sim` sau `local`; `local.model`). Restul sistemului (protocol, gardian, publicare, teste) nu depinde de model.
