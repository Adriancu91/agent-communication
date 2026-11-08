// AIW-06: the chat inside the app (#/chat[/<project>[/<chat>]]).
// The user signs in once to their own Puter account; messages then go to the chosen model and the answer
// comes back here, streamed. Every question and answer is saved in the project's history (journal).
// The official memory still changes ONLY when the user accepts a proposal (the same review as before).
import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { assistantName, sha256, type Exchange, type Project, type Session } from "../core";
import { parseReply } from "../continuity";
import {
  buildMessages, builtInPrompts, callOptions, cleanEconomy, cleanMyPrompts, DEFAULT_ECONOMY, DEFAULT_MODEL, estimateCost,
  tokensForChars, findModel, HISTORY_CHOICES, isModelId, messagesChars, MODELS, MY_PROMPT_LABEL_MAX, MY_PROMPT_TEXT_MAX, MY_PROMPTS_MAX,
  FREE_MODEL, OUTPUT_CHOICES, PRESETS, viaOf, AUTO, ROUTE, FREE_GAP_MS, decideLocally, dispatchMessages, extractMessages, finalTag, type PaidLevel, needsSummary, olderTurns, pilotEconomy, readTag, summaryMessages, withExtract, withSummary, type Level, type Summary, type Via, COUNCIL, COUNCIL_MAX, COUNCIL_MIN, cleanCouncil, councilText, judgeMessages, memberMessages, nameOf, type Council, type MemberAnswer, type ChatMessage, type WireMessage, messageWithFiles, imagesOf, withImages, seesImages, IMAGE_TOKENS, MAX_ATTACHMENTS, type Attachment, presetOf, priceHint, systemPrompt, type AnswerStyle, type ContextMode, type Economy, type MyPrompt, type PresetId,
} from "../chat";
import { ReplyDialog, Segmented, copyText, useSessions } from "./continuity";
import { errorKey, lastProject, rememberProject, sessionStore, useMemory, useProjects } from "./data";
import { fill, useDate, useI18n, type Key } from "./i18n";
import { IconClip, IconMic, IconSend, IconSpark, IconStop } from "./icons";
import { ACCEPT, FileError, readAttachment } from "./files";
import { Markdown } from "./markdown";
import * as puter from "./puter";
import { CodeTools, PreviewDialog } from "./runner";
import * as voice from "./voice";
import { Dialog, toast } from "./widgets";

export const chatUrl = (projectId?: string, sessionId?: string) =>
  "#/chat" + (projectId ? `/${encodeURIComponent(projectId)}` + (sessionId ? `/${encodeURIComponent(sessionId)}` : "") : "");

// ---------- settings kept on this device (not project data) ----------

const SETTINGS = "aiw.chat";
const MY_PROMPTS = "aiw.chat.prompts";
const PENDING = "aiw.chat.pending.";
/** AIW-08: the pilot's summary of the older part of a chat (on this device; rebuilt when needed). */
const SUMMARY = "aiw.chat.summary.";

interface ChatSettings {
  model: string;
  economy: Economy;
  /** when the Puter credit runs out, continue on the free model (no account) — on by default */
  autoFree: boolean;
  /** the user agreed (once) that messages may go to the free public service */
  freeConsent: boolean;
  /** AIW-08: the user agreed (once) to the automatic pilot (it sends more to the free service than the free mode) */
  pilotConsent: boolean;
  /** AIW-07: read every answer aloud */
  readAloud: boolean;
  /** AIW-07: the council of models (on = every question goes to all members, then to the judge) */
  councilOn: boolean;
  council: Council;
}

function readJson(key: string): unknown {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* not fatal: the setting is just not remembered */
  }
}
function readSettings(): ChatSettings {
  const r = (readJson(SETTINGS) ?? {}) as Record<string, unknown>;
  // AIW-08: a new user starts on the automatic pilot (an earlier user keeps the model: see ChatView)
  return { model: isModelId(r.model) ? r.model : AUTO, economy: cleanEconomy(r.economy), autoFree: r.autoFree !== false, freeConsent: r.freeConsent === true, pilotConsent: r.pilotConsent === true, readAloud: r.readAloud === true, councilOn: r.councilOn === true, council: cleanCouncil(r.council) };
}

/** An answer with memory proposals waits here (on this device) until the user reviews it. */
interface Pending { sid: string; askId: string; text: string; at: string }
const readPending = (sid: string): Pending | null => {
  const r = readJson(PENDING + sid) as Pending | null;
  return r && r.sid === sid && typeof r.askId === "string" && typeof r.text === "string" && typeof r.at === "string" ? r : null;
};

// ---------- AIW-08: the pilot's summary of a long chat ----------

function readSummary(sid: string): Summary | null {
  const r = readJson(SUMMARY + sid) as Summary | null;
  return r && typeof r.n === "number" && r.n > 0 && typeof r.text === "string" ? r : null;
}

const summarizing = new Set<string>();
/**
 * After a paid answer: when the chat has outgrown the history window, the free model updates a short
 * summary of the older part, at its next free turn. Skipped (until next time) when the turn is taken.
 */
async function summarize(sid: string, turns: { kind: string; text: string }[], history: number, lang: "ro" | "en"): Promise<void> {
  const older = olderTurns(turns, history);
  const prev = readSummary(sid);
  if (!needsSummary(older.length, prev) || summarizing.has(sid)) return;
  summarizing.add(sid);
  try {
    const free = await import("./freeai");
    const wait = free.freeSlotIn(FREE_GAP_MS);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait + 300));
    if (free.freeSlotIn(FREE_GAP_MS) > 0) return; // another free request took the turn: next time
    const text = (await free.helperFree(summaryMessages(older, prev, lang), 30000)).trim();
    if (text) writeJson(SUMMARY + sid, { n: older.length, text: text.slice(0, 1500) });
  } catch {
    /* no summary this time: the chat works as before */
  } finally {
    summarizing.delete(sid);
  }
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(new puter.PuterError("aborted"))), { once: true });
  });

// ---------- the conversation: this chat and the chats it continues (another model, same work) ----------

function useThread(session: Session | undefined, sessions: Session[]): Exchange[] | null {
  const [steps, setSteps] = useState<Exchange[] | null>(null);
  const chain = useMemo(() => {
    const ids: string[] = [];
    let s = session;
    const seen = new Set<string>();
    while (s && s.provider === "inapp" && !seen.has(s.id) && ids.length < 20) {
      seen.add(s.id);
      ids.unshift(s.id);
      s = s.continues ? sessions.find((x) => x.id === s!.continues) : undefined;
    }
    return ids;
  }, [session?.id, session?.continues, sessions]);
  useEffect(() => {
    if (!chain.length) {
      setSteps([]);
      return;
    }
    let alive = true;
    setSteps(null); // another chat: never show (or judge by) the previous chat's steps while loading
    const load = () => Promise.all(chain.map((id) => sessionStore.exchanges(id))).then((all) => alive && setSteps(all.flat()), () => alive && setSteps([]));
    load();
    const off = sessionStore.subscribe(load);
    return () => {
      alive = false;
      off();
    };
  }, [chain.join("|")]);
  return steps;
}

type Account = { state: "loading" | "out" | "in" | "error"; name: string | null; credit: { value: number; unit: "credits" | "usd" } | null };

function useAccount(): [Account, () => Promise<void>] {
  const [a, setA] = useState<Account>({ state: "loading", name: null, credit: null });
  const refresh = async () => {
    try {
      await puter.loadPuter();
    } catch {
      setA({ state: "error", name: null, credit: null });
      return;
    }
    if (!puter.isSignedIn()) return setA({ state: "out", name: null, credit: null });
    setA((x) => ({ ...x, state: "in" }));
    const [name, credit] = await Promise.all([puter.userName(), puter.remainingCredit()]);
    setA({ state: "in", name, credit });
  };
  useEffect(() => void refresh(), []);
  return [a, refresh];
}

const k = (n: number) => (n >= 10000 ? Math.round(n / 1000) + "k" : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "k" : String(n));

function money(v: number, lang: string): string {
  if (v < 0.01) return "<$0.01";
  return new Intl.NumberFormat(lang, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v);
}

// ---------- the screen ----------

