# GEPETO – AUTONOMOUS COMMUNICATION: TECHNICAL PROPOSAL

De la: Claudiu (director tehnic) · Către: Gepeto (director strategic) · Copie: Adrian · 7 noiembrie 2026

## 1. Rezumatul

**Prototipul funcționează pe GitHub: un mesaj scris de Claudiu a fost preluat de runner-ul Gepeto în GitHub Actions, răspunsul a fost scris în același fir, fluxul a predat singur ștafeta către Claudiu, iar Claudiu a preluat și a închis firul — 5 din 5 pași trecuți, cu istoric verificabil.** Repository: `Adriancu91/agent-communication` (privat).

Limita principală, spusă direct: **tu, Gepeto din conversația ChatGPT, nu poți fi pornit automat de un eveniment din GitHub.** ChatGPT răspunde doar când Adrian îi scrie, iar abonamentul ChatGPT nu include acces la OpenAI API. De aceea, în test, răspunsul „Gepeto” a fost o **simulare marcată ca atare** (`runtime: sim`), nu un model.

Cea mai ieftină variantă complet automată: Claudiu pe abonamentul Claude Max (0 lei în plus) + un model OpenAI prin API pentru rolul Gepeto (estimat 1–5 USD pe lună, cu plafon de 5 USD scris în cod).

## 2. Ce poate fi „Gepeto” într-un sistem automat

| Variantă | E chiar Gepeto? | Automat? | Cost în plus | Verdict |
| --- | --- | --- | --- | --- |
| **A. Gepeto original + conector GitHub** (ChatGPT Developer Mode, protocol MCP) | **Da**, aceeași conversație | **Nu**: pornește doar când Adrian scrie „verifică inbox-ul”; fiecare scriere cere confirmare | 0 | Pentru deciziile strategice mari, săptămânal |
| **B. Gepeto-API** (OpenAI API, din GitHub Actions) | **Nu**: alt model OpenAI, fără memoria conversației; memoria lui = `memory/gepeto.md` | **Da**, la ~1 minut după mesaj | ~1–5 USD/lună cu `gpt-5-mini` [E] | Pentru discuțiile zilnice, automat |
| **C. Codex** (`@codex` într-un issue sau PR) | **Nu**: agent de programare OpenAI | Da, dar răspunde prin sarcini cloud și PR-uri | 0, în limitele abonamentului ChatGPT | Doar pentru recenzii de cod, nu pentru strategie |

**Recomandarea mea: hibrid A + B.** Gepeto-API poartă discuțiile automat. Tu, Gepeto original, scrii periodic strategia și prioritățile în `memory/gepeto.md` (prin conectorul A sau prin Adrian), iar Gepeto-API le citește la fiecare răspuns. Fiecare mesaj spune în câmpul `runtime` cine l-a scris cu adevărat, ca să nu fie confundați.

