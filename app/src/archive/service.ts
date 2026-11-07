// Export and import of projects (AIW-04), through the shared journal.
// Export: one read snapshot → archive files → ZIP. Import: read + full validation (nothing written),
// a preview for the user, then ONE write transaction for everything the user chose: either all of it
// is saved or nothing is, and the existing data stays as it was.
import {
  cleanName, currentEvents, NAME_MAX, newEntryId, newLinkId, newProjectId, charCount,
  type JournalEvent, type MemoryEntry, type MemoryLink, type Project, type Category,
} from "../core";
import { deleteAll, JournaledStore, req, StorageError, type PendingEvent } from "../storage";
import { archiveFiles, ArchiveError, parseArchive, type ArchivedEvent, type ParsedArchive, type ProjectFile } from "./archive";
import { createZip, readZip, ZipError } from "./zip";

/** Largest archive file accepted (compressed). */
export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;

export type ImportChoice = "add" | "skip" | "replace" | "copy";

/** How an archived project relates to the projects on this device. */
export type Match =
  | "new" // nothing similar here
  | "same" // the same project (same id) exists here with exactly the same content
  | "sameId" // the same project exists here, with different content (changed on one of the devices)
  | "sameName"; // a different project with the same name exists here

export interface PreviewProject {
  id: string;
  name: string;
  description: string;
  trashed: boolean;
  match: Match;
  /** The local project it matches (sameId / same / sameName). */
  local?: { id: string; name: string; updatedAt: string; trashed: boolean };
  /** Choices the user can make, the first one is the default. */
  choices: ImportChoice[];
  counts: { entries: number; byCategory: Partial<Record<Category, number>>; pending: number; archived: number; links: number; events: number; versions: number };
  updatedAt: string;
  /** Fingerprint of the local copy's content at preview time: the import refuses if it changed meanwhile. */
  localKey?: string;
  /** The name it will get if imported as a new project and its name is already used here (or earlier in the archive). */
  renameTo?: string;
}

export interface ImportPreview {
  archive: ParsedArchive;
  app: string;
  exportedAt: string;
  sourceJournalOk: boolean;
  projects: PreviewProject[];
}

export interface ImportResult {
  imported: { id: string; name: string; mode: Exclude<ImportChoice, "skip"> }[];
  skipped: number;
}

export class ImportError extends Error {
  constructor(public reason: "changed" | "idConflict" | "nothing", detail = "") {
    super(`import:${reason}${detail ? ` (${detail})` : ""}`);
    this.name = "ImportError";
  }
}

const STORES = ["projects", "memory", "links", "events"];

const byProject = <T>(tx: IDBTransaction, store: string, id: string) =>
  req(tx.objectStore(store).index("projectId").getAll(IDBKeyRange.only(id)) as IDBRequest<T[]>);

/** What makes two copies of a project "the same": its record and its whole memory and links. */
function contentKey(p: Project, memory: MemoryEntry[], links: MemoryLink[]): string {
  const sort = <T extends { id: string }>(a: T[]) => [...a].sort((x, y) => x.id.localeCompare(y.id));
  return JSON.stringify([p, sort(memory), sort(links)]);
}

