// The export format (AIW-04) and its strict validation. Pure functions, no storage.
//
// An archive is a ZIP with:
//   aiw-export.json            the manifest: format, version, app version, date, and for every project
//                              its file and the SHA-256 fingerprint of that file
//   projects/<project id>.json one file per project: the project, its memory entries, its links and
//                              its history (journal events, with their original fingerprints)
//   CITESTE.txt                a short explanation for people (ignored on import)
//
// On import, everything is checked before anything is written: file fingerprints, every field of every
// record, the fingerprint of every history event, and that the memory matches its history.
// Archives are only ever read as JSON data; nothing in them is executed.
import {
  canonical, charCount, checkDescription, checkEntry, checkName, cleanBody, cleanDescription, cleanName, cleanTitle,
  EVENT_TYPES, eventHash, isCategory, isEntryId, isLinkType, isOfficial, REASON_MAX, sha256, statusFromLinks, SOURCE_MAX,
  type JournalEvent, type MemoryEntry, type MemoryLink, type Project,
} from "../core";

export const EXPORT_FORMAT = "aiw-export";
/** Version of the archive format. A newer app reads every older version; an older app refuses newer ones. */
export const EXPORT_VERSION = 1;
export const MANIFEST_NAME = "aiw-export.json";
export const README_NAME = "CITESTE.txt";

/** Limits per project, far above normal use, so a damaged or hostile file cannot exhaust the device. */
export const MAX_PROJECTS = 1000;
export const MAX_ENTRIES = 20_000;
export const MAX_LINKS = 40_000;
export const MAX_EVENTS = 200_000;

export type ArchiveProblem = "notAiw" | "newerVersion" | "structure" | "fingerprint" | "invalidRecord" | "history" | "inconsistent";

export class ArchiveError extends Error {
  constructor(public problem: ArchiveProblem, public detail = "") {
    super(`archive:${problem}${detail ? ` (${detail})` : ""}`);
    this.name = "ArchiveError";
  }
}

/** A history event as stored in an archive (the device's journal fields, unchanged). */
export type ArchivedEvent = Pick<JournalEvent, "seq" | "ts" | "type" | "projectId" | "entityId" | "dataHash" | "data" | "prev" | "hash">;

export interface ProjectFile {
  format: "aiw-project";
  version: 1;
  project: Project;
  memory: MemoryEntry[];
  links: MemoryLink[];
  /** The project's history, oldest first. Erased events (definitively deleted content) are not exported. */
  events: ArchivedEvent[];
}

export interface ManifestProject {
  id: string;
  name: string;
  file: string;
  sha256: string;
  entries: number;
  links: number;
  events: number;
}

export interface Manifest {
  format: typeof EXPORT_FORMAT;
  version: number;
  app: string;
  exportedAt: string;
  scope: "project" | "all";
  projects: ManifestProject[];
  /** Result of the source device's journal check at export time (information only). */
  sourceJournal: { ok: boolean; events: number };
}