export function ChatScreen(props: { projectId?: string; sessionId?: string }): JSX.Element {
  const { t, lang } = useI18n();
  const date = useDate();
  const { projects, loading: pLoading } = useProjects();
  const live = projects.filter((p) => !p.deletedAt);
  const projectId = props.projectId && live.some((p) => p.id === props.projectId) ? props.projectId
    : live.find((p) => p.id === lastProject())?.id ?? live[0]?.id;
  const project = live.find((p) => p.id === projectId);
  useEffect(() => void (projectId && rememberProject(projectId)), [projectId]);

  if (pLoading) return <section><h1 class="large-title">{t("chTitle")}</h1><p class="muted">{t("loading")}</p></section>;
  if (!project) {
    return (
      <section>
        <h1 class="large-title">{t("chTitle")}</h1>
        <div class="card empty hero-empty">
          <div class="orb"><IconSpark /></div>
          <p class="lead">{t("chNoProject")}</p>
          <p class="muted">{t("chNoProjectHint")}</p>
          <a class="button link-button" href="#/proiecte">{t("projectsNew")}</a>
        </div>
      </section>
    );
  }
  return <ChatView project={project} projects={live} sessionId={props.sessionId} key={project.id} date={date} lang={lang} />;
}

function ChatView(props: { project: Project; projects: Project[]; sessionId?: string; date: (iso: string) => string; lang: "ro" | "en" }): JSX.Element {
  const { t } = useI18n();
  const { project, lang } = props;
  const { sessions, loading: sessionsLoading } = useSessions();
  const chats = sessions.filter((s) => s.projectId === project.id && s.provider === "inapp");
  const [settings, setSettingsState] = useState<ChatSettings>(readSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  /** always from the latest settings (an answer arriving later never writes back old ones) */
  const updateSettings = (f: (s: ChatSettings) => ChatSettings) => {
    const n = f(settingsRef.current);
    settingsRef.current = n; // a send right after (same tap) already sees the new settings
    setSettingsState(n);
    writeJson(SETTINGS, n);
  };
  // AIW-08: the pilot is the default only for someone who never chatted here; an earlier user (who used the
  // default model without ever saving a setting) keeps it, so their chats are not split or redirected
  const fresh = useRef(readJson(SETTINGS) === null);
  useEffect(() => {
    if (!fresh.current || sessionsLoading) return;
    fresh.current = false;
    const earlier = sessions.some((s) => s.provider === "inapp" && !s.providerName.startsWith("import:"));
    updateSettings((x) => ({ ...x, model: earlier && x.model === AUTO ? DEFAULT_MODEL : x.model }));
  }, [sessionsLoading]);
  const [myPrompts, setMyPromptsState] = useState<MyPrompt[]>(() => cleanMyPrompts(readJson(MY_PROMPTS)));
  const setMyPrompts = (l: MyPrompt[]) => {
    setMyPromptsState(l);
    writeJson(MY_PROMPTS, l);
  };
  // the chat shown: the one in the address, else the latest open one of this project; null = a new chat
  const [chosen, setChosen] = useState<string | null | undefined>(props.sessionId);
  useEffect(() => setChosen(props.sessionId), [props.sessionId]);
  const session = chosen === null ? undefined : chats.find((s) => s.id === chosen) ?? (chosen === undefined ? chats.find((s) => s.status === "open") : undefined);
  const steps = useThread(session, sessions);
  const { entries, links, loading: memLoading } = useMemory(project.id);
  const [account, refreshAccount] = useAccount();

  const [input, setInput] = useState("");
  // AIW-07: files attached to the next message (read on the device)
  const [files, setFiles] = useState<Attachment[]>([]);
  const [reading, setReading] = useState(false);
  // AIW-07: voice — dictation, reading answers aloud, and the hands-free conversation (listen → send → read → listen)
  const [listening, setListening] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const hearing = useRef<voice.Listening | null>(null);
  const handsFreeRef = useRef(false);
  handsFreeRef.current = handsFree;
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ key: Key; sessionId: string; askId: string } | null>(null);
  const [usage, setUsage] = useState<Record<string, { input: number; output: number; cut: boolean; model: string }>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  // AIW-07: the code agent's preview (a page of code from an answer, run in isolation)
  const [runHtml, setRunHtml] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"model" | "eco" | "prompts" | "history" | "account" | "review" | "council" | "menu" | null>(null);
  const abort = useRef<AbortController | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // the chat on screen, for answers that arrive after the user moved to another chat
  const shown = useRef<string | undefined>(undefined);
  shown.current = session?.id;
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  // the free service is used only after the user agreed once (it is another company)
  const [consent, setConsent] = useState<{ question: string; sid: string; askId: string } | null>(null);
  // AIW-08: asked once, at the first message — the pilot (it uses the free service) or a Puter sign-in
  const [ask, setAsk] = useState<null | { kind: "pilot" | "connect"; text: string }>(null);
  // a message held by one of those questions, sent again once the new settings are on screen
  const [resend, setResend] = useState<string | null>(null);
  // AIW-08: what the pilot is doing now, and which model answered each question (this visit only)
  const [pilotNote, setPilotNote] = useState<string | null>(null);
  const [routes, setRoutes] = useState<Record<string, { model: string; level: Level }>>({});
  const sessionSteps = (steps ?? []).filter((x) => x.sessionId === session?.id);
  const lastStep = sessionSteps[sessionSteps.length - 1];

  // the answer waiting for review: only for its own chat, only while its question is still the last
  // step (another tab may have reviewed it meanwhile), and kept in step with other tabs
  useEffect(() => {
    const load = () => {
      const p = session ? readPending(session.id) : null;
      // stale only when this chat's own steps are loaded and its last one is not that question any more
      if (p && steps !== null && lastStep && lastStep.sessionId === p.sid && !(lastStep.kind === "ask" && lastStep.id === p.askId)) {
        writeJson(PENDING + p.sid, null);
        return setPending(null);
      }
      setPending(p);
    };
    load();
    const onStorage = (e: StorageEvent) => void (e.key === null || e.key.startsWith(PENDING) ? load() : undefined);
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [session?.id, lastStep?.id, steps === null]);
  // the newest message stays in view above the message box, unless the user scrolled up to read
  const atBottom = useRef(true);
  useEffect(() => {
    const on = () => void (atBottom.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160);
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    if ((steps?.length || streaming !== null || pending) && atBottom.current) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [steps?.length, streaming, pending]);

  const model = settings.model;
  const eco = settings.economy;
  const modelInfo = findModel(model);
  const isAuto = !settings.councilOn && model === AUTO;
  const signedIn = account.state === "in";
  const formatDate = (iso: string) => props.date(iso);
  const system = useMemo(
    () => systemPrompt(project, entries, links, { lang, economy: eco, assistant: model === AUTO ? "Auto" : modelInfo?.name ?? model, maxChars: 24000, date: props.date(new Date().toISOString()), formatDate }),
    [project, entries, links, lang, eco, model],
  );
  const thread = steps ?? [];
  const draft = files.length ? messageWithFiles(input || " ", files, lang) : input || " ";
  const preview = useMemo(() => buildMessages(system.text, thread, draft, eco, lang), [system.text, thread, draft, eco, lang]);
  const tokens = tokensForChars(messagesChars(preview)) + imagesOf(files).length * IMAGE_TOKENS;
  // the same question with every saving switched off, for the "you save ~N%" line
  const fullTokens = useMemo(() => {
    const full = systemPrompt(project, entries, links, { lang, economy: PRESETS.quality, assistant: modelInfo?.name ?? model, maxChars: 24000, date: "", formatDate });
    return tokensForChars(messagesChars(buildMessages(full.text, thread, draft, PRESETS.quality, lang))) + imagesOf(files).length * IMAGE_TOKENS;
  }, [project, entries, links, lang, thread, draft, model]);
  const saved = fullTokens > 0 ? Math.max(0, Math.round((1 - tokens / fullTokens) * 100)) : 0;
  // the pilot answers through Puter when signed in, otherwise everything goes to the free model
  const via: Via = settings.councilOn ? (settings.council.members.every((m) => viaOf(m) === "free") ? "free" : "puter") : isAuto ? (signedIn ? "puter" : "free") : viaOf(model);
  const out = eco.maxOutput || 800;
  const cost = settings.councilOn
    ? [...settings.council.members, settings.council.judge].reduce<number | null>((sum, m) => {
        const one = viaOf(m) === "free" ? 0 : estimateCost(m, tokens + (m === settings.council.judge ? out * settings.council.members.length : 0), out);
        return sum === null || one === null ? null : sum + one;
      }, 0)
    : via === "free" ? 0 : estimateCost(isAuto ? ROUTE.medium : model, tokens, out);

  // the free model needs no account; a Puter model needs the user signed in
  const reachable = via === "free" || signedIn;
  // everything a message needs is loaded: the account (or free mode), the memory, the chats and this chat's steps
  // (AIW-08: the box is always there; sending without an account asks once how to continue)
  const ready = !busy && !pending && !memLoading && !sessionsLoading && steps !== null && (account.state !== "loading" || (via === "free" && !isAuto));
  const canSend = ready && !reading && (!!input.trim() || files.length > 0);

  const connect = async () => {
    if (account.state === "loading") return;
    try {
      await puter.signIn();
    } catch (e) {
      toast({ text: t(puterKey(e)), error: true });
    }
    await refreshAccount();
  };

  /**
   * Calls the model for a question already saved (askId), with the conversation before it.
   * Everything the call uses (model, settings, system prompt) is passed in, as it was when the question
   * was recorded: the answer is saved with exactly the context it was given.
   */
  /** One model, one call (Puter or the free service), streamed. */
  const callOne = async (model: string, messages: WireMessage[], eco: Economy, onText: (so: string) => void, signal: AbortSignal) =>
    viaOf(model) === "free"
      ? (await import("./freeai")).chatFree(messages, onText, signal) // loaded only when used
      : puter.chat(messages, callOptions(model, eco, !!findModel(model)?.reasoning), onText, signal);

  /**
   * AIW-07: the council — the members answer in parallel (shown as they come), then the judge compares them.
   * A member that fails is shown as such; with fewer than two answers there is nothing to compare.
   */
  const runCouncil = async (messages: ChatMessage[], images: string[], question: string, c: { eco: Economy; system: typeof system; council: Council }, signal: AbortSignal) => {
    const live: Record<string, string> = {};
    const show = (judgeText?: string) => setStreaming(councilText(c.council.members.map((m) => ({ model: m, text: live[m] ?? "…" })), judgeText !== undefined ? { model: c.council.judge, text: judgeText || "…" } : null, lang));
    const asked = withImages(memberMessages(messages, lang), images);
    const results = await Promise.allSettled(c.council.members.map((m) => callOne(m, asked, c.eco, (so) => ((live[m] = so), show()), signal)));
    if (signal.aborted) throw new puter.PuterError("aborted");
    const answers: MemberAnswer[] = c.council.members.map((m, i) => ({ model: m, text: results[i].status === "fulfilled" ? (results[i] as PromiseFulfilledResult<{ text: string }>).value.text : null }));
    const ok = answers.filter((a) => a.text);
    if (ok.length === 0) throw (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason;
    if (ok.length < 2) return { text: councilText(answers, null, lang), cut: false, usage: null };
    try {
      const j = await callOne(c.council.judge, judgeMessages(c.system.text, question, answers, lang), c.eco, (so) => show(so), signal);
      return { text: councilText(answers, { model: c.council.judge, text: j.text }, lang), cut: false, usage: null };
    } catch (e) {
      if (signal.aborted) throw e;
      // the answers are already paid for: they are kept, without a conclusion
      toast({ text: t("chJudgeFailed"), error: true });
      return { text: councilText(answers, null, lang), cut: false, usage: null };
    }
  };

  /**
   * AIW-08: the automatic pilot. Without an account, the free model answers everything. Signed in: the
   * device decides the clear cases; a short plain question goes first to the free model, which answers it
   * or hands it on with a tag; long documents are read by the free model first; the summary of the older
   * part of the chat goes with the question. Every helper that fails is skipped.
   */
  const runPilot = async (sid: string, question: string, earlier: Exchange[], images: string[], c: { eco: Economy; system: typeof system }, signal: AbortSignal, track: { via: Via }) => {
    const free = await import("./freeai");
    const plain = buildMessages(c.system.text, earlier, question, c.eco, lang);
    track.via = "free";
    if (!signedIn) {
      setPilotNote(t("plFree"));
      return { ...(await free.chatFree(plain, setStreaming, signal)), model: FREE_MODEL, level: "simple" as Level, via: "free" as Via };
    }
    let level = decideLocally(question, images.length).level;
    if (level === null) {
      setPilotNote(t("plAsking"));
      const ctrl = new AbortController();
      const stop = () => ctrl.abort();
      signal.addEventListener("abort", stop, { once: true });
      const seen = { tag: "pending" as PaidLevel | null | "pending" };
      const timer = setTimeout(stop, 8000); // no first words in time: the paid model answers instead
      try {
        const r = await free.chatFree(dispatchMessages(plain, lang), (so) => {
          seen.tag = readTag(so);
          if (seen.tag === "pending") return;
          clearTimeout(timer);
          if (seen.tag === null) setStreaming(so);
          else ctrl.abort(); // handed on: the rest of its text is not needed
        }, ctrl.signal);
        const tag = finalTag(r.text);
        if (tag === null) return { ...r, model: FREE_MODEL, level: "simple" as Level, via: "free" as Via };
        level = tag;
      } catch (e) {
        if (signal.aborted) throw e;
        level = seen.tag !== null && seen.tag !== "pending" ? seen.tag : "medium"; // busy, slow or failed: on to Puter
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", stop);
      }
      setStreaming("");
    }
    const lv: PaidLevel = level ?? "medium";
    const model = ROUTE[lv];
    const eco2 = pilotEconomy(lv, c.eco);
    let q = question;
    const ex = extractMessages(question, lang);
    // a helper: only when the free service's turn is free; never makes the question wait
    if (ex && free.freeSlotIn(FREE_GAP_MS) === 0) {
      setPilotNote(t("plReading"));
      try {
        q = withExtract(question, await free.helperFree(ex, 20000, signal), lang);
      } catch (e) {
        if (signal.aborted) throw e; // otherwise the files go as they are
      }
    }
    const summary = readSummary(sid);
    const older = olderTurns(earlier, eco2.history);
    const sys = summary && older.length > 0 && summary.n <= older.length ? withSummary(c.system.text, summary, lang) : c.system.text;
    setPilotNote(fill(t("plRoute"), { model: nameOf(model), level: t(`plLevel_${lv}` as Key) }));
    track.via = "puter";
    try {
      const r = await puter.chat(withImages(buildMessages(sys, earlier, q, eco2, lang), images), callOptions(model, eco2, !!findModel(model)?.reasoning), setStreaming, signal);
      return { ...r, model, level: lv, via: "puter" as Via };
    } catch (e) {
      // credit finished: the pilot goes on with the free model, in the same chat (if allowed; it sees no pictures)
      if (e instanceof puter.PuterError && e.problem === "funds" && settingsRef.current.autoFree && !images.length) {
        toast({ text: t("chAutoFreeOn") });
        setPilotNote(t("plFree"));
        setStreaming("");
        track.via = "free";
        await sleep(free.freeSlotIn(5000), signal); // the free service may have just answered the dispatcher
        return { ...(await free.chatFree(plain, setStreaming, signal)), model: FREE_MODEL, level: lv, via: "free" as Via };
      }
      throw e;
    }
  };

  const callModel = async (sid: string, askId: string, question: string, earlier: Exchange[], c: { model: string; via: Via; reasoning: boolean; eco: Economy; system: typeof system; council?: Council }, images: string[] = []) => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    let fallback = false;
    let spoken: string | null = null;
    setFailure(null);
    setStreaming("");
    const track = { via: c.via }; // which service the pilot was talking to (for the error message)
    try {
      // pictures go only with this call (they are not saved; the saved question names them)
      let used = { via: c.via, eco: c.eco, reasoning: c.reasoning };
      let r: { text: string; cut: boolean; usage: { input: number; output: number } | null };
      if (c.model === AUTO) {
        const p = await runPilot(sid, question, earlier, images, { eco: c.eco, system: c.system }, ctrl.signal, track);
        r = p;
        used = { via: p.via, eco: pilotEconomy(p.level, c.eco), reasoning: !!findModel(p.model)?.reasoning };
        setRoutes((x) => ({ ...x, [askId]: { model: p.model, level: p.level } }));
        if (p.via === "puter") void summarize(sid, [...earlier, { kind: "ask", text: question }, { kind: "reply", text: p.text }], used.eco.history, lang);
      } else {
        const base = buildMessages(c.system.text, earlier, question, c.eco, lang);
        r = c.model === COUNCIL
          ? await runCouncil(base, images, question, { eco: c.eco, system: c.system, council: c.council ?? settingsRef.current.council }, ctrl.signal)
          : await callOne(c.model, withImages(base, images), c.eco, (so) => setStreaming(so), ctrl.signal);
      }
      const cut = r.cut || (used.via === "puter" && used.eco.maxOutput > 0 && !!r.usage && r.usage.output >= used.eco.maxOutput * (used.reasoning ? 2 : 1));
      const parsed = parseReply(r.text, c.system.refs, entries);
      // proposals are never dropped: with proposals off, only a real proposals block is offered for review
      const proposals = c.eco.proposals || c.eco.context === "full" ? parsed.proposals.length > 0 : parsed.found === "block" && parsed.proposals.length > 0;
      if (proposals) {
        const p: Pending = { sid, askId, text: r.text, at: new Date().toISOString() };
        writeJson(PENDING + sid, p);
        if (shown.current === sid) setPending(p);
      } else {
        await sessionStore.applyReply(sid, r.text, []);
      }
      if (r.usage || cut) setUsage((u) => ({ ...u, [askId]: { input: r.usage?.input ?? 0, output: r.usage?.output ?? 0, cut, model: c.model } }));
      if (used.via === "puter") void refreshAccount();
      if ((settingsRef.current.readAloud || handsFreeRef.current) && alive.current && voice.canSpeak()) spoken = r.text;
    } catch (e) {
      // Puter credit finished: the same question continues on the free model, if the user allows it
      if (e instanceof puter.PuterError && e.problem === "funds" && c.via === "puter" && c.model !== COUNCIL && c.model !== AUTO && settingsRef.current.autoFree) fallback = true;
      else {
        const key = e instanceof puter.PuterError ? puterKey(e, c.model === AUTO ? track.via : c.via) : errorKey(e);
        setFailure({ key, sessionId: sid, askId });
        if (e instanceof puter.PuterError && e.problem === "signin") void refreshAccount();
      }
    } finally {
      abort.current = null;
      setStreaming(null);
      setPilotNote(null);
      setBusy(false);
    }
    if (spoken !== null) {
      setSpeaking("auto");
      await voice.speak(stripBlock(spoken), lang);
      setSpeaking((cur) => (cur === "auto" ? null : cur));
      // hands-free: after the answer is read, listen for the next question (with the screen's latest state)
      if (handsFreeRef.current && alive.current && shown.current === sid) listenRef.current(true);
    }
    if (fallback) {
      // only while this chat is still on screen; otherwise the credit error is shown when the user comes back
      // pictures are not saved (and the free model cannot see them): the credit error is shown instead
      if (!alive.current || shown.current !== sid || hadPictures(question)) return setFailure({ key: "chErr_funds", sessionId: sid, askId });
      if (!settingsRef.current.freeConsent) return setConsent({ question, sid, askId });
      await continueFree(question, sid);
    }
  };

  /** Credit finished: the same question, in a new chat on the free model that continues the one holding it. */
  const continueFree = async (question: string, sid: string) => {
    updateSettings((x) => ({ ...x, model: FREE_MODEL, freeConsent: true }));
    toast({ text: t("chAutoFreeOn") });
    await send(question, { model: FREE_MODEL, from: sid });
  };

  const send = async (text = input, auto?: { model: string; from: string }) => {
    const attached = auto ? [] : files;
    const typed = text.trim();
    // the files go with the question (their text is saved with it; photos only by name)
    const question = attached.length ? messageWithFiles(typed || t("chFilesOnly"), attached, lang) : typed;
    const images = imagesOf(attached);
    const st = settingsRef.current;
    const model = auto?.model ?? (st.councilOn ? COUNCIL : st.model);
    const modelInfo = findModel(model);
    const members = model === COUNCIL ? st.council.members : [model];
    // the automatic switch to the free model (credit finished) does not need the Puter account
    if (!question || !(ready || (auto && !pending && alive.current))) return;
    // AIW-08: asked once — the pilot uses the free service; a Puter model needs the account
    if (model === AUTO && !st.pilotConsent) return setAsk({ kind: "pilot", text });
    if (!auto && model !== AUTO && model !== COUNCIL && viaOf(model) === "puter" && !signedIn) return setAsk({ kind: "connect", text });
    if (model === AUTO && account.state === "error") toast({ text: t("plPuterError") }); // the free model answers meanwhile
    if (model === AUTO && images.length && !signedIn) return toast({ text: t("plPictures"), error: true });
    if (images.length && !members.every(seesImages)) return toast({ text: t("chNoVision"), error: true });
    if (model === COUNCIL && !signedIn && members.some((m) => viaOf(m) === "puter")) return toast({ text: t("chErr_signin"), error: true });
    setBusy(true);
    const c = { model, via: model === COUNCIL ? ("puter" as Via) : model === AUTO ? via : viaOf(model), reasoning: !!modelInfo?.reasoning, eco, system, council: st.council };
    try {
      // a chat belongs to one model: another model (or a closed chat) continues in a new chat;
      // after the switch to free, it continues the chat that holds the unanswered question
      let s = auto ? undefined : session;
      if (!s || s.status === "closed" || s.providerName !== model) {
        s = await sessionStore.startChat(project.id, model, auto?.from ?? s?.id ?? null);
        setChosen(s.id);
        history.replaceState(null, "", chatUrl(project.id, s.id));
      }
      const pack = { sha256: await sha256(system.text), chars: system.text.length, refs: system.refs };
      const ask = await sessionStore.ask(s.id, question, pack);
      if (text === input) {
        setInput("");
        if (box.current) box.current.style.height = "";
      }
      if (attached.length) setFiles([]);
      await callModel(s.id, ask.id, question, thread, c, images);
    } catch (e) {
      toast({ text: t(errorKey(e)), error: true });
      setBusy(false);
    }
  };

  const sendRef = useRef(send);
  sendRef.current = send;
  // after a choice in the first-message question: sent with this render's settings and system message
  useEffect(() => {
    if (resend === null) return;
    const text = resend;
    setResend(null);
    void send(text);
  }, [resend]);

  /**
   * The same question again, only if it would go out exactly as recorded (same chat model, same context
   * fingerprint). Otherwise the question goes back into the box, to be sent with the current settings.
   */
  const retry = async () => {
    if (!failure || busy) return;
    const i = thread.findIndex((x) => x.id === failure.askId);
    const ask = thread[i];
    const chat = sessions.find((x) => x.id === failure.sessionId);
    if (!ask || !chat) return setFailure(null);
    const current = settings.councilOn ? COUNCIL : model;
    const same = chat.providerName === current && chat.status === "open" && ask.pack?.sha256 === (await sha256(system.text));
    if (hadPictures(ask.text)) {
      // pictures are not saved: the question goes back into the box, to be sent with the photo attached again
      setFailure(null);
      setInput(questionOnly(ask.text));
      toast({ text: t("chRetryPictures") });
      return;
    }
    if (!same) {
      setFailure(null);
      setInput(ask.text);
      toast({ text: t("chRetryChanged") });
      return;
    }
    setBusy(true);
    await callModel(failure.sessionId, failure.askId, ask.text, thread.slice(0, i), { model: current, via: current === COUNCIL ? "puter" : via, reasoning: !!modelInfo?.reasoning, eco, system, council: settings.council });
  };

  const choose = (id: string | null) => {
    setChosen(id);
    setFailure(null);
    history.replaceState(null, "", chatUrl(project.id, id ?? undefined));
  };

  /** Dictation: the words appear in the box; in the hands-free mode the message is sent at the pause. */
  const startListening = (auto = false) => {
    if (hearing.current) return;
    voice.stopSpeaking();
    const before = auto ? "" : input.trim();
    setListening(true);
    hearing.current = voice.listen(lang, (heard) => setInput(before ? before + " " + heard : heard), (heard, problem) => {
      hearing.current = null;
      setListening(false);
      if (problem && problem !== "noSpeech") {
        toast({ text: t(`chVoiceErr_${problem}` as Key), error: true });
        setHandsFree(false); // no listening happens any more: the mode does not stay shown as on
        return;
      }
      const text = before ? (before + " " + heard).trim() : heard;
      // the latest send (not the one of the render that started listening): current chat, history, files, review state
      if (handsFreeRef.current && text) void sendRef.current(text);
      else if (handsFreeRef.current && !text) setHandsFree(false); // silence (or nothing understood) ends the conversation
    });
  };
  const stopListening = () => hearing.current?.stop();
  const toggleHandsFree = () => {
    if (handsFree) {
      setHandsFree(false);
      stopListening();
      voice.stopSpeaking();
      return;
    }
    setHandsFree(true);
    handsFreeRef.current = true;
    voice.unlockSpeech(); // from this tap: lets an iPhone read the answers aloud later
    startListening(true);
  };
  const listenRef = useRef(startListening);
  listenRef.current = startListening;
  useEffect(() => () => { hearing.current?.stop(); voice.stopSpeaking(); }, []);

  /** Reads the chosen files on the device and adds them to the next message. */
  const addFiles = async (list: File[]) => {
    if (!list.length) return;
    const room = MAX_ATTACHMENTS - files.length;
    if (room <= 0) return toast({ text: t("chTooManyFiles"), error: true });
    setReading(true);
    const added: Attachment[] = [];
    for (const f of list.slice(0, room)) {
      try {
        added.push(await readAttachment(f));
      } catch (e) {
        toast({ text: `${f.name}: ${t(e instanceof FileError ? (`chFileErr_${e.problem}` as Key) : "chFileErr_unreadable")}`, error: true });
      }
    }
    if (list.length > room) toast({ text: t("chTooManyFiles"), error: true });
    setFiles((cur) => [...cur, ...added].slice(0, MAX_ATTACHMENTS));
    setReading(false);
  };

  const usePrompt = (text: string, open?: boolean) => {
    setInput((cur) => (open || !cur.trim() ? text : cur.trimEnd() + "\n\n" + text));
    setTimeout(() => {
      const b = box.current;
      if (b) {
        b.focus();
        b.setSelectionRange(b.value.length, b.value.length);
      }
    }, 0);
  };

  const newChat = () => choose(null);

  const onKey = (e: KeyboardEvent) => {
    // Enter sends on a keyboard; on a phone Enter is a new line (the send button is right there)
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing && matchMedia("(pointer: fine)").matches) {
      e.preventDefault();
      void send();
    }
  };

  const preset = presetOf(eco);
  const prompts = builtInPrompts(lang);

  return (
    <section class="chat" data-chat={project.id}>
      {/* AIW-08: a clean top bar — history, the model, a new chat and the menu with everything else */}
      <div class="chat-top">
        <button type="button" class="icon-button" data-action="history" aria-label={t("chHistory")} title={t("chHistory")} onClick={() => setSheet("history")}>
          <span aria-hidden="true">☰</span>{chats.length > 0 && <span class="count">{chats.length}</span>}
        </button>
        <h1 class="sr-only">{t("chTitle")}</h1>
        {settings.councilOn ? (
          <button type="button" class="model-chip acc" data-action="council" data-model={COUNCIL} onClick={() => setSheet("council")}>
            ⚖ {fill(t("chCouncilOnLabel"), { n: String(settings.council.members.length) })} ▾
          </button>
        ) : (
          <button type="button" class="model-chip" data-action="model" data-model={model} onClick={() => setSheet("model")}>
            <span class="name">{model === AUTO ? `✦ ${t("plAuto")}` : modelInfo?.name ?? model}</span>
            {model !== AUTO && <span class="price">{priceHint(model)}</span>} ▾
          </button>
        )}
        <span class="grow" />
        <button type="button" class="icon-button" data-action="new-chat" aria-label={t("chNew")} title={t("chNew")} onClick={newChat}><span aria-hidden="true">＋</span></button>
        <button type="button" class="icon-button" data-action="menu" aria-label={t("chMenu")} title={t("chMenu")} onClick={() => setSheet("menu")}><span aria-hidden="true">⋯</span></button>
      </div>
      <p class="chat-project muted">{project.name}</p>

      {account.state === "error" && (via === "puter" || isAuto) && (
        <div class="card error-card" role="alert" data-puter-error>
          <p>{t("chLoadError")}</p>
          <button type="button" class="button secondary small-button" onClick={() => void refreshAccount()}>{t("chRetry")}</button>
        </div>
      )}

      {thread.length === 0 && streaming === null && (
        <div class="hero-empty" data-empty-chat>
          <div class="orb"><IconSpark /></div>
          <p class="lead">{fill(t("chEmpty"), { project: project.name })}</p>
          <p class="muted">{fill(t("chEmptyHint"), { n: String(entries.filter((e) => e.confirmation === "confirmed" && !e.archived).length) })}</p>
          {via === "free" && !isAuto && <p class="muted small" data-free-note>{t("chFreeNote")}</p>}
          <div class="starter">
            {prompts.slice(0, 4).map((p) => (
              <button key={p.id} type="button" data-starter={p.id} disabled={!ready} onClick={() => void send(p.text)}>
                <b>{p.icon} {p.label}</b>{p.text.length > 70 ? p.text.slice(0, 68) + "…" : p.text}
              </button>
            ))}
          </div>
        </div>
      )}

      <ol class="thread" data-thread aria-live="polite">
        {thread.map((x) => {
          if (x.kind === "ask") {
            const u = usage[x.id];
            return (
              <li key={x.id} class="msg me" data-msg="ask">
                <AskBubble text={x.text} label={t("chFiles")} />
                <div class="msg-meta">{props.date(x.createdAt)}</div>
                {failure?.askId === x.id && (
                  <div class="msg-tools" data-failure>
                    <span class="form-error" role="alert">{t(failure.key)}</span>
                    <button type="button" class="pill acc" data-action="retry" disabled={busy || !reachable} onClick={() => void retry()}>↻ {t("chRetry")}</button>
                  </div>
                )}
                {u && u.cut && <div class="msg-meta warn-text">{t("chCut")}</div>}
              </li>
            );
          }
          if (x.kind === "reply") {
            const before = thread[thread.indexOf(x) - 1];
            const u = before ? usage[before.id] : undefined;
            return (
              <li key={x.id} class="msg ai" data-msg="reply">
                <div class="bubble"><Markdown text={stripBlock(x.text)} renderCode={(b) => <CodeTools block={b} onRun={setRunHtml} />} /></div>
                <div class="msg-meta">
                  <span>{(() => { const o = sessions.find((s) => s.id === x.sessionId); return o ? assistantName(o) : ""; })()}</span>
                  {before && routes[before.id] && <span data-pilot-route={routes[before.id].level}>→ {nameOf(routes[before.id].model)}</span>}
                  {u && u.input > 0 && <span data-usage>↑{k(u.input)} ↓{k(u.output)} {t("chTokens")}</span>}
                  {x.proposals.length > 0 && <span>{fill(t("chProposalsSaved"), { n: String(x.proposals.length) })}</span>}
                  <button type="button" class="pill small" onClick={async () => toast({ text: t((await copyText(stripBlock(x.text))) ? "chCopied" : "chCopyFailed") })}>{t("chCopy")}</button>
                  {voice.canSpeak() && (
                    <button type="button" class="pill small speak" data-action="speak" onClick={async () => {
                      if (speaking === x.id) return (voice.stopSpeaking(), setSpeaking(null));
                      setSpeaking(x.id);
                      await voice.speak(stripBlock(x.text), lang);
                      setSpeaking((cur) => (cur === x.id ? null : cur));
                    }}>{speaking === x.id ? "■" : "🔊"} {speaking === x.id ? t("chStopReading") : t("chRead")}</button>
                  )}
                </div>
              </li>
            );
          }
          if (x.kind === "note") return <li key={x.id} class="msg me" data-msg="note"><div class="bubble">{x.text}</div></li>;
          return null;
        })}
        {pending && pending.sid === session?.id && (
          <li class="msg ai" data-msg="pending">
            <div class="bubble"><Markdown text={stripBlock(pending.text)} renderCode={(b) => <CodeTools block={b} onRun={setRunHtml} />} /></div>
            <div class="proposal-card" data-pending>
              <p>{fill(t("chPendingTitle"), { n: String(countProposals(pending.text, system.refs, entries)) })}</p>
              <ul>{parseReply(pending.text, system.refs, entries).proposals.slice(0, 5).map((p) => <li key={p.key}>{p.title}</li>)}</ul>
              <button type="button" class="button" data-action="review" disabled={memLoading || steps === null} onClick={() => setSheet("review")}>{t("chReview")}</button>
            </div>
          </li>
        )}
        {streaming !== null && (
          <li class="msg ai" data-msg="streaming">
            {pilotNote && <div class="msg-meta pilot-note" data-pilot-note>✦ {pilotNote}</div>}
            {streaming ? <div class="bubble typing"><Markdown text={stripBlock(streaming)} /></div> : <div class="bubble thinking" aria-label={t("chThinking")}><i /><i /><i /></div>}
          </li>
        )}
      </ol>

      {/* AIW-08: the message box is always there; what is running now (voice) shows just above it */}
      <div class="composer">
        {(handsFree || speaking === "auto") && (
          <div class="live-pills">
            {handsFree && <button type="button" class="pill acc" data-action="hands-free" aria-pressed={true} onClick={toggleHandsFree}>🎙 {t("chHandsFreeOn")}</button>}
            {speaking === "auto" && <button type="button" class="pill acc" data-action="stop-reading" onClick={() => (voice.stopSpeaking(), setSpeaking(null))}>■ {t("chStopReading")}</button>}
          </div>
        )}
        {files.length > 0 && (
          <ul class="files" aria-label={t("chFiles")}>
            {files.map((f) => (
              <li key={f.id} class="file-chip" data-file={f.name}>
                {f.kind === "image" ? <img src={f.images[0]} alt="" /> : <span class="file-ico">{f.kind === "pdf" ? "PDF" : f.kind === "docx" ? "DOC" : "TXT"}</span>}
                <span class="file-name">{f.name}</span>
                <button type="button" class="file-x" aria-label={`${t("chRemoveFile")} ${f.name}`} onClick={() => setFiles(files.filter((x) => x.id !== f.id))}>✕</button>
              </li>
            ))}
          </ul>
        )}
        <div class="composer-row">
          <label class={"attach" + (reading ? " busy" : "")} aria-label={t("chAttach")} title={t("chAttach")} data-action="attach">
            <IconClip />
            <input type="file" name="attach" multiple accept={ACCEPT} class="sr-only" disabled={reading || busy || !!pending}
              onChange={(e) => { const i = e.target as HTMLInputElement; void addFiles([...(i.files ?? [])]); i.value = ""; }} />
          </label>
          {voice.canListen() && (
            <button type="button" class={"mic" + (listening ? " on" : "")} data-action="mic" aria-pressed={listening} aria-label={listening ? t("chMicStop") : t("chMic")}
              disabled={busy || !!pending} onClick={() => (listening ? stopListening() : startListening())}><IconMic /></button>
          )}
          <label class="sr-only" for="chat-input">{t("chMessage")}</label>
          <textarea id="chat-input" ref={box} name="message" rows={1} value={input} placeholder={pending ? t("chReviewFirst") : listening ? t("chListening") : t("chPlaceholder")}
            maxLength={20000} onInput={(e) => {
              const el = e.target as HTMLTextAreaElement;
              setInput(el.value);
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 320) + "px";
            }} onKeyDown={onKey}
            onPaste={(e) => {
              // a picture pasted into the box is attached
              const pics = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
              if (pics.length) {
                e.preventDefault();
                void addFiles(pics);
              }
            }} />
          {busy && abort.current ? (
            <button type="button" class="send stop" data-action="stop" aria-label={t("chStop")} onClick={() => abort.current?.abort()}><IconStop /></button>
          ) : (
            <button type="button" class="send" data-action="send" aria-label={t("chSend")} disabled={!canSend} onClick={() => void send()}><IconSend /></button>
          )}
        </div>
      </div>

      {sheet === "model" && <ModelSheet value={model} autoFree={settings.autoFree} onAutoFree={(v) => updateSettings((x) => ({ ...x, autoFree: v }))}
        readAloud={settings.readAloud} onReadAloud={voice.canSpeak() ? (v) => (v && voice.unlockSpeech(), updateSettings((x) => ({ ...x, readAloud: v }))) : undefined}
        onClose={() => setSheet(null)} onChoose={(m) => (updateSettings((x) => ({ ...x, model: m, freeConsent: x.freeConsent || viaOf(m) === "free" })), setSheet(null))} />}
      {sheet === "council" && (
        <CouncilSheet value={settings.council} on={settings.councilOn} onClose={() => setSheet(null)}
          onChange={(on, council) => updateSettings((x) => ({ ...x, councilOn: on, council, freeConsent: x.freeConsent || (on && council.members.some((m) => viaOf(m) === "free")) }))} />
      )}
      {runHtml !== null && (
        <PreviewDialog html={runHtml} onClose={() => setRunHtml(null)} onFix={(errs) => {
          setRunHtml(null);
          usePrompt(fill(t("cdFixPrompt"), { errors: errs.slice(0, 5).map((e) => "- " + e).join("\n") }), true);
        }} />
      )}
      {consent && (
        <Dialog title={t("chConsentTitle")} onClose={() => (setFailure({ key: "chErr_funds", sessionId: consent.sid, askId: consent.askId }), setConsent(null))} id="free-consent">
          <p>{t("chConsentText")}</p>
          <div class="sheet-actions">
            <button type="button" class="button secondary" onClick={() => (setFailure({ key: "chErr_funds", sessionId: consent.sid, askId: consent.askId }), setConsent(null))}>{t("chConsentNo")}</button>
            <button type="button" class="button" data-action="consent-free" onClick={() => { const c = consent; setConsent(null); void continueFree(c.question, c.sid); }}>{t("chConsentYes")}</button>
          </div>
        </Dialog>
      )}
      {sheet === "eco" && (
        <EconomySheet value={eco} onClose={() => setSheet(null)} onChange={(e) => updateSettings((x) => ({ ...x, economy: e }))}
          estimate={
            <div class="estimate card" data-estimate={tokens}>
              <span>{t("chNextMessage")}: ≈ {k(tokens)} {t("chTokensIn")}</span>
              {saved > 0 && <strong data-saved={saved}>−{saved}% {t("chVsFull")}</strong>}
              <span>{via === "free" ? t("chFreeCost") : cost !== null ? `~${money(cost, lang)}` : ""}</span>
              <span>{t(`chCtx_${eco.context}` as Key)} · {system.included} {t("chItems")}</span>
            </div>
          } />
      )}
      {sheet === "prompts" && <PromptsSheet ready={[...prompts.map((p) => ({ id: p.id, icon: p.icon, label: p.label, text: p.text, open: !!p.open })), ...myPrompts.map((p) => ({ id: p.id, icon: "★", label: p.label, text: p.text, open: false }))]}
        onPick={(p) => (usePrompt(p.text, p.open), setSheet(null))} list={myPrompts} draft={input} onChange={setMyPrompts} onUse={(p) => (usePrompt(p.text), setSheet(null))} onClose={() => setSheet(null)} />}
      {sheet === "history" && (
        <Dialog title={t("chHistory")} onClose={() => setSheet(null)} id="chat-history" dismissable>
          {chats.length === 0 ? <p class="muted">{t("chHistoryEmpty")}</p> : (
            <div class="menu">
              {chats.map((s) => (
                <a key={s.id} class="menu-item" href={chatUrl(project.id, s.id)} data-chat-item={s.id} onClick={(e) => { e.preventDefault(); choose(s.id); setSheet(null); }}>
                  {s.task ? `${s.task} · ` : ""}{assistantName(s)} · {props.date(s.updatedAt)}{s.id === session?.id ? " ✓" : ""}
                </a>
              ))}
            </div>
          )}
          <div class="sheet-actions single"><button type="button" class="button secondary" onClick={() => setSheet(null)}>{t("close")}</button></div>
        </Dialog>
      )}
      {sheet === "menu" && (
        <Dialog title={t("chMenu")} onClose={() => setSheet(null)} id="chat-menu" dismissable>
          <label class="field"><span>{t("chProject")}</span>
            <select name="project" value={project.id} onChange={(e) => { setSheet(null); location.hash = chatUrl((e.target as HTMLSelectElement).value); }}>
              {props.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <div class="menu">
            <button type="button" class="menu-item" data-action="economy" data-preset={preset ?? "custom"} onClick={() => setSheet("eco")}>
              ⚡ {t("chEconomy")}: {preset ? t(`chPreset_${preset}` as Key) : t("chPresetCustom")}{saved > 0 ? ` · −${saved}%` : ""}
            </button>
            <button type="button" class="menu-item" data-action="prompts" onClick={() => setSheet("prompts")}>✎ {t("chPrompts")}</button>
            <button type="button" class={"menu-item" + (settings.councilOn ? " acc" : "")} data-action="council-sheet" onClick={() => setSheet("council")}>⚖ {t("chCouncil")}{settings.councilOn ? " ✓" : ""}</button>
            {voice.canListen() && (
              <button type="button" class="menu-item" data-action="hands-free" aria-pressed={handsFree} disabled={!reachable} onClick={() => { setSheet(null); toggleHandsFree(); }}>
                🎙 {handsFree ? t("chHandsFreeOn") : t("chHandsFree")}
              </button>
            )}
            <button type="button" class="menu-item" data-action="account" data-account={account.state} disabled={account.state === "loading"} onClick={() => (signedIn ? setSheet("account") : (setSheet(null), void connect()))}>
              <span class={"dot" + (signedIn ? " on" : "")} />
              {signedIn ? (account.name ?? t("chPuterOn")) : account.state === "loading" ? t("loading") : t("chPuterOff")}
              {signedIn && account.credit ? ` · ${account.credit.unit === "usd" ? money(account.credit.value, lang) : k(Math.round(account.credit.value)) + " " + t("chCredits")}` : ""}
            </button>
          </div>
          <div class="sheet-actions single"><button type="button" class="button secondary" data-action="close-sheet" onClick={() => setSheet(null)}>{t("close")}</button></div>
        </Dialog>
      )}
      {ask?.kind === "pilot" && (
        <Dialog title={t("plConsentTitle")} onClose={() => setAsk(null)} id="pilot-consent">
          <p>{t("plConsentText")}</p>
          <div class="sheet-actions">
            <button type="button" class="button secondary" data-action="pilot-no" onClick={() => {
              updateSettings((x) => ({ ...x, model: DEFAULT_MODEL }));
              setAsk(null);
              setResend(ask.text);
            }}>{t("plConsentNo")}</button>
            <button type="button" class="button" data-action="pilot-yes" onClick={() => {
              updateSettings((x) => ({ ...x, pilotConsent: true, freeConsent: true }));
              setAsk(null);
              setResend(ask.text);
            }}>{t("plConsentYes")}</button>
          </div>
        </Dialog>
      )}
      {ask?.kind === "connect" && (
        <Dialog title={t("chConnectTitle")} onClose={() => setAsk(null)} id="chat-connect">
          <div data-connect>
            <p>{t("chConnectText")}</p>
            <div class="sheet-actions">
              <button type="button" class="button secondary" data-action="use-free" onClick={() => {
                updateSettings((x) => ({ ...x, model: FREE_MODEL, freeConsent: true }));
                setAsk(null);
                setResend(ask.text);
              }}>{t("chUseFree")}</button>
              <button type="button" class="button" data-action="connect" onClick={() => { setAsk(null); void connect(); }}>{t("chConnect")}</button>
            </div>
          </div>
        </Dialog>
      )}
      {sheet === "account" && (
        <Dialog title={t("chAccount")} onClose={() => setSheet(null)} id="chat-account" dismissable>
          <p>{fill(t("chAccountText"), { name: account.name ?? "Puter" })}</p>
          {account.credit && <p class="muted">{t("chCreditLeft")}: {account.credit.unit === "usd" ? money(account.credit.value, lang) : `${Math.round(account.credit.value)} ${t("chCredits")}`}</p>}
          <p class="muted small-left">{t("chAccountPay")}</p>
          <div class="sheet-actions single">
            <button type="button" class="button secondary" data-action="sign-out" onClick={async () => { await puter.signOut(); await refreshAccount(); setSheet(null); }}>{t("chSignOut")}</button>
          </div>
          <div class="sheet-actions single"><button type="button" class="button" data-action="close-sheet" onClick={() => setSheet(null)}>{t("close")}</button></div>
        </Dialog>
      )}
      {sheet === "review" && pending && session && pending.sid === session.id && lastStep?.id === pending.askId && (
        <ReplyDialog session={session} entries={entries} steps={sessionSteps} initialText={pending.text}
          onSaved={() => { writeJson(PENDING + pending.sid, null); setPending(null); }} onClose={() => setSheet(null)} />
      )}
    </section>
  );
}

/** The saved question named a photo or scanned pages (pictures are not saved). */
const hadPictures = (text: string): boolean => /\[(poză atașată|attached photo): |pagini scanate trimise ca imagini|scanned pages sent as images/.test(text);
/** The typed question, without the attached files' part. */
function questionOnly(text: string): string {
  const i = text.search(FILES_START);
  return i < 0 ? text : text.slice(0, i);
}

/** A question with files: the question shows; the files' text is folded (it can be long). */
const FILES_START = /\n\n(?=Fișier atașat: |Attached file: |\[poză atașată: |\[attached photo: |\[Fișier atașat: |\[Attached file: )/;
function AskBubble(props: { text: string; label: string }): JSX.Element {
  const i = props.text.search(FILES_START);
  if (i < 0) return <div class="bubble">{props.text}</div>;
  const rest = props.text.slice(i + 2);
  const names = [...rest.matchAll(/^(?:\[)?(?:Fișier atașat|Attached file|poză atașată|attached photo): ([^\n(\]]+)/gm)].map((m) => m[1].trim());
  return (
    <div class="bubble">
      {props.text.slice(0, i)}
      <details class="ask-files"><summary>📎 {names.join(", ") || props.label}</summary><pre>{rest}</pre></details>
    </div>
  );
}

/** The proposals block is reviewed separately: the bubble shows the answer without it. */
function stripBlock(text: string): string {
  return text.replace(/^[ \t]*(```|~~~)[ \t]*(aiw-propuneri|aiw-proposals)[ \t]*\n[\s\S]*?(^[ \t]*\1[ \t]*$|(?![\s\S]))/gim, "").trim();
}

function countProposals(text: string, refs: Record<string, string>, entries: Parameters<typeof parseReply>[2]): number {
  return parseReply(text, refs, entries).proposals.length;
}

function puterKey(e: unknown, via: Via = "puter"): Key {
  const p = e instanceof puter.PuterError ? e.problem : puter.classify(e).problem;
  if (via === "free" && (p === "busy" || p === "network" || p === "unknown")) return `chErrFree_${p}` as Key;
  return `chErr_${p}` as Key;
}

// ---------- sheets ----------

function ModelSheet(props: { value: string; autoFree: boolean; onAutoFree: (v: boolean) => void; readAloud: boolean; onReadAloud?: (v: boolean) => void; onChoose: (m: string) => void; onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  const [custom, setCustom] = useState(findModel(props.value) || props.value === AUTO ? "" : props.value);
  const valid = isModelId(custom.trim());
  return (
    <Dialog title={t("chModelTitle")} onClose={props.onClose} id="model-sheet" dismissable>
      <p class="muted small-left">{t("chModelHint")}</p>
      <ul class="model-list" role="radiogroup" aria-label={t("chModel")}>
        {/* AIW-08: the automatic pilot chooses the model for each question */}
        <li>
          <button type="button" role="radio" aria-checked={props.value === AUTO} data-model-id={AUTO} onClick={() => props.onChoose(AUTO)}>
            <span class="m-name">✦ {t("plAuto")}<span class="m-maker">{t("plAutoHint")}</span></span>
            <span class="tier">{t("plAutoTier")}</span>
          </button>
        </li>
        {MODELS.map((m) => (
          <li key={m.id}>
            <button type="button" role="radio" aria-checked={props.value === m.id} data-model-id={m.id} onClick={() => props.onChoose(m.id)}>
              <span class="m-name">{m.name}<span class="m-maker">{m.maker}</span></span>
              <span class="tier">{t(`chTier_${m.tier}` as Key)}</span>
              <span class="price">{priceHint(m.id)}</span>
            </button>
          </li>
        ))}
      </ul>
      <label class="check"><input type="checkbox" name="auto-free" checked={props.autoFree} onChange={(e) => props.onAutoFree((e.target as HTMLInputElement).checked)} />
        <span>{t("chAutoFree")}</span></label>
      {props.onReadAloud && (
        <label class="check"><input type="checkbox" name="read-aloud" checked={props.readAloud} onChange={(e) => props.onReadAloud!((e.target as HTMLInputElement).checked)} />
          <span>{t("chReadAloud")}</span></label>
      )}
      <form onSubmit={(e) => { e.preventDefault(); if (valid) props.onChoose(custom.trim()); }}>
        <label class="field"><span>{t("chModelCustom")}</span>
          <input name="custom-model" value={custom} placeholder="ex. gpt-5-mini" autoCapitalize="off" autoCorrect="off" spellcheck={false}
            onInput={(e) => setCustom((e.target as HTMLInputElement).value)} /></label>
        {custom && !valid && <p class="form-error">{t("chModelInvalid")}</p>}
        <div class="sheet-actions">
          <button type="button" class="button secondary" onClick={props.onClose}>{t("close")}</button>
          <button type="submit" class="button" disabled={!valid}>{t("chModelUse")}</button>
        </div>
      </form>
    </Dialog>
  );
}

function CouncilSheet(props: { value: Council; on: boolean; onChange: (on: boolean, c: Council) => void; onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  const [members, setMembers] = useState<string[]>(props.value.members);
  const [judge, setJudge] = useState(props.value.judge);
  const valid = members.length >= COUNCIL_MIN && members.length <= COUNCIL_MAX;
  const j = members.includes(judge) ? judge : members[0];
  const toggle = (id: string) => setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : m.length >= COUNCIL_MAX ? m : [...m, id]));
  return (
    <Dialog title={t("chCouncilTitle")} onClose={props.onClose} id="council-sheet" dismissable>
      <p class="muted small-left">{t("chCouncilHint")}</p>
      <ul class="model-list">
        {MODELS.map((m) => (
          <li key={m.id}>
            <button type="button" role="checkbox" aria-checked={members.includes(m.id)} data-member={m.id} onClick={() => toggle(m.id)}
              disabled={!members.includes(m.id) && members.length >= COUNCIL_MAX}>
              <span class="m-name">{members.includes(m.id) ? "☑ " : "☐ "}{m.name}<span class="m-maker">{m.maker}</span></span>
              <span class="tier">{t(`chTier_${m.tier}` as Key)}</span>
            </button>
          </li>
        ))}
      </ul>
      {members.length > 0 && (
        <label class="field"><span>{t("chCouncilJudge")}</span>
          <select name="judge" value={j} onChange={(e) => setJudge((e.target as HTMLSelectElement).value)}>
            {members.map((m) => <option key={m} value={m}>{nameOf(m)}</option>)}
          </select>
        </label>
      )}
      {!valid && <p class="form-error">{t("chCouncilPick")}</p>}
      <div class="sheet-actions">
        <button type="button" class="button secondary" data-action="council-off" onClick={() => (props.onChange(false, valid ? { members, judge: j } : props.value), props.onClose())}>{t("chCouncilOff")}</button>
        <button type="button" class="button" data-action="council-on" disabled={!valid} onClick={() => (props.onChange(true, { members, judge: j }), props.onClose())}>{t("chCouncilUse")}</button>
      </div>
    </Dialog>
  );
}

function EconomySheet(props: { value: Economy; onChange: (e: Economy) => void; onClose: () => void; estimate: JSX.Element }): JSX.Element {
  const { t } = useI18n();
  const e = props.value;
  const set = (c: Partial<Economy>) => props.onChange({ ...e, ...c });
  const preset = presetOf(e);
  return (
    <Dialog title={t("chEcoTitle")} onClose={props.onClose} id="eco-sheet" dismissable>
      <p class="muted small-left">{t("chEcoHint")}</p>
      {props.estimate}
      <div class="eco-presets" role="radiogroup" aria-label={t("chEconomy")}>
        {(["max", "balanced", "quality"] as PresetId[]).map((id) => (
          <button key={id} type="button" role="radio" aria-checked={preset === id} class={"preset" + (preset === id ? " on" : "")} data-preset-choice={id} onClick={() => props.onChange(PRESETS[id])}>
            <strong>{t(`chPreset_${id}` as Key)}</strong><span>{t(`chPresetHint_${id}` as Key)}</span>
          </button>
        ))}
      </div>
      <div class="eco-grid">
        <div><h2>{t("chCtxTitle")}</h2>
          <Segmented name="ctx" label={t("chCtxTitle")} value={e.context} onChange={(v: ContextMode) => set({ context: v })}
            options={(["full", "compact", "important", "none"] as ContextMode[]).map((v) => ({ value: v, label: t(`chCtx_${v}` as Key) }))} />
          <p class="muted small-left">{t(`chCtxHint_${e.context}` as Key)}</p></div>
        <div><h2>{t("chAnswerTitle")}</h2>
          <Segmented name="answer" label={t("chAnswerTitle")} value={e.answer} onChange={(v: AnswerStyle) => set({ answer: v })}
            options={(["normal", "short", "telegraphic"] as AnswerStyle[]).map((v) => ({ value: v, label: t(`chAns_${v}` as Key) }))} /></div>
        <div><h2>{t("chHistoryWindow")}</h2>
          <Segmented name="history" label={t("chHistoryWindow")} value={String(e.history)} onChange={(v) => set({ history: Number(v) })}
            options={HISTORY_CHOICES.map((n) => ({ value: String(n), label: String(n) }))} />
          <p class="muted small-left">{t("chHistoryHint")}</p></div>
        <div><h2>{t("chMaxOut")}</h2>
          <Segmented name="maxout" label={t("chMaxOut")} value={String(e.maxOutput)} onChange={(v) => set({ maxOutput: Number(v) })}
            options={OUTPUT_CHOICES.map((n) => ({ value: String(n), label: n === 0 ? t("chNoLimit") : String(n) }))} /></div>
        <label class="check"><input type="checkbox" name="proposals" checked={e.proposals || e.context === "full"} disabled={e.context === "full"}
          onChange={(ev) => set({ proposals: (ev.target as HTMLInputElement).checked })} />
          <span>{t("chAskProposals")}</span></label>
        {e.context === "full" && <p class="muted small-left">{t("chProposalsFull")}</p>}
      </div>
      <div class="sheet-actions">
        <button type="button" class="button secondary" onClick={() => props.onChange(DEFAULT_ECONOMY)}>{t("chEcoReset")}</button>
        <button type="button" class="button" onClick={props.onClose}>{t("chDone")}</button>
      </div>
    </Dialog>
  );
}

function PromptsSheet(props: { ready: { id: string; icon: string; label: string; text: string; open: boolean }[]; onPick: (p: { text: string; open: boolean }) => void; list: MyPrompt[]; draft: string; onChange: (l: MyPrompt[]) => void; onUse: (p: MyPrompt) => void; onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  const [label, setLabel] = useState("");
  const [text, setText] = useState(props.draft.trim().slice(0, MY_PROMPT_TEXT_MAX));
  const add = (e: Event) => {
    e.preventDefault();
    const next = cleanMyPrompts([...props.list, { id: `U-${Date.now()}`, label, text }]);
    if (next.length === props.list.length) return toast({ text: t(props.list.length >= MY_PROMPTS_MAX ? "chPromptsFull" : "chPromptInvalid"), error: true });
    props.onChange(next);
    setLabel("");
    setText("");
    toast({ text: t("chPromptSaved") });
  };
  return (
    <Dialog title={t("chPromptsTitle")} onClose={props.onClose} id="prompts-sheet">
      {/* AIW-08: the ready-made prompts and the user's own, moved here from above the message box */}
      <div class="chips wrap" role="toolbar" aria-label={t("chPrompts")}>
        {props.ready.map((p) => (
          <button key={p.id} type="button" class="chip" data-prompt={p.id} onClick={() => props.onPick(p)}><b>{p.icon}</b>{p.label}</button>
        ))}
      </div>
      {props.list.length > 0 ? (
        <ul class="list">
          {props.list.map((p) => (
            <li key={p.id} class="row" data-my-prompt={p.label}>
              <button type="button" class="row-main as-button" onClick={() => props.onUse(p)}>
                <span class="row-name">★ {p.label}</span><span class="row-desc">{p.text}</span>
              </button>
              <button type="button" class="icon-button" aria-label={`${t("chDelete")} ${p.label}`} onClick={() => props.onChange(props.list.filter((x) => x.id !== p.id))}>✕</button>
            </li>
          ))}
        </ul>
      ) : <p class="muted">{t("chPromptsEmpty")}</p>}
      <form onSubmit={add}>
        <h2>{t("chPromptAdd")}</h2>
        <label class="field"><span>{t("chPromptLabel")}</span>
          <input name="prompt-label" value={label} maxLength={MY_PROMPT_LABEL_MAX} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} /></label>
        <label class="field"><span>{t("chPromptText")}</span>
          <textarea name="prompt-text" rows={4} value={text} maxLength={MY_PROMPT_TEXT_MAX} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} /></label>
        <div class="sheet-actions">
          <button type="button" class="button secondary" onClick={props.onClose}>{t("close")}</button>
          <button type="submit" class="button" disabled={!label.trim() || !text.trim()}>{t("save")}</button>
        </div>
      </form>
    </Dialog>
  );
}
