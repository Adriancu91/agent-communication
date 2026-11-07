// AI work sessions (AIW-05), written through the shared journal like projects and memory.
// The decisive operation is applyReply(): the AI's reply, every proposal found in it, and the user's
// decision on each (accept → official memory, reject → archive, later → stays a pending proposal),
// saved in ONE transaction. Official memory is never changed without the user's explicit acceptance.
import {
  assistantName, checkEntry, checkExchangeText, checkLink, checkSessionInput, cleanBody, cleanText, cleanTitle, isOfficial,
  isSessionId, newEntryId, newExchangeId, newLinkId, newSessionId, statusFromLinks, charCount, stripUnsafe, REASON_MAX, SOURCE_MAX,
  type Category, type Exchange, type MemoryEntry, type MemoryLink, type Project, type ProviderId, type Session,
} from "../core";
import { JournaledStore, req, StorageError, type PendingEvent } from "../storage";

export class SessionError extends Error {
  constructor(public reason: "providerName" | "taskLong" | "textEmpty" | "textLong" | "chars" | "missing" | "closed" | "project" | "invalid" | "relationLater",
    detail = "", /** Which proposal (index in the list) could not be saved, when one is the cause. */ public item?: number) {
    super(`session:${reason}${detail ? ` (${detail})` : ""}`);
    this.name = "SessionError";
  }
}

export type Verdict = "accept" | "reject" | "later";

/** One reviewed proposal, as the user left it (possibly edited). */
export interface ReviewedProposal {
  category: Category;
  title: string;
  body: string;
  important: boolean;
  /** What the AI originally wrote, when the user edited it (kept as the first version). */
  original?: { title: string; body: string };
  replaces: string | null;
  resolves: string | null;
  reason: string;
  verdict: Verdict;
}

const STORES = ["projects", "memory", "links", "sessions", "exchanges", "events"];

const getProject = (tx: IDBTransaction, id: string) => req(tx.objectStore("projects").get(id) as IDBRequest<Project | undefined>);
const getSession = (tx: IDBTransaction, id: string) => req(tx.objectStore("sessions").get(id) as IDBRequest<Session | undefined>);
const byIndex = <T>(tx: IDBTransaction, store: string, index: string, key: string) =>
  req(tx.objectStore(store).index(index).getAll(IDBKeyRange.only(key)) as IDBRequest<T[]>);

function exchangeEvent(x: Exchange): PendingEvent {
  return { type: "session.exchange", projectId: x.projectId, entityId: x.id, data: { session: x.sessionId, kind: x.kind, text: x.text, pack: x.pack, proposals: x.proposals } };
}

export class SessionStore {
  constructor(readonly base: JournaledStore) {}

  subscribe(l: () => void): () => void {
    return this.base.subscribe(l);
  }

  // ---------- reading ----------

