// AI work sessions (AIW-05), written through the shared journal like projects and memory.
// The decisive operation is applyReply(): the AI's reply, every proposal found in it, and the user's
// decision on each (accept → official memory, reject → archive, later → stays a pending proposal),
// saved in ONE transaction. Official memory is never changed without the user's explicit acceptance.
import {
  assistantName, checkEntry, checkExchangeText, checkLink, checkSessionInput, cleanBody, cleanText, cleanTitle, isOfficial,
  isSessionId, namedProvider, newEntryId, newExchangeId, newLinkId, newSessionId, statusFromLinks, charCount, stripUnsafe, REASON_MAX, SOURCE_MAX,
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
    // same millisecond: a message comes before the answer to it
    const rank = { sent: 0, ask: 1, reply: 2, note: 3 } as const;
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || rank[a.kind] - rank[b.kind] || a.id.localeCompare(b.id));
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
      .filter((x) => x.kind === "reply" || x.kind === "note")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, limit)
      .map((exchange) => ({ exchange, assistant: sById.has(exchange.sessionId) ? assistantName(sById.get(exchange.sessionId)!) : "AI" }));
  }

  /**
   * AIW-09: for the conversation list — every chat's first question and the text of all its questions
   * (for titles and search), in one read of the project's steps.
   */
  async questionIndex(projectId: string): Promise<Map<string, { first: string; all: string }>> {
    const all = await this.base.read(["exchanges"], (tx) => byIndex<Exchange>(tx, "exchanges", "projectId", projectId));
    const asks = all.filter((x) => x.kind === "ask").sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const out = new Map<string, { first: string; all: string }>();
    for (const x of asks) {
      const cur = out.get(x.sessionId);
      const typed = x.text.split(/\n\n(?=Fișier atașat: |Attached file: |\[poză atașată: |\[attached photo: )/)[0];
      if (!cur) out.set(x.sessionId, { first: x.text, all: typed });
      else if (cur.all.length < 4000) cur.all += "\n" + typed;
    }
    return out;
  }

  // ---------- writing ----------

  /**
   * Starts a session and records the package that was handed over, in one step.
   * `continues`: the session whose work moves to this assistant (or null).
   */
  async start(projectId: string, input: { provider: ProviderId; providerName?: string; task?: string; continues?: string | null },
    pack: { sha256: string; chars: number; refs: Record<string, string> }): Promise<Session> {
    if (input.provider === "inapp") throw new SessionError("invalid", "provider"); // the in-app chat starts with startChat()
    const providerName = namedProvider(input.provider) ? cleanTitle(input.providerName ?? "") : "";
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

  /**
   * AIW-06: starts a chat inside the app with one model. Nothing is sent yet: each message is saved with
   * ask(), the model's answer with applyReply(). `continues`: the chat this one carries on (another model).
   */
  async startChat(projectId: string, model: string, continues: string | null = null): Promise<Session> {
    const providerName = cleanTitle(model);
    const problem = checkSessionInput({ provider: "inapp", providerName, task: "" });
    if (problem) throw new SessionError(problem);
    return this.base.write(STORES, async (tx, ts) => {
      const project = await getProject(tx, projectId);
      if (!project || project.deletedAt) throw new SessionError("project");
      if (continues) {
        const prev = await getSession(tx, continues);
        if (!prev || prev.projectId !== projectId) throw new SessionError("missing");
      }
      const session: Session = { id: newSessionId(), projectId, provider: "inapp", providerName, task: "", status: "open", continues: continues ?? null, createdAt: ts, updatedAt: ts, v: 1 };
      return {
        result: session,
        events: [{ type: "session.created", projectId, entityId: session.id, data: { provider: "inapp", providerName, task: "", continues: session.continues } }],
        apply: (w) => void w.objectStore("sessions").add(session),
      };
    });
  }

  /**
   * AIW-06.1: a conversation exported from the user's own ChatGPT / Claude account becomes a chat of the
   * project (closed; it can be continued in the chat with any model). One write: the chat and every message,
   * in order. The official memory is not touched: proposals come only from a review the user does later.
   */
  async importChat(projectId: string, origin: "chatgpt" | "claude", title: string, messages: { role: "user" | "assistant"; text: string }[]): Promise<Session> {
    const providerName = `import:${origin}`;
    const task = cleanText([...title.replace(/\s+/g, " ")].slice(0, 200).join(""));
    const list = messages.map((m) => ({ role: m.role, text: cleanText(m.text) })).filter((m) => m.text);
    if (list.length === 0 || list[0].role !== "user") throw new SessionError("textEmpty");
    for (const m of list) {
      const p = checkExchangeText(m.text);
      if (p) throw new SessionError(p);
    }
    return this.base.write(STORES, async (tx, ts) => {
      const project = await getProject(tx, projectId);
      if (!project || project.deletedAt) throw new SessionError("project");
      // one millisecond apart, so the order of the conversation is kept
      const at = (i: number) => new Date(Date.parse(ts) + i).toISOString();
      const end = at(list.length + 1);
      const session: Session = { id: newSessionId(), projectId, provider: "inapp", providerName, task, status: "closed", continues: null, createdAt: ts, updatedAt: end, v: 1 };
      const events: PendingEvent[] = [{ type: "session.created", projectId, entityId: session.id, data: { provider: "inapp", providerName, task, continues: null } }];
      const rows: Exchange[] = list.map((m, i) => ({
        id: newExchangeId(), sessionId: session.id, projectId, kind: m.role === "user" ? "ask" : "reply", text: m.text, pack: null, proposals: [], createdAt: at(i + 1), v: 1,
      }));
      for (const x of rows) events.push({ ...exchangeEvent(x), ts: x.createdAt });
      events.push({ type: "session.closed", projectId, entityId: session.id, data: {}, ts: end });
      return {
        result: session,
        events,
        apply: (w) => {
          w.objectStore("sessions").add(session);
          for (const x of rows) w.objectStore("exchanges").add(x);
        },
      };
    });
  }

  /** AIW-06: the user's message in an in-app chat, with the fingerprint of the project context sent along (or null). */
  async ask(sessionId: string, text: string, pack: Exchange["pack"]): Promise<Exchange> {
    if (pack && !/^[0-9a-f]{64}$/.test(pack.sha256)) throw new SessionError("invalid", "pack");
    return this.addExchange(sessionId, "ask", text, pack ? { ...pack, refs: { ...pack.refs } } : null);
  }

  /** The package was prepared again inside an open session (e.g. after editing memory). */
  async recordSent(sessionId: string, pack: { sha256: string; chars: number; refs: Record<string, string> }): Promise<Exchange> {
    return this.addExchange(sessionId, "sent", "", pack);
  }

  async addNote(sessionId: string, text: string): Promise<Exchange> {
    return this.addExchange(sessionId, "note", text, null);
  }

  private async addExchange(sessionId: string, kind: "sent" | "note" | "ask", raw: string, pack: Exchange["pack"]): Promise<Exchange> {
    const text = cleanText(raw);
    if (kind !== "sent") {
      const p = checkExchangeText(text);
      if (p) throw new SessionError(p);
    }
    return this.base.write(STORES, async (tx, ts) => {
      const s = await this.writable(tx, sessionId);
      // a chat message only in a chat; a package only in a session with an outside assistant
      if ((kind === "ask") !== (s.provider === "inapp") && kind !== "note") throw new SessionError("invalid", "kind");
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