/** A name not used by another (non-trashed or trashed) project: "Name (2)", "Name (3)", … within the length limit. */
export function freeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`;
    const room = NAME_MAX - charCount(suffix);
    const base = charCount(name) > room ? cleanName([...name].slice(0, room).join("")) : name;
    const candidate = base + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

function slug(name: string): string {
  const s = name.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "proiect";
}

export class TransferService {
  constructor(readonly base: JournaledStore, private appVersion = "0") {}

  // ---------- export ----------

  /**
   * Builds an archive of the given projects (or all of them, trash included), from ONE read snapshot.
   * Includes each project's memory (all states: pending, archived, rejected), links and history.
   */
  async exportArchive(ids: string[] | "all", now = new Date()): Promise<{ bytes: Uint8Array; fileName: string; count: number }> {
    const report = await this.base.verify();
    const files: ProjectFile[] = await this.base.read(STORES, async (tx) => {
      const all = await req(tx.objectStore("projects").getAll() as IDBRequest<Project[]>);
      const chosen = ids === "all" ? all : ids.map((id) => all.find((p) => p.id === id)).filter((p): p is Project => !!p);
      if (ids !== "all" && chosen.length !== ids.length) throw new StorageError("conflict", "missing project");
      const out: ProjectFile[] = [];
      for (const project of chosen.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
        const [memory, links, events] = await Promise.all([
          byProject<MemoryEntry>(tx, "memory", project.id),
          byProject<MemoryLink>(tx, "links", project.id),
          byProject<JournalEvent>(tx, "events", project.id),
        ]);
        const history: ArchivedEvent[] = currentEvents(events, project.id)
          .sort((a, b) => a.seq - b.seq)
          .filter((e) => e.data !== null) // definitively deleted content stays deleted
          .map((e) => ({ seq: e.seq, ts: e.ts, type: e.type, projectId: e.projectId, ...(e.entityId !== undefined ? { entityId: e.entityId } : {}), dataHash: e.dataHash, data: e.data, prev: e.prev, hash: e.hash }));
        const sort = <T extends { id: string }>(a: T[]) => [...a].sort((x, y) => x.id.localeCompare(y.id));
        out.push({ format: "aiw-project", version: 1, project, memory: sort(memory), links: sort(links), events: history });
      }
      return out;
    });
    if (files.length === 0) throw new ImportError("nothing");
    const exportedAt = now.toISOString();
    const zipFiles = await archiveFiles(files, {
      app: this.appVersion, exportedAt, scope: ids === "all" ? "all" : "project",
      sourceJournal: { ok: report.ok, events: report.events },
    });
    const bytes = await createZip(zipFiles, now);
    const day = exportedAt.slice(0, 10);
    const fileName = ids === "all" ? `ai-workspace-toate-${day}.zip` : `ai-workspace-${slug(files[0].project.name)}-${day}.zip`;
    return { bytes, fileName, count: files.length };
  }

  // ---------- import: read and preview (nothing is written) ----------

  /** Opens and fully checks an archive, and compares it with this device. Throws ZipError / ArchiveError. */
  async preview(bytes: Uint8Array): Promise<ImportPreview> {
    if (bytes.length > MAX_ARCHIVE_BYTES) throw new ZipError("tooLarge", "archive");
    const archive = await parseArchive(await readZip(bytes));
    const local = await this.base.read(["projects", "memory", "links"], async (tx) => {
      const projects = await req(tx.objectStore("projects").getAll() as IDBRequest<Project[]>);
      const same = new Map<string, string>();
      for (const pf of archive.projects) {
        const here = projects.find((p) => p.id === pf.project.id);
        if (here) {
          const [m, l] = await Promise.all([byProject<MemoryEntry>(tx, "memory", here.id), byProject<MemoryLink>(tx, "links", here.id)]);
          same.set(here.id, contentKey(here, m, l));
        }
      }
      return { projects, same };
    });
    const taken = new Set(local.projects.map((p) => p.name));
    const projects: PreviewProject[] = archive.projects.map((pf) => {
      const p = pf.project;
      const byId = local.projects.find((x) => x.id === p.id);
      const byName = local.projects.find((x) => x.id !== p.id && x.name === p.name);
      let match: Match = "new";
      let choices: ImportChoice[] = ["add", "skip"];
      let other: Project | undefined;
      if (byId) {
        other = byId;
        if (local.same.get(byId.id) === contentKey(p, pf.memory, pf.links)) {
          match = "same";
          choices = ["skip", "copy"];
        } else {
          match = "sameId";
          choices = ["skip", "replace", "copy"];
        }
      } else if (byName) {
        other = byName;
        match = "sameName";
        choices = ["copy", "skip"];
      }
      const free = freeName(p.name, taken);
      if (choices[0] === "add" || choices[0] === "copy") taken.add(free);
      const byCategory: Partial<Record<Category, number>> = {};
      for (const e of pf.memory) byCategory[e.category] = (byCategory[e.category] ?? 0) + 1;
      return {
        id: p.id, name: p.name, description: p.description, trashed: !!p.deletedAt, match, choices, updatedAt: p.updatedAt,
        localKey: byId ? local.same.get(byId.id) : undefined,
        renameTo: free !== p.name ? free : undefined,
        local: other ? { id: other.id, name: other.name, updatedAt: other.updatedAt, trashed: !!other.deletedAt } : undefined,
        counts: {
          entries: pf.memory.length, byCategory, links: pf.links.length, events: pf.events.length,
          pending: pf.memory.filter((e) => e.confirmation === "pending").length,
          archived: pf.memory.filter((e) => e.archived).length,
          versions: pf.events.filter((e) => e.type === "memory.edited").length,
        },
      };
    });
    return { archive, app: archive.manifest.app, exportedAt: archive.manifest.exportedAt, sourceJournalOk: archive.manifest.sourceJournal.ok, projects };
  }

  // ---------- import: write ----------

  /**
   * Imports the chosen projects in ONE transaction. Choices per project id (default: the first choice
   * of the preview). If anything fails — the device changed since the preview, an id already used,
   * a full disk — nothing is saved.
   *
   * add      the project is new here: added with its own ids
   * copy     added as a separate project with new ids (and a free name, e.g. "Name (2)")
   * replace  the project with the same id is replaced by the archived copy; its earlier history stays
   *          in the journal (verifiable) but no longer describes the project
   * skip     nothing is done for this project
   */
  async importArchive(preview: ImportPreview, choices: Record<string, ImportChoice> = {}): Promise<ImportResult> {
    const plan = preview.projects.map((pp) => {
      const choice = choices[pp.id] ?? pp.choices[0];
      if (!pp.choices.includes(choice)) throw new ImportError("changed", "choice not allowed");
      return { pp, pf: preview.archive.projects.find((x) => x.project.id === pp.id)!, choice };
    });
    const todo = plan.filter((x) => x.choice !== "skip");
    if (todo.length === 0) return { imported: [], skipped: plan.length };

    return this.base.write(STORES, async (tx, ts) => {
      const locals = await req(tx.objectStore("projects").getAll() as IDBRequest<Project[]>);
      const names = new Set(locals.map((p) => p.name));
      const events: PendingEvent[] = [];
      const writes: ((w: IDBTransaction) => Promise<void> | void)[] = [];
      const imported: ImportResult["imported"] = [];

      for (const { pp, pf, choice } of todo) {
        const here = locals.find((p) => p.id === pp.id);
        // the device must still be in the state the user saw in the preview
        const nowMatch = here ? "existing" : "none";
        const wasMatch = pp.match === "same" || pp.match === "sameId" ? "existing" : "none";
        if (nowMatch !== wasMatch) throw new ImportError("changed", pp.name);
        if (here) {
          const [m, l] = await Promise.all([byProject<MemoryEntry>(tx, "memory", here.id), byProject<MemoryLink>(tx, "links", here.id)]);
          if (contentKey(here, m, l) !== pp.localKey) throw new ImportError("changed", pp.name);
        }

        let { project, memory, links, events: history } = structuredClone(pf);
        const mode = choice as Exclude<ImportChoice, "skip">;
        let renamedFrom: string | null = null;
        if (mode === "copy") ({ project, memory, links, history } = withNewIds(project, memory, links, history));
        // a new project here never takes a name already used here (or earlier in this same import)
        if (mode === "copy" || mode === "add") {
          const free = freeName(project.name, names);
          if (free !== project.name) {
            renamedFrom = project.name;
            project = { ...project, name: free, nameHistory: [...project.nameHistory, { name: renamedFrom, until: ts }] };
          }
        }
        // the archive's own import record (if the project was imported before) is not replayed as an
        // import of this device: it is kept inside this device's new record, which stays the latest one
        const earlier = history[0]?.type === "project.imported" ? history[0].data : null;
        if (earlier) history = history.slice(1);

        // no entry or link id may already be used by another project here (ids are random: this
        // only happens when the same archive is imported twice in different ways)
        for (const e of memory) {
          const used = await req(tx.objectStore("memory").get(e.id) as IDBRequest<MemoryEntry | undefined>);
          if (used && !(mode === "replace" && used.projectId === project.id)) throw new ImportError("idConflict", e.id);
        }
        for (const l of links) {
          const used = await req(tx.objectStore("links").get(l.id) as IDBRequest<MemoryLink | undefined>);
          if (used && !(mode === "replace" && used.projectId === project.id)) throw new ImportError("idConflict", l.id);
        }
        names.add(project.name);

        events.push({ type: "project.imported", projectId: project.id, data: {
          mode, name: renamedFrom ?? project.name, archive: preview.archive.manifestSha256, exportedAt: preview.exportedAt, app: preview.app,
          sourceProject: pf.project.id, events: history.length, ...(earlier ? { previous: earlier } : {}),
        } });
        for (const e of history) {
          events.push({ type: e.type, projectId: project.id, ...(e.entityId !== undefined ? { entityId: e.entityId } : {}), data: e.data!, ts: e.ts });
        }
        if (renamedFrom) events.push({ type: "project.renamed", projectId: project.id, data: { name: project.name } });

        const p = project;
        writes.push(async (w) => {
          if (mode === "replace") {
            w.objectStore("projects").delete(p.id);
            await deleteAll(w, "memory", "projectId", p.id);
            await deleteAll(w, "links", "projectId", p.id);
          }
          w.objectStore("projects").add(p);
          for (const e of memory) w.objectStore("memory").add(e);
          for (const l of links) w.objectStore("links").add(l);
        });
        imported.push({ id: p.id, name: p.name, mode });
      }
      return {
        events,
        result: { imported, skipped: plan.length - todo.length },
        apply: async (w) => {
          for (const fn of writes) await fn(w);
        },
      };
    });
  }
}

/** A copy of an archived project with fresh ids everywhere (project, entries, links, and inside its history). */
function withNewIds(project: Project, memory: MemoryEntry[], links: MemoryLink[], history: ArchivedEvent[]) {
  const map = new Map<string, string>();
  const pid = newProjectId();
  map.set(project.id, pid);
  for (const e of memory) map.set(e.id, newEntryId());
  for (const l of links) map.set(l.id, newLinkId());
  // entries and links that existed only in the history (deleted later) also get new ids
  for (const ev of history) {
    if (ev.entityId && !map.has(ev.entityId)) map.set(ev.entityId, ev.entityId.startsWith("M-") ? newEntryId() : newLinkId());
  }
  const id = (x: string) => map.get(x) ?? x;
  return {
    project: { ...project, id: pid },
    memory: memory.map((e) => ({ ...e, id: id(e.id), projectId: pid })),
    links: links.map((l) => ({ ...l, id: id(l.id), projectId: pid, from: id(l.from), to: id(l.to) })),
    history: history.map((ev) => {
      const data = { ...ev.data! };
      if (ev.type === "link.created") {
        if (typeof data.from === "string") data.from = id(data.from);
        if (typeof data.to === "string") data.to = id(data.to);
      }
      return { ...ev, projectId: pid, ...(ev.entityId !== undefined ? { entityId: id(ev.entityId) } : {}), data };
    }),
  };
}

export { ArchiveError, ZipError };
