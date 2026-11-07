// UI texts. Romanian is the source; English must have exactly the same keys (checked by TypeScript and a test).
import { useEffect, useState } from "preact/hooks";

const ro = {
  appName: "AI Workspace",
  tabProjects: "Proiecte",
  tabMemory: "Memorie",
  tabContinuity: "Continuitate",
  tabLauncher: "Lansator",
  tabSettings: "Setări",
  nav: "Navigare principală",

  projectsTitle: "Proiecte",
  projectsEmpty: "Încă nu ai niciun proiect.",
  projectsEmptyHint: "Aici îți vei organiza proiectele: fișiere, conversații salvate, instrucțiuni, decizii și memorie.",
  projectsNew: "Proiect nou",

  memoryTitle: "Memorie",
  memoryEmpty: "Memoria fiecărui proiect, pe secțiuni:",
  memorySections: "Obiective · Reguli · Starea actuală · Decizii · Probleme deschise · Următorii pași",

  continuityTitle: "Continuitate",
  continuityEmpty: "Lucrezi cu un AI, apoi continui cu altul.",
  continuityHint: "Aplicația pregătește un pachet de context pe care îl verifici, îl copiezi și îl lipești în ChatGPT, Claude sau Gemini. Nimic nu se trimite automat.",

  launcherTitle: "Lansator",
  launcherEmpty: "Deschide site-urile AI în taburi separate.",
  launcherHint: "ChatGPT, Claude, Gemini și GitHub se deschid în fila lor, unde ești autentificat direct la furnizor. Site-urile AI nu permit afișarea în interiorul altei aplicații.",

  comingSoon: "În pregătire",

  settingsTitle: "Setări",
  language: "Limba",
  privacyTitle: "Datele tale",
  privacyText: "Datele tale rămân pe acest dispozitiv, în stocarea browserului. Internetul e folosit doar ca să încarci aplicația; datele tale nu sunt trimise nicăieri, iar aplicația nu folosește API-uri sau servicii plătite.",
  backupTitle: "Copii de siguranță",
  backupText: "Browserul poate șterge datele site-urilor nefolosite (pe iPhone, după 7 zile fără vizită). Descarcă periodic proiectele; exportul vine într-o etapă următoare.",
  offlineTitle: "Fără internet",
  offlineReady: "Gata: după această încărcare, aplicația merge și fără internet.",
  offlinePending: "Se pregătește funcționarea fără internet…",
  offlineUnavailable: "Funcționarea fără internet nu e disponibilă în acest browser.",
  installTitle: "Pe ecranul principal (opțional)",
  installText: "Poți adăuga aplicația pe ecranul principal, ca să o deschizi ca pe o aplicație. Nu e obligatoriu. Atenție: pe iPhone, aplicația de pe ecranul principal are alt spațiu de stocare decât Safari, deci proiectele nu trec automat dintr-unul în altul.",
  installIos: "iPhone: în Safari, apasă Partajare, apoi „Adaugă pe ecranul principal”.",
  installAndroid: "Android: în Chrome, meniul ⋮, apoi „Adaugă pe ecranul de pornire”.",
  installed: "Aplicația e deschisă de pe ecranul principal.",
  version: "Versiunea",

  // AIW-02: project manager
  projectsSearch: "Caută în proiecte",
  sortRecent: "Recente",
  sortAlpha: "A–Z",
  sortLabel: "Ordine",
  pinnedLabel: "Fixat sus",
  noResults: "Niciun proiect nu se potrivește căutării.",
  updatedOn: "Modificat",
  createdOn: "Creat",
  moreActions: "Mai multe acțiuni pentru",
  open: "Deschide",
  edit: "Editează",
  pin: "Fixează sus",
  unpin: "Nu mai fixa",
  moveToTrash: "Mută în coș",
  trash: "Coș",
  trashTitle: "Coș",
  trashEmpty: "Coșul e gol.",
  trashHint: "Proiectele din coș pot fi restaurate. Ștergerea definitivă se face doar de aici.",
  trashedOn: "Mutat în coș",
  restore: "Restaurează",
  deleteForever: "Șterge definitiv",
  back: "Proiecte",
  cancel: "Anulează",
  create: "Creează",
  save: "Salvează",
  close: "Închide",
  newProjectTitle: "Proiect nou",
  editProjectTitle: "Editează proiectul",
  nameLabel: "Nume",
  namePlaceholder: "De exemplu: Ofertă client",
  descriptionLabel: "Descriere (opțional)",
  errEmpty: "Numele e obligatoriu.",
  errNameLong: "Numele poate avea cel mult 80 de caractere.",
  errDescLong: "Descrierea poate avea cel mult 500 de caractere.",
  errChars: "Textul conține caractere nepermise.",
  confirmTrashTitle: "Muți proiectul în coș?",
  confirmTrashText: "Îl poți restaura oricând din Coș.",
  confirmPurgeTitle: "Ștergi definitiv proiectul?",
  confirmPurgeText: "Proiectul și istoricul lui dispar de pe acest dispozitiv. Nu se poate anula.",
  confirmPurgeCheck: "Înțeleg că nu se mai poate recupera.",
  movedToTrash: "Mutat în coș.",
  undo: "Anulează",
  restored: "Proiect restaurat.",
  purged: "Proiect șters definitiv.",
  projectMissing: "Proiectul nu există (poate a fost șters definitiv).",
  inTrashBanner: "Acest proiect e în coș.",
  nameHistory: "Nume anterioare",
  until: "până la",
  projectContent: "Conținutul proiectului",
  projectContentHint: "Fișiere · Conversații salvate · Instrucțiuni · Decizii · Memorie",
  loading: "Se încarcă…",

  errQuota: "Spațiu de stocare insuficient. Modificarea NU a fost salvată. Eliberează spațiu pe dispozitiv și încearcă din nou.",
  errUnavailable: "Acest browser nu permite salvarea datelor (de exemplu în navigarea privată). Proiectele nu pot fi păstrate aici.",
  errBlocked: "Aplicația e deschisă într-o versiune mai veche în altă filă. Închide celelalte file și reîncarcă pagina.",
  errClosed: "Legătura cu stocarea s-a închis. Reîncarcă pagina.",
  errConflict: "Proiectul a fost schimbat între timp (poate în altă filă). Încearcă din nou.",
  errUnknown: "Modificarea nu a putut fi salvată. Încearcă din nou.",
  reload: "Reîncarcă",

  iosNoticeTitle: "Pe iPhone: două spații separate",
  iosNoticeText: "Safari și aplicația adăugată pe ecranul principal au spații de stocare separate. Proiectele create într-unul nu apar automat în celălalt. Lucrează într-un singur loc; mutarea proiectelor se va face prin export/import.",
  understood: "Am înțeles",

  storageTitle: "Stocarea pe acest dispozitiv",
  persistOk: "Browserul a acceptat stocarea persistentă: nu șterge singur datele când spațiul e puțin. Datele se pot pierde totuși dacă ștergi datele browserului, dezinstalezi browserul sau pierzi dispozitivul. Păstrează copii.",
  persistNo: "Browserul nu a acceptat stocarea persistentă. Poate șterge datele dacă spațiul e puțin sau, în Safari, după 7 zile fără vizită.",
  persistUnsupported: "Acest browser nu oferă stocare persistentă. Datele pot fi șterse de browser.",
  persistAsk: "Cere stocare persistentă",
  usedSpace: "Spațiu folosit",
} as const;

