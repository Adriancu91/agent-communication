# AI_WORKSPACE_ARCHITECTURE — arhitectura propusă

## 1. Principii
1. **Aplicație statică, fără server.** Rulează pe GitHub Pages: un link, fără instalare. Se poate „adăuga pe ecranul principal” (PWA), lucru recomandat pe iPhone.
2. **Datele stau la utilizator.** Datele sunt în browserul lui (IndexedDB), iar exportul e o arhivă `.zip` pe care o poate citi și fără aplicație.
3. **Zero rețea în prima versiune.** Politica de securitate a paginii (CSP) permite conexiuni doar spre propriul site. Aplicația **nu poate** apela niciun API, deci nu poate exista nicio facturare și nicio scurgere de date. Linkurile spre ChatGPT, Claude sau Gemini se deschid de utilizator, în fila lor.
4. **AI-ul propune, omul confirmă.** Tot ce vine de la un AI (răspunsuri lipite, propuneri de memorie) trece printr-o previzualizare și o confirmare. Aceasta e regula publicatorului și a memoriei din repo.
5. **Istoricul nu se rescrie.** O modificare e o intrare nouă care o înlocuiește pe cea veche. Jurnalul are amprente înlănțuite.
6. **Module cu granițe clare**, care evoluează separat.

## 2. Modulele
```
                ┌────────────────────── ui ──────────────────────┐
                │ ecrane: Proiecte · Proiect · Memorie · Lansator │
                └──┬─────────┬──────────┬───────────┬────────┬────┘
        project-engine  memory-engine  continuity  launcher  archive (import-export)
                └─────────┴──────────┴─────┬─────┴────────┘
                                    core (format + jurnal + validare)
                                           │
                                 storage (interfață) ── IndexedDB
                                           │           (mai târziu: sync)
                                     security (transversal)
```

| Modul (nume conceptual) | Director propus | Responsabilitate | Depinde de |
| --- | --- | --- | --- |
| agent-communication → **core** | `app/src/core/` | formatul intrărilor (antet + markdown), parser, validare, jurnal cu amprente. Portat din `tools/acp.py` | nimic |
| local-storage → **storage** | `app/src/storage/` | o interfață (`get/put/list/append`) și o implementare IndexedDB; cere `navigator.storage.persist()` | core |
| project-engine → **projects** | `app/src/projects/` | proiecte: creare, listă, instrucțiuni, fișiere atașate, conversații salvate, decizii, sarcini | core, storage |
| memory-engine → **memory** | `app/src/memory/` | memoria pe secțiuni (obiective, reguli, stare, decizii, probleme, pași); propuneri cu confirmare | core, storage |
| continuity-engine → **continuity** | `app/src/continuity/` | pachetul de context pentru Claude, ChatGPT sau Gemini, cu limită de mărime; importul răspunsului | core, memory, projects |
| browser-workspace → **launcher** | `app/src/launcher/` | taburi cu site-uri; deschide în filă nouă; copiază contextul; încorporează doar site-urile care permit | nimic (primește text) |
| import-export → **archive** | `app/src/archive/` | export `.zip`, import cu verificare, backup complet, restaurare | core, storage |
| security | `app/src/security/` | CSP, căutare de chei secrete, curățarea textului importat, verificarea arhivelor | core |
| ui | `app/src/ui/` | ecranele, întâi pentru telefon | toate |

**Regula granițelor:**
- `core` nu importă nimic din aplicație.
- Modulele nu se importă între ele decât prin săgețile de mai sus.
- `launcher` nu atinge datele.

Un test verifică importurile, așa cum `teste/test_arhitectura.py` o face în Kronos.

## 3. Structura repo-ului
**Nu mutăm** nimic din ce există: gardianul și workflow-urile depind de căi (`tools/`, `protocol/`, `messages/`…). Adăugăm alături:
```
app/                      aplicația AI Workspace (TypeScript)
  src/core|storage|projects|memory|continuity|launcher|archive|security|ui
  tests/                  teste unitare + cap-coadă (în browser fără ecran)
  README.md
fixtures/                 exemple de intrări valide/invalide, folosite de testele Python ȘI de cele TypeScript
.github/workflows/app.yml testele aplicației la PR (doar citire)
(existente) tools/ protocol/ agents/ messages/ logs/ memory/ … = back-office-ul Gepeto–Claudiu
```
`app/` și `fixtures/` intră în zonele protejate ale gardianului: se schimbă doar prin PR îmbinat de Adrian.

