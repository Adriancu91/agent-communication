# AIW-05.1 — Fluxul aproape automat (trimite / primește cu o atingere)

**Stare:** implementat la cererea lui Adrian (8 noiembrie 2026), după testul AIW-05: „vreau ceva mai automatizat, nu să copiez și să notez răspunsurile”. PR separat, pornit din AIW-05. **Neîmbinat, nepublicat.**

## 1. Ce se poate și ce nu (cercetare)
**Ce nu se poate:** o automatizare completă, fără server, fără API plătit, pe orice plan și cu respectarea condițiilor furnizorilor.
- Condițiile OpenAI interzic extragerea automată sau programatică a răspunsurilor. Nicio extensie nu are voie să citească singură pagina ChatGPT.
- Conectorii MCP (AI-ul citește și scrie singur în aplicație) există pentru Claude, inclusiv pe planul gratuit, cu un singur conector. Cer însă un server accesibil de pe internet. Pe ChatGPT ei lipsesc pe planul gratuit, iar pe Plus sunt doar pentru citire și instabili.
- Pe iPhone, o aplicație web nu poate primi texte prin meniul de partajare (Safari nu suportă Web Share Target). Pe Android, Chrome îl suportă.

**Ce se poate:** fluxul de mai jos. Gratuit, pe orice plan și orice AI, fără server; omul folosește aplicația AI normal.

## 2. Fluxul
1. **Trimite (o atingere):** în Lansator, butonul „Trimite la Claude / ChatGPT / Gemini”.
   - **Telefon:** se deschide meniul de partajare al sistemului. Alegi aplicația AI, iar pachetul ajunge direct în conversație. Dacă închizi meniul, nu pornește nicio sesiune.
   - **Calculator:** un clic copiază pachetul și deschide site-ul AI într-o filă nouă, cu adresa simplă, fără nimic în ea. Acolo doar lipești (Ctrl+V).
2. **Adu răspunsul (o atingere):**
   - **Oriunde:** în aplicația AI apeși „Copiază” sub răspuns, revii și apeși „Am copiat răspunsul — adaugă-l” (Lansator) sau „Adaugă răspunsul AI” (sesiune). Aplicația citește singură clipboardul. Pe iPhone, sistemul afișează bula „Lipire”, pe care o atingi.
   - **Android (aplicația instalată):** în aplicația AI, „Partajează” → AI Workspace. Se deschide ecranul „Răspuns primit”: alegi sesiunea (o atingere), iar revizuirea pornește. Textul primit e șters imediat din adresa paginii, ca să nu rămână în istoricul browserului.
   - Pagina sesiunii arată „Aștept răspunsul de la …” cât timp nu ai adus răspunsul.
3. **Confirmă (o atingere):** analiza pornește singură. Butonul „Acceptă tot ce e nou și salvează”:
   - acceptă propunerile noi;
   - respinge duplicatele;
   - lasă „de decis” propunerile asemănătoare cu ce ai deja;
   - salvează.

   Regula de bază rămâne: memoria oficială se schimbă doar prin decizia ta (aici, atingerea pe buton).

**În total:** 3–4 atingeri pe ciclu, fără selectat text, fără lipit în căsuțe și fără notat.

## 3. Tehnic
- **`src/ui/handoff.ts`** se ocupă de:
  - meniul de partajare (`navigator.share`, doar pe ecrane tactile);
  - copierea și deschiderea site-ului (pe calculator);
  - citirea clipboardului;
  - textul primit prin partajare (`captureSharedText`, la pornire);
  - răspunsul care așteaptă între ecrane.
- **`public/manifest.webmanifest`:** `share_target` (GET, parametrii `aiw_title`, `aiw_text`, `aiw_url`). Funcționează și fără internet: service worker-ul servește aplicația și când adresa are parametri.
- **Partajarea pornește chiar în atingerea utilizatorului**, cum cer browserele. Amprenta pachetului e calculată dinainte, iar sesiunea e înregistrată după ce partajarea reușește.
- **Corectură găsită de teste:** analiza automată pornea înainte ca memoria proiectului să se încarce, deci fără comparare și fără referințe. Acum revizuirea așteaptă memoria și pașii sesiunii și se reface singură dacă aceștia se încarcă după, cât timp n-ai modificat nimic.
- Fără API, fără chei și fără conexiuni noi. CSP-ul e neschimbat.

## 4. Teste
- **Unitare** (`tests/unit/handoff.test.ts`, 4 teste):
  - textul partajat e păstrat și scos din adresă;
  - un start normal nu e afectat;
  - titlul, textul și linkul sunt unite fără repetări;
  - răspunsul care așteaptă nu ajunge la altă sesiune.
- **În browser** (`tests/e2e/continuity.spec.ts`, pe iPhone 15, iPhone SE, Android și PC), cu meniul de partajare și clipboardul simulate (sunt dialoguri ale sistemului):
  - **telefon:** pachetul ajunge în meniul de partajare;
  - **PC:** pachetul e copiat și se deschide exact site-ul AI;
  - răspunsul e adus cu o atingere și analizat imediat, cu comparare și relații;
  - „Acceptă tot ce e nou și salvează”;
  - răspunsul fără nimic copiat e lipit de mână;
  - răspunsul partajat (Android) ajunge la revizuire, iar adresa e curățată;
  - tot fluxul merge fără internet.

## 5. Limitări
- **iPhone:** răspunsul nu poate fi partajat direct către aplicația web, așa că rămâne „Copiază” → „Adaugă răspunsul” (o atingere plus bula „Lipire”).
- **Ce aplicații AI apar în meniul de partajare** depinde de telefon și de aplicațiile instalate. Pe calculator, lipirea în site-ul AI rămâne un Ctrl+V.
- **Automatizarea completă** cere conectorul MCP (cu server) sau un API plătit. E documentată ca opțiune viitoare.