export interface ParsedArchive {
  manifest: Manifest;
  /** Fingerprint of the manifest file: identifies this exact archive in the import record. */
  manifestSha256: string;
  projects: ProjectFile[];
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const PROJECT_ID = /^P-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LINK_ID = /^L-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const isProjectId = (s: unknown): s is string => typeof s === "string" && PROJECT_ID.test(s);
const isIso = (s: unknown): s is string => typeof s === "string" && ISO.test(s) && !Number.isNaN(Date.parse(s));
const isObj = (o: unknown): o is Record<string, unknown> => typeof o === "object" && o !== null && !Array.isArray(o);
const isBool = (b: unknown): b is boolean => typeof b === "boolean";

/** Keys of a record must be exactly the expected ones (an unknown field means a format we do not understand). */
function exactKeys(o: Record<string, unknown>, keys: string[], what: string) {
  const have = Object.keys(o).sort().join(",");
  if (have !== [...keys].sort().join(",")) throw new ArchiveError("invalidRecord", `${what}: fields`);
}

export const projectFileName = (id: string) => `projects/${id}.json`;

// ---------- writing ----------

const enc = new TextEncoder();

export async function fingerprint(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The files of an archive (to be zipped), in a fixed order. */
export async function archiveFiles(projects: ProjectFile[], info: { app: string; exportedAt: string; scope: "project" | "all"; sourceJournal: Manifest["sourceJournal"] }): Promise<{ name: string; data: Uint8Array }[]> {
  const files: { name: string; data: Uint8Array }[] = [];
  const list: ManifestProject[] = [];
  for (const p of projects) {
    const data = enc.encode(JSON.stringify(p, null, 1));
    const file = projectFileName(p.project.id);
    list.push({ id: p.project.id, name: p.project.name, file, sha256: await fingerprint(data), entries: p.memory.length, links: p.links.length, events: p.events.length });
    files.push({ name: file, data });
  }
  const manifest: Manifest = { format: EXPORT_FORMAT, version: EXPORT_VERSION, app: info.app, exportedAt: info.exportedAt, scope: info.scope, projects: list, sourceJournal: info.sourceJournal };
  const readme = [
    "AI Workspace — export de proiecte",
    "",
    "Arhiva se importă din aplicație: Setări → Copii de siguranță → Importă dintr-o arhivă.",
    "Nu modifica fișierele din arhivă: fiecare are o amprentă SHA-256, iar aplicația refuză o arhivă modificată.",
    `Creată: ${info.exportedAt} · Proiecte: ${projects.length}`,
    "",
    "AI Workspace — project export. Import it from the app: Settings → Backups → Import from an archive.",
    "",
  ].join("\n");
  return [
    { name: MANIFEST_NAME, data: enc.encode(JSON.stringify(manifest, null, 1)) },
    { name: README_NAME, data: enc.encode(readme) },
    ...files,
  ];
}

// ---------- reading ----------

function parseJson(bytes: Uint8Array, what: string): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ArchiveError("structure", `${what}: not text`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new ArchiveError("structure", `${what}: not JSON`);
  }
}

/** Files some zip tools add on their own; harmless and ignored. */
const IGNORED = (name: string) => name === README_NAME || name.startsWith("__MACOSX/") || name.endsWith(".DS_Store");

function checkManifest(m: unknown): Manifest {
  if (!isObj(m) || m.format !== EXPORT_FORMAT) throw new ArchiveError("notAiw");
  if (typeof m.version !== "number" || !Number.isInteger(m.version) || m.version < 1) throw new ArchiveError("structure", "version");
  if (m.version > EXPORT_VERSION) throw new ArchiveError("newerVersion", String(m.version));
  exactKeys(m, ["format", "version", "app", "exportedAt", "scope", "projects", "sourceJournal"], "manifest");
  if (typeof m.app !== "string" || m.app.length > 60 || CONTROL.test(m.app)) throw new ArchiveError("structure", "app");
  if (!isIso(m.exportedAt)) throw new ArchiveError("structure", "exportedAt");
  if (m.scope !== "project" && m.scope !== "all") throw new ArchiveError("structure", "scope");
  const sj = m.sourceJournal;
  if (!isObj(sj) || !isBool(sj.ok) || typeof sj.events !== "number") throw new ArchiveError("structure", "sourceJournal");
  if (!Array.isArray(m.projects) || m.projects.length > MAX_PROJECTS) throw new ArchiveError("structure", "projects");
  const ids = new Set<string>();
  for (const p of m.projects as unknown[]) {
    if (!isObj(p)) throw new ArchiveError("structure", "manifest project");
    exactKeys(p, ["id", "name", "file", "sha256", "entries", "links", "events"], "manifest project");
    if (!isProjectId(p.id) || ids.has(p.id)) throw new ArchiveError("structure", "manifest project id");
    ids.add(p.id);
    if (p.file !== projectFileName(p.id)) throw new ArchiveError("structure", "manifest file");
    if (typeof p.sha256 !== "string" || !HEX64.test(p.sha256)) throw new ArchiveError("structure", "manifest sha256");
    if (typeof p.name !== "string") throw new ArchiveError("structure", "manifest name");
    for (const k of ["entries", "links", "events"]) if (typeof p[k] !== "number" || !Number.isInteger(p[k])) throw new ArchiveError("structure", "manifest counts");
  }
  return m as unknown as Manifest;
}

function checkProject(p: unknown): Project {
  if (!isObj(p)) throw new ArchiveError("invalidRecord", "project");
  exactKeys(p, ["id", "name", "description", "createdAt", "updatedAt", "pinned", "deletedAt", "nameHistory", "v"], "project");
  if (!isProjectId(p.id)) throw new ArchiveError("invalidRecord", "project id");
  if (typeof p.name !== "string" || cleanName(p.name) !== p.name || checkName(p.name)) throw new ArchiveError("invalidRecord", "project name");
  if (typeof p.description !== "string" || cleanDescription(p.description) !== p.description || checkDescription(p.description)) {
    throw new ArchiveError("invalidRecord", "project description");
  }
  if (!isIso(p.createdAt) || !isIso(p.updatedAt) || !isBool(p.pinned) || (p.deletedAt !== null && !isIso(p.deletedAt)) || p.v !== 1) {
    throw new ArchiveError("invalidRecord", "project fields");
  }
  if (!Array.isArray(p.nameHistory) || p.nameHistory.length > 10_000) throw new ArchiveError("invalidRecord", "nameHistory");
  for (const h of p.nameHistory as unknown[]) {
    if (!isObj(h) || typeof h.name !== "string" || !isIso(h.until) || Object.keys(h).length !== 2 || charCount(h.name) > 1000) {
      throw new ArchiveError("invalidRecord", "nameHistory");
    }
  }
  return p as unknown as Project;
}

const ENTRY_KEYS = ["id", "projectId", "category", "title", "body", "important", "status", "archived", "author", "source",
  "confirmation", "confirmedAt", "createdAt", "updatedAt", "version", "v"];

function checkEntryRecord(e: unknown, projectId: string): MemoryEntry {
  if (!isObj(e)) throw new ArchiveError("invalidRecord", "entry");
  exactKeys(e, ENTRY_KEYS, "entry");
  if (!isEntryId(e.id) || e.projectId !== projectId || !isCategory(e.category)) throw new ArchiveError("invalidRecord", "entry id");
  if (typeof e.title !== "string" || typeof e.body !== "string" || cleanTitle(e.title) !== e.title || cleanBody(e.body) !== e.body) {
    throw new ArchiveError("invalidRecord", "entry text");
  }
  if (e.source !== null && (typeof e.source !== "string" || charCount(e.source) > SOURCE_MAX)) throw new ArchiveError("invalidRecord", "entry source");
  if (checkEntry({ title: e.title, body: e.body, category: e.category, source: e.source as string | null })) throw new ArchiveError("invalidRecord", "entry text");
  if (!isBool(e.important) || !isBool(e.archived)) throw new ArchiveError("invalidRecord", "entry flags");
  if (e.status !== "active" && e.status !== "replaced" && e.status !== "resolved") throw new ArchiveError("invalidRecord", "entry status");
  if (e.author !== "user" && e.author !== "ai") throw new ArchiveError("invalidRecord", "entry author");
  if (e.confirmation !== "confirmed" && e.confirmation !== "pending" && e.confirmation !== "rejected") throw new ArchiveError("invalidRecord", "entry confirmation");
  if (e.confirmation === "rejected" && !e.archived) throw new ArchiveError("invalidRecord", "rejected entry not archived");
  if (e.confirmedAt !== null && !isIso(e.confirmedAt)) throw new ArchiveError("invalidRecord", "entry confirmedAt");
  if (!isIso(e.createdAt) || !isIso(e.updatedAt)) throw new ArchiveError("invalidRecord", "entry dates");
  if (typeof e.version !== "number" || !Number.isInteger(e.version) || e.version < 1 || e.v !== 1) throw new ArchiveError("invalidRecord", "entry version");
  return e as unknown as MemoryEntry;
}

function checkLinkRecord(l: unknown, projectId: string, entryIds: Set<string>): MemoryLink {
  if (!isObj(l)) throw new ArchiveError("invalidRecord", "link");
  exactKeys(l, ["id", "projectId", "from", "to", "type", "reason", "createdAt", "v"], "link");
  if (typeof l.id !== "string" || !LINK_ID.test(l.id) || l.projectId !== projectId) throw new ArchiveError("invalidRecord", "link id");
  if (typeof l.from !== "string" || typeof l.to !== "string" || !entryIds.has(l.from) || !entryIds.has(l.to) || l.from === l.to) {
    throw new ArchiveError("invalidRecord", "link ends");
  }
  if (!isLinkType(l.type)) throw new ArchiveError("invalidRecord", "link type");
  if (typeof l.reason !== "string" || charCount(l.reason) > REASON_MAX || CONTROL.test(l.reason)) throw new ArchiveError("invalidRecord", "link reason");
  if (!isIso(l.createdAt) || l.v !== 1) throw new ArchiveError("invalidRecord", "link fields");
  return l as unknown as MemoryLink;
}

async function checkEvents(list: unknown, projectId: string): Promise<ArchivedEvent[]> {
  if (!Array.isArray(list) || list.length > MAX_EVENTS) throw new ArchiveError("history", "events");
  let lastSeq = 0;
  for (const e of list as unknown[]) {
    if (!isObj(e)) throw new ArchiveError("history", "event");
    const keys = Object.keys(e).sort().join(",");
    const base = "data,dataHash,hash,prev,projectId,seq,ts,type";
    if (keys !== base && keys !== "data,dataHash,entityId,hash,prev,projectId,seq,ts,type") throw new ArchiveError("history", "event fields");
    if (typeof e.seq !== "number" || !Number.isInteger(e.seq) || e.seq <= lastSeq) throw new ArchiveError("history", "event order");
    lastSeq = e.seq;
    if (!isIso(e.ts) || !(EVENT_TYPES as readonly unknown[]).includes(e.type) || e.projectId !== projectId) throw new ArchiveError("history", `event ${e.seq}`);
    if (e.entityId !== undefined && (typeof e.entityId !== "string" || !(isEntryId(e.entityId) || LINK_ID.test(e.entityId)))) throw new ArchiveError("history", `event ${e.seq} entity`);
    if (!isObj(e.data)) throw new ArchiveError("history", `event ${e.seq} data`);
    if (typeof e.prev !== "string" || !HEX64.test(e.prev) || typeof e.hash !== "string" || !HEX64.test(e.hash) || typeof e.dataHash !== "string" || !HEX64.test(e.dataHash)) {
      throw new ArchiveError("history", `event ${e.seq} fingerprints`);
    }
    // the content and the header must still have the fingerprints recorded on the source device
    if ((await sha256(canonical(e.data))) !== e.dataHash) throw new ArchiveError("history", `event ${e.seq} content changed`);
    if ((await eventHash(e as unknown as ArchivedEvent)) !== e.hash) throw new ArchiveError("history", `event ${e.seq} changed`);
  }
  return list as ArchivedEvent[];
}

/** The memory must match its history (same rule as the device's integrity check) and the statuses must match the links. */
function checkConsistency(pf: ProjectFile) {
  const content = new Map<string, ArchivedEvent[]>();
  for (const ev of pf.events) {
    if (!ev.entityId || (ev.type !== "memory.created" && ev.type !== "memory.edited")) continue;
    content.set(ev.entityId, [...(content.get(ev.entityId) ?? []), ev]);
  }
  const byId = new Map(pf.memory.map((e) => [e.id, e]));
  const official = (id: string) => !!byId.get(id) && isOfficial(byId.get(id)!);
  for (const e of pf.memory) {
    const last = content.get(e.id)?.at(-1)?.data as { title?: unknown; body?: unknown; version?: unknown } | undefined;
    if (!last || last.title !== e.title || last.body !== e.body || last.version !== e.version) throw new ArchiveError("inconsistent", `content ${e.id}`);
    if (e.status !== statusFromLinks(e.id, pf.links, official)) throw new ArchiveError("inconsistent", `status ${e.id}`);
  }
  if (!pf.events.some((ev) => ev.type === "project.created" || ev.type === "project.imported")) throw new ArchiveError("inconsistent", "no project history");
}

/** Validates the files of an archive completely. Throws ArchiveError with the first problem found. */
export async function parseArchive(files: Map<string, Uint8Array>): Promise<ParsedArchive> {
  const mbytes = files.get(MANIFEST_NAME);
  if (!mbytes) throw new ArchiveError("notAiw");
  const manifest = checkManifest(parseJson(mbytes, "manifest"));
  const expected = new Set([MANIFEST_NAME, ...manifest.projects.map((p) => p.file)]);
  for (const name of files.keys()) if (!expected.has(name) && !IGNORED(name)) throw new ArchiveError("structure", `unexpected file ${name.slice(0, 60)}`);

  const projects: ProjectFile[] = [];
  const allEntryIds = new Set<string>();
  const allLinkIds = new Set<string>();
  for (const mp of manifest.projects) {
    const bytes = files.get(mp.file);
    if (!bytes) throw new ArchiveError("structure", `missing ${mp.file}`);
    if ((await fingerprint(bytes)) !== mp.sha256) throw new ArchiveError("fingerprint", mp.file);
    const raw = parseJson(bytes, mp.file);
    if (!isObj(raw) || raw.format !== "aiw-project") throw new ArchiveError("structure", mp.file);
    if (raw.version !== 1) throw new ArchiveError(typeof raw.version === "number" && raw.version > 1 ? "newerVersion" : "structure", mp.file);
    exactKeys(raw, ["format", "version", "project", "memory", "links", "events"], "project file");
    const project = checkProject(raw.project);
    if (project.id !== mp.id) throw new ArchiveError("structure", "project id differs from manifest");
    if (!Array.isArray(raw.memory) || raw.memory.length > MAX_ENTRIES) throw new ArchiveError("invalidRecord", "memory");
    if (!Array.isArray(raw.links) || raw.links.length > MAX_LINKS) throw new ArchiveError("invalidRecord", "links");
    const memory = (raw.memory as unknown[]).map((e) => checkEntryRecord(e, project.id));
    const ids = new Set<string>();
    for (const e of memory) {
      if (ids.has(e.id) || allEntryIds.has(e.id)) throw new ArchiveError("invalidRecord", "duplicate entry");
      ids.add(e.id);
      allEntryIds.add(e.id);
    }
    const links = (raw.links as unknown[]).map((l) => checkLinkRecord(l, project.id, ids));
    for (const l of links) {
      if (allLinkIds.has(l.id)) throw new ArchiveError("invalidRecord", "duplicate link");
      allLinkIds.add(l.id);
    }
    const events = await checkEvents(raw.events, project.id);
    const pf: ProjectFile = { format: "aiw-project", version: 1, project, memory, links, events };
    checkConsistency(pf);
    if (mp.entries !== memory.length || mp.links !== links.length || mp.events !== events.length) throw new ArchiveError("structure", "manifest counts");
    projects.push(pf);
  }
  return { manifest, manifestSha256: await fingerprint(mbytes), projects };
}