  async list(projectId?: string): Promise<Session[]> {
    const all = await this.base.read(["sessions"], (tx) => (projectId ? byIndex<Session>(tx, "sessions", "projectId", projectId) : req(tx.objectStore("sessions").getAll() as IDBRequest<Session[]>)));
    return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<Session | undefined> {
    if (!isSessionId(id)) return undefined;
    return this.base.read(["sessions"], (tx) => getSession(tx, id));
  }

  /** A session's steps, oldest first. */
  async exchanges(sessionId: string): Promise<Exchange[]> {
    const all = await this.base.read(["exchanges"], (tx) => byIndex<Exchange>(tx, "exchanges", "sessionId", sessionId));
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  /** The project's saved replies and notes, most recent first (to include in a new package if the user wants). */
  async savedReplies(projectId: string, limit: number): Promise<{ exchange: Exchange; assistant: string }[]> {
    if (limit <= 0) return [];
    const { exchanges, sessions } = await this.base.read(["exchanges", "sessions"], async (tx) => ({
      exchanges: await byIndex<Exchange>(tx, "exchanges", "projectId", projectId),
      sessions: await byIndex<Session>(tx, "sessions", "projectId", projectId),
    }));
    const sById = new Map(sessions.map((s) => [s.id, s]));
    return exchanges
      .filter((x) => x.kind !== "sent")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((exchange) => ({ exchange, assistant: sById.has(exchange.sessionId) ? assistantName(sById.get(exchange.sessionId)!) : "AI" }));
  }

  // ---------- writing ----------

  /**
   * Starts a session and records the package that was handed over, in one step.
   * `continues`: the session whose work moves to this assistant (or null).
   */
  async start(projectId: string, input: { provider: ProviderId; providerName?: string; task?: string; continues?: string | null },
    pack: { sha256: string; chars: number; refs: Record<string, string> }): Promise<Session> {
    const providerName = input.provider === "other" ? cleanTitle(input.providerName ?? "") : "";
    const task = cleanText(input.task ?? "");
    const problem = checkSessionInput({ provider: input.provider, providerName, task });
    if (problem) throw new SessionError(problem);
    if (!/^[0-9a-f]{64}$/.test(pack.sha256)) throw new SessionError("invalid", "pack");
    return this.base.write(STORES, async (tx, ts) => {
      const project = await getProject(tx, projectId);
      if (!project || project.deletedAt) throw new SessionError("project");
      let continues: string | null = null;
      if (input.continues) {
        const prev = await getSession(tx, input.continues);
        if (!prev || prev.projectId !== projectId) throw new SessionError("missing");
        continues = prev.id;
      }
      const session: Session = { id: newSessionId(), projectId, provider: input.provider, providerName, task, status: "open", continues, createdAt: ts, updatedAt: ts, v: 1 };
      const sent: Exchange = { id: newExchangeId(), sessionId: session.id, projectId, kind: "sent", text: "", pack: { ...pack, refs: { ...pack.refs } }, proposals: [], createdAt: ts, v: 1 };
      return {
        result: session,
        events: [
          { type: "session.created", projectId, entityId: session.id, data: { provider: session.provider, providerName, task, continues } },
          exchangeEvent(sent),
        ],
        apply: (w) => {
          w.objectStore("sessions").add(session);
          w.objectStore("exchanges").add(sent);
        },
      };
    });
  }

  /** The package was prepared again inside an open session (e.g. after editing memory). */
  async recordSent(sessionId: string, pack: { sha256: string; chars: number; refs: Record<string, string> }): Promise<Exchange> {
    return this.addExchange(sessionId, "sent", "", pack);
  }

  async addNote(sessionId: string, text: string): Promise<Exchange> {
    return this.addExchange(sessionId, "note", text, null);
  }

  private async addExchange(sessionId: string, kind: "sent" | "note", raw: string, pack: Exchange["pack"]): Promise<Exchange> {
    const text = cleanText(raw);
    if (kind === "note") {
      const p = checkExchangeText(text);
      if (p) throw new SessionError(p);
    }
    return this.base.write(STORES, async (tx, ts) => {
      const s = await this.writable(tx, sessionId);
      const x: Exchange = { id: newExchangeId(), sessionId, projectId: s.projectId, kind, text, pack, proposals: [], createdAt: ts, v: 1 };
      return {
        result: x,
        events: [exchangeEvent(x)],
        apply: (w) => {
          w.objectStore("exchanges").add(x);
          w.objectStore("sessions").put({ ...s, updatedAt: ts });
        },
      };
    });
  }

  async close(sessionId: string): Promise<Session> {
    return this.setStatus(sessionId, "closed");
  }
  async reopen(sessionId: string): Promise<Session> {
    return this.setStatus(sessionId, "open");
  }

  private async setStatus(sessionId: string, status: Session["status"]): Promise<Session> {
    return this.base.write(STORES, async (tx, ts) => {
      const s = await getSession(tx, sessionId);
      if (!s) throw new SessionError("missing");
      const project = await getProject(tx, s.projectId);
      if (!project || project.deletedAt) throw new SessionError("project");
      if (s.status === status) return { events: [], result: s };
      const next = { ...s, status, updatedAt: ts };
      return {
        result: next,
        events: [{ type: status === "closed" ? "session.closed" : "session.reopened", projectId: s.projectId, entityId: s.id, data: {} }],
        apply: (w) => void w.objectStore("sessions").put(next),
      };
    });
  }

  private async writable(tx: IDBTransaction, sessionId: string): Promise<Session> {
    const s = isSessionId(sessionId) ? await getSession(tx, sessionId) : undefined;
    if (!s) throw new SessionError("missing");
    if (s.status === "closed") throw new SessionError("closed");
    const project = await getProject(tx, s.projectId);
    if (!project || project.deletedAt) throw new SessionError("project");
    return s;
  }

  /**
   * Saves an AI reply and the user's decision on every proposal found in it, in ONE transaction.
   * Each proposal becomes a memory entry written by "ai" with its source (the assistant and the date):
   *   accept → confirmed (official); its relation (replaces a decision / resolves a problem) is created
   *   reject → rejected (kept in the archive: the decision history stays complete)
   *   later  → pending (listed under Memory → Proposals, outside the official memory and any context)
   * An entry the user edited keeps the AI's original text as version 1 and the user's text as version 2.
   */
  async applyReply(sessionId: string, replyText: string, proposals: ReviewedProposal[]): Promise<{ exchange: Exchange; entries: MemoryEntry[] }> {
    const text = cleanText(replyText);
    const p = checkExchangeText(text);
    if (p) throw new SessionError(p);
    const items = proposals.map((x, i) => {
      const title = cleanTitle(x.title);
      const body = cleanBody(x.body);
      const orig = x.original ? { title: cleanTitle(x.original.title), body: cleanBody(x.original.body) } : null;
      const err = checkEntry({ title, body, category: x.category }) ?? (orig ? checkEntry({ title: orig.title, body: orig.body }) : null);
      if (err) throw new SessionError("invalid", `${err.field}:${err.problem}`, i);
      const reason = stripUnsafe(cleanBody(x.reason));
      if (charCount(reason) > REASON_MAX) throw new SessionError("invalid", "reason", i);
      if (!["accept", "reject", "later"].includes(x.verdict)) throw new SessionError("invalid", "verdict", i);
      if (typeof x.important !== "boolean") throw new SessionError("invalid", "important", i);
      // a relation (replaces / resolves) is decided now: kept for later it would be lost, leaving two
      // contradictory decisions official once the proposal is confirmed
      if (x.verdict === "later" && (x.replaces || x.resolves)) throw new SessionError("relationLater", "", i);
      const edited = orig && (orig.title !== title || orig.body !== body) ? orig : null;
      return { ...x, title, body, reason, edited };
    });

    return this.base.write(STORES, async (tx, ts) => {
      const s = await this.writable(tx, sessionId);
      const [entries, links] = await Promise.all([
        byIndex<MemoryEntry>(tx, "memory", "projectId", s.projectId),
        byIndex<MemoryLink>(tx, "links", "projectId", s.projectId),
      ]);
      const source = [...`${assistantName(s)} · ${ts.slice(0, 10)}`].slice(0, SOURCE_MAX).join("");
      const events: PendingEvent[] = [];
      const byId = new Map(entries.map((e) => [e.id, e]));
      const allLinks = [...links];
      const newLinks: MemoryLink[] = [];
      const created: MemoryEntry[] = [];
      const touched = new Map<string, MemoryEntry>(); // existing entries whose status changes

      for (const [index, it] of items.entries()) {
        const first = it.edited ?? { title: it.title, body: it.body };
        const id = newEntryId();
        let entry: MemoryEntry = {
          id, projectId: s.projectId, category: it.category, title: first.title, body: first.body, important: it.important,
          status: "active", archived: false, author: "ai", source, confirmation: "pending", confirmedAt: null,
          createdAt: ts, updatedAt: ts, version: 1, v: 1,
        };
        events.push({ type: "memory.created", projectId: s.projectId, entityId: id, data: {
          category: it.category, title: first.title, body: first.body, important: it.important, author: "ai", source, confirmation: "pending", version: 1,
        } });
        if (it.edited) {
          entry = { ...entry, title: it.title, body: it.body, version: 2 };
          events.push({ type: "memory.edited", projectId: s.projectId, entityId: id, data: { title: it.title, body: it.body, version: 2 } });
        }
        if (it.verdict === "accept") {
          entry = { ...entry, confirmation: "confirmed", confirmedAt: ts };
          events.push({ type: "memory.confirmed", projectId: s.projectId, entityId: id, data: {} });
        } else if (it.verdict === "reject") {
          entry = { ...entry, confirmation: "rejected", archived: true };
          events.push({ type: "memory.rejected", projectId: s.projectId, entityId: id, data: {} });
        }
        byId.set(id, entry);
        created.push(entry);

        // the relation the AI proposed, only for an accepted proposal (same rules as a link made by hand)
        const relation = it.verdict === "accept" ? (it.replaces ? { type: "replaces" as const, to: it.replaces } : it.resolves ? { type: "resolves" as const, to: it.resolves } : null) : null;
        if (relation) {
          const target = touched.get(relation.to) ?? byId.get(relation.to);
          const problem = checkLink(entry, target, relation.type, allLinks);
          if (problem) throw new SessionError("invalid", `link:${problem}`, index);
          const link: MemoryLink = { id: newLinkId(), projectId: s.projectId, from: id, to: relation.to, type: relation.type,
            reason: it.reason || (relation.type === "replaces" ? source : ""), createdAt: ts, v: 1 };
          allLinks.push(link);
          newLinks.push(link);
          events.push({ type: "link.created", projectId: s.projectId, entityId: link.id, data: { from: id, to: relation.to, type: relation.type, reason: link.reason } });
          const official = (x: string) => { const e = touched.get(x) ?? byId.get(x); return !!e && isOfficial(e); };
          const status = statusFromLinks(relation.to, allLinks, official);
          if (status !== target!.status) {
            const t = { ...target!, status, updatedAt: ts };
            touched.set(t.id, t);
            byId.set(t.id, t);
            events.push({ type: "memory.status", projectId: s.projectId, entityId: t.id, data: { status } });
          }
        }
      }

      const x: Exchange = { id: newExchangeId(), sessionId, projectId: s.projectId, kind: "reply", text, pack: null, proposals: created.map((e) => e.id), createdAt: ts, v: 1 };
      events.push(exchangeEvent(x));
      return {
        result: { exchange: x, entries: created },
        events,
        apply: (w) => {
          for (const e of created) w.objectStore("memory").add(e);
          for (const t of touched.values()) w.objectStore("memory").put(t);
          for (const l of newLinks) w.objectStore("links").add(l);
          w.objectStore("exchanges").add(x);
          w.objectStore("sessions").put({ ...s, updatedAt: ts });
        },
      };
    });
  }
}

export { StorageError };
