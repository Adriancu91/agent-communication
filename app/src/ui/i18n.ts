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
  privacyText: "Datele tale rămân pe acest dispozitiv, în browser. Internetul e folosit doar ca să încarci aplicația; datele tale nu sunt trimise nicăieri, iar aplicația nu folosește API-uri sau servicii plătite.",
  backupTitle: "Copii de siguranță",
  backupText: "Browserul poate șterge datele site-urilor nefolosite (pe iPhone, după 7 zile fără vizită). Descarcă periodic proiectele; exportul vine într-o etapă următoare.",
  offlineTitle: "Fără internet",
  offlineReady: "Gata: după această încărcare, aplicația merge și fără internet.",
  offlinePending: "Se pregătește funcționarea fără internet…",
  offlineUnavailable: "Funcționarea fără internet nu e disponibilă în acest browser.",
  installTitle: "Pe ecranul principal (opțional)",
  installText: "Poți adăuga aplicația pe ecranul principal, ca să o deschizi ca pe o aplicație. Nu e obligatoriu.",
  installIos: "iPhone: în Safari, apasă Partajare, apoi „Adaugă pe ecranul principal”.",
  installAndroid: "Android: în Chrome, meniul ⋮, apoi „Adaugă pe ecranul de pornire”.",
  installed: "Aplicația e deschisă de pe ecranul principal.",
  version: "Versiunea",
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
  privacyText: "Your data stays on this device, in the browser. The internet is only used to load the app; your data is never sent anywhere, and the app uses no APIs or paid services.",
  backupTitle: "Backups",
  backupText: "Browsers may delete data of unused sites (on iPhone, after 7 days without a visit). Download your projects regularly; export arrives in a later stage.",
  offlineTitle: "Offline",
  offlineReady: "Ready: the app works without internet after this load.",
  offlinePending: "Preparing offline mode…",
  offlineUnavailable: "Offline mode is not available in this browser.",
  installTitle: "On the home screen (optional)",
  installText: "You can add the app to your home screen to open it like an app. It is not required.",
  installIos: "iPhone: in Safari, tap Share, then “Add to Home Screen”.",
  installAndroid: "Android: in Chrome, open the ⋮ menu, then “Add to Home screen”.",
  installed: "The app is open from the home screen.",
  version: "Version",
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

export function useI18n(): { t: (k: Key) => string; lang: Lang } {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => listeners.delete(l);
  }, []);
  return { t: (k) => DICTS[current][k], lang: current };
}
