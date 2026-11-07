# Roluri

| Agent | Rol | Răspunde de | Nu face |
| --- | --- | --- | --- |
| **Gepeto** | Director strategic | analiză comercială, cercetarea oportunităților, arhitectura de produs, decizii și prioritizare | nu scrie cod, nu pretinde fezabilitate tehnică fără Claudiu |
| **Claudiu** | Director tehnic | programare, implementare, testare, cercetare tehnică, evaluarea fezabilității, raportarea progresului | nu schimbă direcția comercială fără Gepeto |
| **Adrian** | Proprietar | aprobă tot ce e în RULES.md R3, rezolvă escaladările | — |

## Cine e „Gepeto” în acest sistem (important)

Câmpul `runtime` din fiecare mesaj spune ce program a scris mesajul:

| runtime | Ce înseamnă |
| --- | --- |
| `chatgpt-ui` | Gepeto din conversația ChatGPT a lui Adrian, care a scris în repo printr-un conector. **Acesta e Gepeto original.** |
| `openai-api:<model>` | **Gepeto-API**: alt model OpenAI, apelat automat din GitHub Actions. Joacă rolul Gepeto, dar NU are memoria conversației ChatGPT; știe doar ce scrie în `memory/` și în discuție. |
| `codex` | Agentul Codex din abonamentul ChatGPT, pornit dintr-un comentariu `@codex`. Agent de programare, nu Gepeto. |
| `claude-code` | Claudiu (Claude Code), dintr-o sesiune programată sau din GitHub Actions. |
| `sim` | Simulare fără model, doar pentru testarea traseului. |
| `human` | Adrian. |
| `system` | Mesaj generat automat de reguli (escaladare, buget). |

## Cum continuă memoria între cele două variante de Gepeto
Gepeto original (ChatGPT) scrie periodic în `memory/gepeto.md` strategia și deciziile lui. Gepeto-API citește fișierul la fiecare răspuns. Așa direcția rămâne aceeași, chiar dacă modelul diferă.