export type Key = keyof typeof ro;
export type Lang = "ro" | "en";

const en: Record<Key, string> = {
  appName: "AI Workspace",
  tabProjects: "Projects",
  tabMemory: "Memory",
  tabContinuity: "Continuity",
  tabLauncher: "Launcher",
  tabSettings: "Settings",
  nav: "Main navigation",

  projectsTitle: "Projects",
  projectsEmpty: "You have no projects yet.",
  projectsEmptyHint: "This is where you will organise your projects: files, saved conversations, instructions, decisions and memory.",
  projectsNew: "New project",

  memoryTitle: "Memory",
  memoryEmpty: "Each project's memory, by section:",
  memorySections: "Goals · Rules · Current state · Decisions · Open issues · Next steps",

  continuityTitle: "Continuity",
  continuityEmpty: "Work with one AI, then carry on with another.",
  continuityHint: "The app prepares a context pack that you review, copy and paste into ChatGPT, Claude or Gemini. Nothing is sent automatically.",

  launcherTitle: "Launcher",
  launcherEmpty: "Open AI sites in separate tabs.",
  launcherHint: "ChatGPT, Claude, Gemini and GitHub open in their own tab, where you sign in directly with the provider. AI sites do not allow being shown inside another app.",

  comingSoon: "Coming soon",

  settingsTitle: "Settings",
  language: "Language",
  privacyTitle: "Your data",
  privacyText: "Your data stays on this device, in the browser's storage. The internet is only used to load the app; your data is never sent anywhere, and the app uses no APIs or paid services.",
  backupTitle: "Backups",
  backupText: "Browsers may delete data of unused sites (on iPhone, after 7 days without a visit). Download your projects regularly; export arrives in a later stage.",
  offlineTitle: "Offline",
  offlineReady: "Ready: the app works without internet after this load.",
  offlinePending: "Preparing offline mode…",
  offlineUnavailable: "Offline mode is not available in this browser.",
  installTitle: "On the home screen (optional)",
  installText: "You can add the app to your home screen to open it like an app. It is not required. Note: on iPhone, the home screen app has separate storage from Safari, so projects do not move automatically between them.",
  installIos: "iPhone: in Safari, tap Share, then “Add to Home Screen”.",
  installAndroid: "Android: in Chrome, open the ⋮ menu, then “Add to Home screen”.",
  installed: "The app is open from the home screen.",
  version: "Version",

  projectsSearch: "Search projects",
  sortRecent: "Recent",
  sortAlpha: "A–Z",
  sortLabel: "Order",
  pinnedLabel: "Pinned",
  noResults: "No project matches your search.",
  updatedOn: "Modified",
  createdOn: "Created",
  moreActions: "More actions for",
  open: "Open",
  edit: "Edit",
  pin: "Pin to top",
  unpin: "Unpin",
  moveToTrash: "Move to trash",
  trash: "Trash",
  trashTitle: "Trash",
  trashEmpty: "The trash is empty.",
  trashHint: "Projects in the trash can be restored. Permanent deletion is only possible from here.",
  trashedOn: "Moved to trash",
  restore: "Restore",
  deleteForever: "Delete permanently",
  back: "Projects",
  cancel: "Cancel",
  create: "Create",
  save: "Save",
  close: "Close",
  newProjectTitle: "New project",
  editProjectTitle: "Edit project",
  nameLabel: "Name",
  namePlaceholder: "For example: Client offer",
  descriptionLabel: "Description (optional)",
  errEmpty: "A name is required.",
  errNameLong: "The name can have at most 80 characters.",
  errDescLong: "The description can have at most 500 characters.",
  errChars: "The text contains characters that are not allowed.",
  confirmTrashTitle: "Move the project to the trash?",
  confirmTrashText: "You can restore it from the Trash at any time.",
  confirmPurgeTitle: "Delete the project permanently?",
  confirmPurgeText: "The project and its history disappear from this device. This cannot be undone.",
  confirmPurgeCheck: "I understand it cannot be recovered.",
  movedToTrash: "Moved to trash.",
  undo: "Undo",
  restored: "Project restored.",
  purged: "Project permanently deleted.",
  projectMissing: "This project does not exist (it may have been permanently deleted).",
  inTrashBanner: "This project is in the trash.",
  nameHistory: "Previous names",
  until: "until",
  projectContent: "Project content",
  projectContentHint: "Files · Saved conversations · Instructions · Decisions · Memory",
  loading: "Loading…",

  errQuota: "Not enough storage space. The change was NOT saved. Free up space on the device and try again.",
  errUnavailable: "This browser does not allow saving data (for example in private browsing). Projects cannot be kept here.",
  errBlocked: "An older version of the app is open in another tab. Close the other tabs and reload the page.",
  errClosed: "The connection to storage was closed. Reload the page.",
  errConflict: "The project was changed meanwhile (perhaps in another tab). Try again.",
  errUnknown: "The change could not be saved. Try again.",
  reload: "Reload",

  iosNoticeTitle: "On iPhone: two separate spaces",
  iosNoticeText: "Safari and the app added to the home screen have separate storage. Projects created in one do not appear automatically in the other. Work in one place; moving projects will be done through export/import.",
  understood: "Got it",

  storageTitle: "Storage on this device",
  persistOk: "The browser accepted persistent storage: it will not delete the data on its own when space runs low. Data can still be lost if you clear browsing data, uninstall the browser or lose the device. Keep copies.",
  persistNo: "The browser did not accept persistent storage. It may delete the data when space runs low or, in Safari, after 7 days without a visit.",
  persistUnsupported: "This browser does not offer persistent storage. The browser may delete the data.",
  persistAsk: "Request persistent storage",
  usedSpace: "Space used",
};

export const DICTS: Record<Lang, Record<Key, string>> = { ro, en };

const STORE_KEY = "aiw.lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === "ro" || saved === "en") return saved;
  } catch {
    // storage may be unavailable (private mode); fall back to the browser language
  }
  return navigator.language?.toLowerCase().startsWith("ro") ? "ro" : "en";
}

let current: Lang = typeof navigator === "undefined" ? "ro" : initialLang();
const listeners = new Set<() => void>();

export function currentLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(STORE_KEY, lang);
  } catch {
    // not fatal: the choice simply is not remembered
  }
  document.documentElement.lang = lang;
  listeners.forEach((l) => l());
}

/** Replaces {name} placeholders. */
export function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? "");
}

export function useI18n(): { t: (k: Key) => string; lang: Lang } {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return { t: (k) => DICTS[current][k], lang: current };
}
