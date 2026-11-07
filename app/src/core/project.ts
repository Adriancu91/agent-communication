// The project record and the rules every project must follow. No storage, no UI: pure functions.

export const NAME_MAX = 80;
export const DESCRIPTION_MAX = 500;

export interface NameChange {
  name: string; // the name the project had
  until: string; // ISO date when it was replaced
}

export interface Project {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  deletedAt: string | null; // set = in the trash
  nameHistory: NameChange[];
  /** Format version of this record, for future migrations. */
  v: 1;
}

export type FieldError = "empty" | "tooLong" | "invalidChars";

/** Characters never stored: control characters (except tab / line break) and invisible text-direction overrides. */
export const UNSAFE_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/;
const UNSAFE_ALL = new RegExp(UNSAFE_CHARS.source, "g");
/** Removes them (used for text pasted from elsewhere, such as an AI reply). */
export function stripUnsafe(s: string): string {
  return s.replace(UNSAFE_ALL, "");
}
const CONTROL = UNSAFE_CHARS;

/** Length in characters as a person counts them (an emoji counts as one). */
export function charCount(s: string): number {
  return [...s].length;
}

export function cleanName(raw: string): string {
  return raw.normalize("NFC").replace(/\s+/g, " ").trim();
}

export function cleanDescription(raw: string): string {
  return raw.normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

export function checkName(name: string): FieldError | null {
  if (!name) return "empty";
  if (charCount(name) > NAME_MAX) return "tooLong";
  if (CONTROL.test(name) || /\n/.test(name)) return "invalidChars";
  return null;
}

export function checkDescription(text: string): FieldError | null {
  if (charCount(text) > DESCRIPTION_MAX) return "tooLong";
  if (CONTROL.test(text)) return "invalidChars";
  return null;
}

export function newProjectId(): string {
  return "P-" + crypto.randomUUID();
}

/** Lower case, without diacritics: "Mămăligă" and "mamaliga" match. */
export function searchKey(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("ro");
}

export function matches(p: Project, query: string): boolean {
  const q = searchKey(query.trim());
  if (!q) return true;
  return searchKey(p.name).includes(q) || searchKey(p.description).includes(q);
}

export type SortOrder = "recent" | "alpha";

/** Pinned first, then by the chosen order. Alphabetical order follows Romanian rules (ă after a, ș after s). */
export function sortProjects(list: Project[], order: SortOrder, lang = "ro"): Project[] {
  const coll = new Intl.Collator(lang, { sensitivity: "base", numeric: true });
  return [...list].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (order === "alpha") return coll.compare(a.name, b.name) || b.updatedAt.localeCompare(a.updatedAt);
    return b.updatedAt.localeCompare(a.updatedAt) || coll.compare(a.name, b.name);
  });
}