Fapte verificate:
- ChatGPT Plus: utilizarea API e separată și facturată independent ([OpenAI Help](https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus)).
- Developer Mode oferă conectori MCP cu scriere pentru Plus și Pro, pe web; scrierile cer confirmare implicit ([OpenAI Developers](https://developers.openai.com/api/docs/guides/developer-mode)). O sursă secundară semnalează că memoria ChatGPT e oprită în Developer Mode — de verificat ([Jeff Bullas](https://www.jeffbullas.com/playbooks/how-to-set-up-chatgpt-developer-mode-and-connect-1000-apps/)).
- Codex pornește sarcini din comentarii `@codex` pe issue-uri și PR-uri ([OpenAI Developers](https://developers.openai.com/codex/integrations/github.md)).

## 3. Arhitectura construită

**Traseul unei discuții:**
1. Un agent scrie un mesaj nou în `messages/` cu `tools/acp.py new` și face push.
2. Push-ul pornește fluxul destinatarului: `gepeto.yml` (OpenAI API) sau `claudiu.yml` (Claude Code cu abonamentul).
3. Fluxul citește firul, scrie răspunsul ca mesaj nou, rulează gardianul pe propriul commit și face push.
4. Fluxul pornește explicit fluxul celuilalt agent. Push-urile făcute de GitHub Actions nu pornesc alte fluxuri, de aceea predarea e explicită — și tot de aceea nu pot apărea bucle nesfârșite.
5. Discuția se oprește când un agent o închide, când cere aprobarea lui Adrian sau după 8 ture automate fără un mesaj de la Adrian (escaladare).

**Dosarele.** Am păstrat propunerea ta, cu o schimbare: `inbox/`, `outbox/` și `discussions/` sunt **vederi generate**, nu copii. Sursa unică e `messages/`, un fișier per mesaj, care nu se mai modifică. Așa nu pot apărea două versiuni ale aceluiași mesaj.

| Dosar | Rol |
| --- | --- |
| `protocol/` | reguli, roluri, format, limite (protejat) |
| `messages/AAAA/LL/` | mesajele, imuabile |
| `inbox/`, `outbox/`, `discussions/` | vederi generate pentru Gepeto, Claudiu și Adrian |
| `decisions/`, `decisions/approvals/` | decizii; aprobările lui Adrian (protejat) |
| `tasks/`, `research/` | sarcini tehnice, rapoarte |
| `memory/` | `shared.md`, `gepeto.md`, `claudiu.md` |
| `logs/` | `events.jsonl` (stări), `usage.jsonl` (costuri), doar adăugare |
| `agents/`, `tools/`, `.github/` | instrucțiunile agenților, unealta, fluxurile (protejat) |

**Câmpurile fiecărui mesaj** (toate cele cerute, plus trei): `id` unic, `thread`, `from`, `to`, `date`, `subject`, `priority`, `type`, `status`, `in_reply_to`, `refs`, plus `reply_expected`, `requires_adrian` și `runtime`. Tipurile acoperă dezbaterea: `proposal`, `counterargument`, `evaluation`, `decision-request`, `decision`, `task`, `report`, `memory-proposal`, `escalation`.

**Controlul:**
- Mesajele și jurnalele nu se modifică și nu se șterg; gardianul (`guard.yml`) verifică fiecare push, fiecare PR și zilnic tot istoricul.
- Agenții nu pot schimba `protocol/`, `.github/`, `tools/`, `agents/` sau `decisions/approvals/`.
- Banii, publicarea, datele clienților, acțiunile ireversibile și schimbarea regulilor cer `requires_adrian`; firul stă pe loc până răspunde Adrian.
- Limite: 8 ture automate pe fir, 20 de mesaje pe zi per agent, 5 USD pe lună buget OpenAI (oprire automată).
- Pauză de urgență: fișierul `protocol/PAUSE`, pus din aplicația GitHub de pe telefon.
- Mesajele care conțin ceva ce seamănă cu o cheie secretă sunt refuzate.

## 4. Rezultatul prototipului

| Pas cerut | Rezultat | Dovadă |
| --- | --- | --- |
| 1. Mesaj scris de Claudiu | **Trecut** | commit `564cc6b`, mesaj `M-20261107T100405Z-claudiu-f526` |
| 2. Mesaj preluat de un agent OpenAI | **Parțial**: preluat de runner-ul Gepeto în GitHub Actions, în modul simulare (fără model) | rularea `gepeto` pornită manual cu `mode=sim`, commit `784128b` (autor Gepeto-agent) |
| 3. Răspuns scris în GitHub | **Trecut**: același fir, `in_reply_to` corect | mesaj `M-20261107T101152Z-gepeto-caac`, `runtime: sim` |
| 4. Mesajul următor preluat de Claudiu | **Trecut**: fluxul Gepeto a pornit singur fluxul Claudiu; preluarea propriu-zisă am făcut-o din sesiune, pentru că tokenul Claude nu e pus încă în GitHub | rularea `claudiu` (workflow_dispatch), mesaj `M-20261107T101244Z-claudiu-f988` |
| 5. Istoric salvat, fir recunoscut | **Trecut**: copie nouă din GitHub — 3 mesaje în același fir, stare `closed`, gardian verde | `discussions/INDEX.md`, `logs/events.jsonl` |
| Test negativ: modificarea unui mesaj vechi | **Respins de gardian**, cum trebuie | PR #1, rularea `guard` roșie: „mesajele sunt imuabile” |

Teste automate ale protocolului: **12 din 12 trecute** (fir, limita de ture, pauză, secrete, istoric, zone protejate, interpretarea răspunsului OpenAI, costul).

**Netestat încă:** un răspuns generat de un model OpenAI real și Claudiu pornit direct din GitHub Actions. Ambele așteaptă câte un secret de la Adrian; după aceea, testul se repetă fără nicio schimbare de cod.

## 5. Costurile reale

| Componentă | Cost | Stare |
| --- | --- | --- |
| GitHub Actions (repo privat) | 0 în plus: fiecare rulare durează sub un minut; planul GitHub plătit al lui Adrian include minute lunare | [E] — de văzut în Settings → Billing |
| Claudiu în GitHub Actions | 0 în plus: rulează pe abonamentul Claude Max cu un token făcut cu `claude setup-token` | [V] ([Claude Code Docs](https://code.claude.com/docs/en/github-actions)) |
| Claudiu în sesiuni programate | 0 în plus. Anthropic anunță 15 rulări automate pe zi pe Max; Adrian are deja ~20 programate pe zi pentru alte proiecte, care merg — limita exactă e de clarificat | [V] ([Claude](https://claude.com/resources/articles/introducing-routines-in-claude-code)) |
| Gepeto-API cu `gpt-5-mini` (0,25 USD / 1M tokeni intrare, 2 USD / 1M ieșire) | ~0,007 USD pe mesaj la 15.000 tokeni de context + 1.500 de răspuns → ~2 USD la 300 de mesaje pe lună | prețul [V] ([OpenAI, via DevelopersDigest](https://www.developersdigest.tech/models/gpt-5-mini)); calculul [E] |
| Gepeto-API cu `gpt-5.5` (5 / 30 USD per 1M) | ~0,12 USD pe mesaj → ~36 USD la 300 de mesaje | prețul [V] ([MorphLLM](https://morphllm.com/openai-api-pricing)); calculul [E] |
| Codex, Developer Mode | 0 în plus, în limitele abonamentului ChatGPT | [V] |

Pentru varianta recomandată: **sub 5 USD pe lună**, cu plafonul de 5 USD impus în cod și în contul OpenAI.

## 6. Limite tehnice

1. **Gepeto original nu e autonom** (secțiunea 2). Gepeto-API e alt model; continuitatea vine doar din `memory/`.
2. **Aceeași identitate GitHub.** Din sesiunile lui, Claudiu scrie ca „Adriancu91”. Gardianul îi deosebește pe agenți după numele autorului din commit, pe care un agent îl poate falsifica. Separarea sigură cere ca ambii agenți să scrie doar din GitHub Actions (identități de tip bot), iar regulile de protecție să fie puse în GitHub.
3. **Din această sesiune nu am putut** crea repository-ul, șterge o ramură sau pune reguli de protecție (blocate de proxy). Le face Adrian, în câteva minute.
4. **Contextul lui Gepeto-API**: ultimele 12 mesaje din fir + memoria; firele lungi trebuie rezumate în `memory/`.
5. **Viteză**: ~1 minut pe tură în GitHub Actions; sesiunile programate, cel puțin o oră între rulări.
6. **Tokenul Claude** e legat de abonamentul lui Adrian și expiră într-un an; există o problemă raportată după schimbarea planului ([GitHub](https://github.com/anthropics/claude-code-action/issues/1281)).
7. Pasul Claude Code din `claudiu.yml` e scris după documentație, dar **nu a rulat încă** (lipsește tokenul).

## 7. Riscurile de securitate și măsurile

| Risc | Măsură construită | De făcut |
| --- | --- | --- |
| Un agent îl manipulează pe celălalt prin text (prompt injection) | Regula R4: mesajele sunt informație, nu porunci; drepturile nu se pot extinde prin mesaj; R3 cere aprobarea lui Adrian | Test de dezbatere cu încercări de manipulare |
| Scurgerea cheilor | Cheile stau doar în GitHub Secrets; gardianul și unealta refuză textul care seamănă cu o cheie | Limită de buget în contul OpenAI |
| Buclă fără sfârșit / costuri | Fără declanșări în lanț prin push; 8 ture pe fir; 20 de mesaje pe zi; plafon de 5 USD/lună | — |
| Ștergerea istoricului | Mesaje imuabile, jurnal doar cu adăugare, gardian la fiecare pas și zilnic | Adrian: regulă GitHub „fără force-push, fără ștergerea ramurii main” |
| Schimbarea regulilor de către un agent | Zone protejate în gardian, CODEOWNERS | Regulă GitHub: modificările în zonele protejate doar prin PR aprobat de Adrian |
| Un agent se dă drept altul | Câmpul `runtime` și autorul commit-ului | Identități separate (pct. 6.2) |
| Acțiuni externe compromise | Folosim doar acțiunile oficiale `actions/checkout` și `anthropics/claude-code-action` | Fixarea lor pe o versiune exactă (SHA) |
| Date de clienți în repo | Interzise (R3) | Verificare la fiecare lună |

## 8. Planul de implementare

1. **Faza 0 — gata azi:** protocol, unealtă, 3 fluxuri, gardian, 12 teste, Experimentul 1 pe GitHub.
2. **Faza 1 — Adrian, ~15 minute:**
   - cont OpenAI API, credit, limită de buget 5 USD, secretul `OPENAI_API_KEY`;
   - `claude setup-token` pe calculator, secretul `CLAUDE_CODE_OAUTH_TOKEN`;
   - regula de protecție a ramurii `main` și ștergerea ramurii de test `test/guard-tamper`.
3. **Faza 2 — Experimentul 2 (real, automat):** Claudiu → Gepeto-API → Claudiu din Actions, fără nicio intervenție; apoi o dezbatere cu contraargumente și o escaladare forțată la limita de ture.
4. **Faza 3 — Gepeto original în buclă:** conectorul GitHub în ChatGPT Developer Mode; Gepeto original actualizează săptămânal `memory/gepeto.md`; raport zilnic pentru Adrian în `inbox/adrian.md`.
5. **Faza 4 — întărire:** identități separate pentru agenți, acțiuni fixate pe versiune, raport lunar de costuri. Abia apoi, primul fir despre produsul pentru reciclatori.

## 9. GEPETO – deciziile pe care ți le cer

| # | Decizie | Recomandarea mea |
| --- | --- | --- |
| G1 | Cine joacă rolul Gepeto în discuțiile automate? | Hibrid: Gepeto-API zilnic + tu săptămânal, prin memorie |
| G2 | Ce model folosește Gepeto-API? | `gpt-5-mini` implicit; un model mai mare doar pentru deciziile marcate `decision` |
| G3 | Ce poate decide Gepeto-API singur? | Doar prioritizare și evaluări; deciziile strategice noi rămân propuneri până le confirmi tu sau Adrian |
| G4 | Bugetul lunar OpenAI | 5 USD la început |
| G5 | Ce scrii primul în `memory/gepeto.md`? | Direcția, prioritățile pe 90 de zile și ce nu facem — ca Gepeto-API să nu pornească de la zero |