## 4. Datele
**Intrare** (aceeași idee ca mesajul ACP):
```
---
id: E-20261107T120000Z-4f2a
project: P-ai-workspace
kind: note | conversation | decision | task | context-pack | ai-reply | file
title: …
source: user | claude.ai | chatgpt | gemini | import
date: 2026-11-07T12:00:00Z
supersedes: (opțional)
status: open | done | proposed | approved | rejected
---
textul în markdown
```
**Memoria proiectului:** un fișier per secțiune (`goals.md`, `rules.md`, `state.md`, `decisions.md`, `open-issues.md`, `next-steps.md`). Fiecare schimbare e un eveniment.

**Jurnalul:** `events.jsonl`. Fiecare linie are `prev` (amprenta liniei anterioare) și `hash`.

**Arhiva de export** `nume-proiect.aiw.zip` (se deschide cu orice program de arhive):
```
MANIFEST.json      versiunea formatului, data, amprenta fiecărui fișier
project.json       nume, instrucțiuni, setări
entries/*.md       intrările
memory/*.md        memoria pe secțiuni
files/…            fișierele atașate
events.jsonl       jurnalul
README.txt         cum se citește arhiva fără aplicație
```
Formatul e documentat și versionat. Importul refuză orice arhivă cu amprente greșite, căi cu `..` sau mărimi absurde, așa cum face publicatorul cu pachetele.

## 5. Browser Workspace, realist
- Taburi definite de utilizator (nume + adresă). Cele implicite: ChatGPT, Claude, Gemini, GitHub.
- Butonul **Deschide** deschide site-ul în filă sau fereastră nouă, unde utilizatorul e deja autentificat la furnizor.
- Butonul **Trimite context**:
  1. copiază pachetul de context în clipboard;
  2. deschide site-ul;
  3. pentru ChatGPT poate folosi și linkul `?q=` dacă textul e scurt;
  4. utilizatorul lipește și trimite.
- **Încorporare** doar pentru site-urile care o permit, cu mesaj clar „acest site nu permite afișarea aici”. Site-urile AI măsurate refuză, deci pentru ele nu se încearcă.
- **Nu facem:** proxy care șterge antetele, extensii care citesc conversațiile, automatizarea conturilor, citirea istoricului privat al furnizorului.

## 6. Tehnologie (toate gratuite și open-source; licențele se reverifică la instalare)
| Ce | Alegere | Licență | De ce |
| --- | --- | --- | --- |
| Limbaj | TypeScript | Apache-2.0 | aceeași limbă ca suita office a lui Adrian |
| Construire | Vite | MIT | rapid, ieșire statică pentru Pages |
| Interfață | Preact | MIT | ~4 KB, API ca React, ușor pe telefoane slabe |
| IndexedDB | idb | ISC | strat subțire peste IndexedDB |
| Arhive .zip | fflate | MIT | mic, rapid, fără dependențe |
| PWA | vite-plugin-pwa | MIT | instalare pe ecranul principal, funcționare fără internet |
| Teste | Vitest + Playwright | MIT / Apache-2.0 | unitare + în browser fără ecran |

Nu folosim niciun serviciu cu cont sau plată.

## 7. Securitate
- **CSP strictă:** `default-src 'self'; connect-src 'self'; frame-src` doar pentru site-urile din lista de încorporare; fără `unsafe-eval`.
- Textul importat se afișează ca text sau markdown **fără HTML** (fără scripturi).
- Căutare de chei secrete înainte de export și înainte de copierea contextului.
- Nicio dependență cu acces la rețea; un test verifică că pachetul construit nu conține adrese de API.
- Construirea și publicarea: workflow pornit **manual**, după aprobarea lui Adrian, cu acțiuni fixate pe SHA. Drepturile `pages: write` și `id-token: write` (cerute de GitHub Pages) apar **doar** în jobul de publicare.

## 8. Sincronizare între dispozitive (după prima versiune)
Interfața `storage` permite adăugarea ulterioară a unui adaptor. Variante gratuite, de ales mai târziu, cu aprobare:
1. **Manual:** export pe un dispozitiv, import pe altul, prin orice canal ales de utilizator (OneDrive, e-mail, cablu). Merge din prima versiune.
2. **Un repo GitHub privat al utilizatorului** ca stocare (formatul e deja potrivit pentru git), cu un token cu drepturi minime introdus de utilizator.
3. **Un dosar în cloud-ul utilizatorului**, unde browserul permite.

Fiecare variantă are riscuri proprii (tokenuri în browser, conflicte), analizate în RISK_REGISTER.
