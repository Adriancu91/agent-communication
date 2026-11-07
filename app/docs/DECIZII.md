# Decizii aprobate (Adrian și Gepeto, 7 noiembrie 2026)

1. **Direcția AI Workspace: APROBATĂ.** Arhitectură statică, local-first, fără server și fără API-uri plătite.
2. **Repo:** `agent-communication`, în directorul separat `app/`. Infrastructura de comunicare existentă rămâne și e protejată.
3. **Numele:** AI Workspace, provizoriu.
4. **Licența:** proprietară pentru moment. Licențele bibliotecilor se verifică separat (`npm run licenses`).
5. **Sincronizarea:** export/import manual ZIP în MVP; sincronizarea automată se analizează ulterior.

## Corecturi cerute de Gepeto
- **Lansatorul:** butoane pentru ChatGPT, Claude, Gemini și GitHub, care deschid site-urile în taburi separate. Nu ocolim restricțiile furnizorilor.
- **iPhone:**
  - backup foarte simplu;
  - avertizare periodică pentru descărcarea proiectelor;
  - adăugarea pe ecranul principal e **opțională**.
- **Internetul:** aplicația are nevoie de internet la prima încărcare (GitHub Pages). După aceea, funcțiile locale merg fără conexiuni externe. Nu există dependențe de API sau de servicii plătite.
- **Interfața:** bine adaptată pentru iPhone, nu o interfață de desktop micșorată.
- **Datele:** nu se trimit niciodată pe GitHub Pages. Exportul și importul sunt fără pierderi. Memoria e structurată și separată pe fiecare proiect.

## Ordinea etapelor (fiecare cu PR separat, testată, documentată și aprobată)
| Etapă | Conținut |
| --- | --- |
| AIW-01 | fundația aplicației și interfața |
| AIW-02 | managerul de proiecte |
| AIW-03 | salvarea locală și memoria |
| AIW-04 | export și import ZIP |
| AIW-05 | continuitatea între AI-uri |
| AIW-06 | lansatorul de site-uri |
| AIW-07 | securitate, teste, pregătirea pentru publicare |

## Ce nu e aprobat
- PR #2 rămâne separat și neîmbinat până la o verificare independentă a securității și a diferențelor.
- Nu se modifică `main`, nu se îmbină PR-uri, nu se șterge infrastructura existentă.
