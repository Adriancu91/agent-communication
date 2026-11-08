// AIW-06: the chat inside the app (#/chat[/<project>[/<chat>]]).
// The user signs in once to their own Puter account; messages then go to the chosen model and the answer
// comes back here, streamed. Every question and answer is saved in the project's history (journal).
// The official memory still changes ONLY when the user accepts a proposal (the same review as before).
import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { sha256, type Exchange, type Project, type Session } from "../core";
import { parseReply } from "../continuity";
import {
  buildMessages, builtInPrompts, callOptions, cleanEconomy, cleanMyPrompts, DEFAULT_ECONOMY, DEFAULT_MODEL, estimateCost,
  tokensForChars, findModel, HISTORY_CHOICES, isModelId, messagesChars, MODELS, MY_PROMPT_LABEL_MAX, MY_PROMPT_TEXT_MAX, MY_PROMPTS_MAX,
  OUTPUT_CHOICES, PRESETS, presetOf, priceHint, systemPrompt, type AnswerStyle, type ContextMode, type Economy, type MyPrompt, type PresetId,
} from "../chat";
import { ReplyDialog, Segmented, copyText, useSessions } from "./continuity";
import { errorKey, lastProject, rememberProject, sessionStore, useMemory, useProjects } from "./data";
import { fill, useDate, useI18n, type Key } from "./i18n";
import { IconSend, IconSpark, IconStop } from "./icons";
import * as puter from "./puter";
import { Dialog, toast } from "./widgets";

export const chatUrl = (projectId?: string, sessionId?: string) =>
  "#/chat" + (projectId ? `/${encodeURIComponent(projectId)}` + (sessionId ? `/${encodeURIComponent(sessionId)}` : "") : "");

// ---------- settings kept on this device (not project data) ----------

const SETTINGS = "aiw.chat";
const MY_PROMPTS = "aiw.chat.prompts";
const PENDING = "aiw.chat.pending.";

interface ChatSettings { model: string; economy: Economy }

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
  return { model: isModelId(r.model) ? r.model : DEFAULT_MODEL, economy: cleanEconomy(r.economy) };
}

/** An answer with memory proposals waits here (on this device) until the user reviews it. */
interface Pending { sid: string; askId: string; text: string; at: string }
const readPending = (sid: string): Pending | null => {
  const r = readJson(PENDING + sid) as Pending | null;
  return r && r.sid === sid && typeof r.askId === "string" && typeof r.text === "string" && typeof r.at === "string" ? r : null;
};

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
  const setSettings = (s: ChatSettings) => {
    setSettingsState(s);
    writeJson(SETTINGS, s);
  };
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
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ key: Key; sessionId: string; askId: string } | null>(null);
  const [usage, setUsage] = useState<Record<string, { input: number; output: number; cut: boolean; model: string }>>({});
  const [pending, setPending] = useState<Pending | null>(null);
  const [sheet, setSheet] = useState<"model" | "eco" | "prompts" | "history" | "account" | "review" | null>(null);
  const abort = useRef<AbortController | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // the chat on screen, for answers that arrive after the user moved to another chat
  const shown = useRef<string | undefined>(undefined);
  shown.current = session?.id;
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
  const formatDate = (iso: string) => props.date(iso);
  const system = useMemo(
    () => systemPrompt(project, entries, links, { lang, economy: eco, assistant: modelInfo?.name ?? model, maxChars: 24000, date: props.date(new Date().toISOString()), formatDate }),
    [project, entries, links, lang, eco, model],
  );
  const thread = steps ?? [];
  const preview = useMemo(() => buildMessages(system.text, thread, input || " ", eco, lang), [system.text, thread, input, eco, lang]);
  const tokens = tokensForChars(messagesChars(preview));
  // the same question with every saving switched off, for the "you save ~N%" line
  const fullTokens = useMemo(() => {
    const full = systemPrompt(project, entries, links, { lang, economy: PRESETS.quality, assistant: modelInfo?.name ?? model, maxChars: 24000, date: "", formatDate });
    return tokensForChars(messagesChars(buildMessages(full.text, thread, input || " ", PRESETS.quality, lang)));
  }, [project, entries, links, lang, thread, input, model]);
  const saved = fullTokens > 0 ? Math.max(0, Math.round((1 - tokens / fullTokens) * 100)) : 0;
  const cost = estimateCost(model, tokens, eco.maxOutput || 800);

  const signedIn = account.state === "in";
  // everything a message needs is loaded: the account, the memory, the chats and this chat's steps
  const ready = signedIn && !busy && !pending && !memLoading && !sessionsLoading && steps !== null;
  const canSend = ready && !!input.trim();

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
  const callModel = async (sid: string, askId: string, question: string, earlier: Exchange[], c: { model: string; reasoning: boolean; eco: Economy; system: typeof system }) => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    setFailure(null);
    setStreaming("");
    try {
      const messages = buildMessages(c.system.text, earlier, question, c.eco, lang);
      const r = await puter.chat(messages, callOptions(c.model, c.eco, c.reasoning), (so) => setStreaming(so), ctrl.signal);
      const cut = r.cut || (c.eco.maxOutput > 0 && !!r.usage && r.usage.output >= c.eco.maxOutput * (c.reasoning ? 2 : 1));
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
      void refreshAccount();
    } catch (e) {
      const key = e instanceof puter.PuterError ? puterKey(e) : errorKey(e);
      setFailure({ key, sessionId: sid, askId });
      if (e instanceof puter.PuterError && e.problem === "signin") void refreshAccount();
    } finally {
      abort.current = null;
      setStreaming(null);
      setBusy(false);
    }
  };

  const send = async (text = input) => {
    const question = text.trim();
    if (!question || !ready) return;
    setBusy(true);
    const c = { model, reasoning: !!modelInfo?.reasoning, eco, system };
    try {
      // a chat belongs to one model: another model (or a closed chat) continues in a new chat
      let s = session;
      if (!s || s.status === "closed" || s.providerName !== model) {
        s = await sessionStore.startChat(project.id, model, s?.id ?? null);
        setChosen(s.id);
        history.replaceState(null, "", chatUrl(project.id, s.id));
      }
      const pack = { sha256: await sha256(system.text), chars: system.text.length, refs: system.refs };
      const ask = await sessionStore.ask(s.id, question, pack);
      if (text === input) {
        setInput("");
        if (box.current) box.current.style.height = "";
      }
      await callModel(s.id, ask.id, question, thread, c);
    } catch (e) {
      toast({ text: t(errorKey(e)), error: true });
      setBusy(false);
    }
  };

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
    const same = chat.providerName === model && chat.status === "open" && ask.pack?.sha256 === (await sha256(system.text));
    if (!same) {
      setFailure(null);
      setInput(ask.text);
      toast({ text: t("chRetryChanged") });
      return;
    }
    setBusy(true);
    await callModel(failure.sessionId, failure.askId, ask.text, thread.slice(0, i), { model, reasoning: !!modelInfo?.reasoning, eco, system });
  };

  const choose = (id: string | null) => {
    setChosen(id);
    setFailure(null);
    history.replaceState(null, "", chatUrl(project.id, id ?? undefined));
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
      <div class="chat-head">
        <h1 class="large-title">{t("chTitle")}</h1>
        <button type="button" class="pill" data-action="history" onClick={() => setSheet("history")}>{t("chHistory")}{chats.length ? ` · ${chats.length}` : ""}</button>
        <button type="button" class="pill acc" data-action="new-chat" onClick={newChat}>＋ {t("chNew")}</button>
      </div>

      <div class="chat-bar">
        <label class="field"><span>{t("chProject")}</span>
          <select name="project" value={project.id} onChange={(e) => (location.hash = chatUrl((e.target as HTMLSelectElement).value))}>
            {props.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <div class="field"><span>{t("chModel")}</span>
          <button type="button" class="pill" data-action="model" data-model={model} onClick={() => setSheet("model")}>
            {modelInfo?.name ?? model} <span class="price">{priceHint(model)}</span> ▾
          </button>
        </div>
      </div>

      <div class="chat-pills">
        <button type="button" class="pill eco" data-action="economy" data-preset={preset ?? "custom"} onClick={() => setSheet("eco")}>
          ⚡ {t("chEconomy")}: {preset ? t(`chPreset_${preset}` as Key) : t("chPresetCustom")}
        </button>
        <button type="button" class="pill" data-action="account" data-account={account.state} disabled={account.state === "loading"} onClick={() => (signedIn ? setSheet("account") : void connect())}>
          <span class={"dot" + (signedIn ? " on" : "")} />
          {signedIn ? (account.name ?? t("chPuterOn")) : account.state === "loading" ? t("loading") : t("chPuterOff")}
          {signedIn && account.credit ? ` · ${account.credit.unit === "usd" ? money(account.credit.value, lang) : k(Math.round(account.credit.value)) + " " + t("chCredits")}` : ""}
        </button>
        <button type="button" class="pill" data-action="prompts" onClick={() => setSheet("prompts")}>✎ {t("chPrompts")}</button>
      </div>

      {account.state === "out" && (
        <div class="card connect-card" data-connect>
          <h2>{t("chConnectTitle")}</h2>
          <p>{t("chConnectText")}</p>
          <button type="button" class="button" data-action="connect" onClick={() => void connect()}>{t("chConnect")}</button>
        </div>
      )}
      {account.state === "error" && (
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
                <div class="bubble">{x.text}</div>
                <div class="msg-meta">{props.date(x.createdAt)}</div>
                {failure?.askId === x.id && (
                  <div class="msg-tools" data-failure>
                    <span class="form-error" role="alert">{t(failure.key)}</span>
                    <button type="button" class="pill acc" data-action="retry" disabled={busy || !signedIn} onClick={() => void retry()}>↻ {t("chRetry")}</button>
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
                <div class="bubble">{stripBlock(x.text)}</div>
                <div class="msg-meta">
                  <span>{sessions.find((s) => s.id === x.sessionId)?.providerName}</span>
                  {u && u.input > 0 && <span data-usage>↑{k(u.input)} ↓{k(u.output)} {t("chTokens")}</span>}
                  {x.proposals.length > 0 && <span>{fill(t("chProposalsSaved"), { n: String(x.proposals.length) })}</span>}
                  <button type="button" class="pill small" onClick={async () => toast({ text: t((await copyText(stripBlock(x.text))) ? "chCopied" : "chCopyFailed") })}>{t("chCopy")}</button>
                </div>
              </li>
            );
          }
          if (x.kind === "note") return <li key={x.id} class="msg me" data-msg="note"><div class="bubble">{x.text}</div></li>;
          return null;
        })}
        {pending && pending.sid === session?.id && (
          <li class="msg ai" data-msg="pending">
            <div class="bubble">{stripBlock(pending.text)}</div>
            <div class="proposal-card" data-pending>
              <p>{fill(t("chPendingTitle"), { n: String(countProposals(pending.text, system.refs, entries)) })}</p>
              <ul>{parseReply(pending.text, system.refs, entries).proposals.slice(0, 5).map((p) => <li key={p.key}>{p.title}</li>)}</ul>
              <button type="button" class="button" data-action="review" disabled={memLoading || steps === null} onClick={() => setSheet("review")}>{t("chReview")}</button>
            </div>
          </li>
        )}
        {streaming !== null && (
          <li class="msg ai" data-msg="streaming">
            {streaming ? <div class="bubble typing">{stripBlock(streaming)}</div> : <div class="bubble thinking" aria-label={t("chThinking")}><i /><i /><i /></div>}
          </li>
        )}
      </ol>

      {/* the message box appears once connected: before, the connect card is the only next step */}
      {signedIn && <div class="composer">
        <div class="chips" role="toolbar" aria-label={t("chPrompts")}>
          {[...prompts.map((p) => ({ id: p.id, icon: p.icon, label: p.label, text: p.text, open: p.open })), ...myPrompts.map((p) => ({ id: p.id, icon: "★", label: p.label, text: p.text, open: false }))].map((p) => (
            <button key={p.id} type="button" class="chip" data-prompt={p.id} onClick={() => usePrompt(p.text, p.open)}><b>{p.icon}</b>{p.label}</button>
          ))}
        </div>
        <div class="composer-row">
          <label class="sr-only" for="chat-input">{t("chMessage")}</label>
          <textarea id="chat-input" ref={box} name="message" rows={1} value={input} placeholder={pending ? t("chReviewFirst") : t("chPlaceholder")}
            maxLength={20000} onInput={(e) => {
              const el = e.target as HTMLTextAreaElement;
              setInput(el.value);
              el.style.height = "auto";
              el.style.height = Math.min(el.scrollHeight, 320) + "px";
            }} onKeyDown={onKey} />
          {busy && abort.current ? (
            <button type="button" class="send stop" data-action="stop" aria-label={t("chStop")} onClick={() => abort.current?.abort()}><IconStop /></button>
          ) : (
            <button type="button" class="send" data-action="send" aria-label={t("chSend")} disabled={!canSend} onClick={() => void send()}><IconSend /></button>
          )}
        </div>
        <div class="estimate" data-estimate={tokens}>
          <span>≈ {k(tokens)} {t("chTokensIn")}</span>
          {saved > 0 && <strong data-saved={saved}>−{saved}% {t("chVsFull")}</strong>}
          {cost !== null && <span>~{money(cost, lang)}</span>}
          <span>{t(`chCtx_${eco.context}` as Key)} · {system.included} {t("chItems")}</span>
        </div>
      </div>}

      {sheet === "model" && <ModelSheet value={model} onClose={() => setSheet(null)} onChoose={(m) => (setSettings({ ...settings, model: m }), setSheet(null))} />}
      {sheet === "eco" && <EconomySheet value={eco} onClose={() => setSheet(null)} onChange={(e) => setSettings({ ...settings, economy: e })} />}
      {sheet === "prompts" && <PromptsSheet list={myPrompts} draft={input} onChange={setMyPrompts} onUse={(p) => (usePrompt(p.text), setSheet(null))} onClose={() => setSheet(null)} />}
      {sheet === "history" && (
        <Dialog title={t("chHistory")} onClose={() => setSheet(null)} id="chat-history">
          {chats.length === 0 ? <p class="muted">{t("chHistoryEmpty")}</p> : (
            <div class="menu">
              {chats.map((s) => (
                <a key={s.id} class="menu-item" href={chatUrl(project.id, s.id)} data-chat-item={s.id} onClick={(e) => { e.preventDefault(); choose(s.id); setSheet(null); }}>
                  {s.providerName} · {props.date(s.updatedAt)}{s.id === session?.id ? " ✓" : ""}
                </a>
              ))}
            </div>
          )}
          <div class="sheet-actions single"><button type="button" class="button secondary" onClick={() => setSheet(null)}>{t("close")}</button></div>
        </Dialog>
      )}
      {sheet === "account" && (
        <Dialog title={t("chAccount")} onClose={() => setSheet(null)} id="chat-account">
          <p>{fill(t("chAccountText"), { name: account.name ?? "Puter" })}</p>
          {account.credit && <p class="muted">{t("chCreditLeft")}: {account.credit.unit === "usd" ? money(account.credit.value, lang) : `${Math.round(account.credit.value)} ${t("chCredits")}`}</p>}
          <p class="muted small-left">{t("chAccountPay")}</p>
          <div class="sheet-actions">
            <button type="button" class="button secondary" data-action="sign-out" onClick={async () => { await puter.signOut(); await refreshAccount(); setSheet(null); }}>{t("chSignOut")}</button>
            <a class="button link-button" href="https://puter.com/dashboard" target="_blank" rel="noopener noreferrer">{t("chOpenPuter")}</a>
          </div>
        </Dialog>
      )}
      {sheet === "review" && pending && session && pending.sid === session.id && lastStep?.id === pending.askId && (
        <ReplyDialog session={session} entries={entries} steps={sessionSteps} initialText={pending.text}
          onSaved={() => { writeJson(PENDING + pending.sid, null); setPending(null); }} onClose={() => setSheet(null)} />
      )}
    </section>
  );
}

/** The proposals block is reviewed separately: the bubble shows the answer without it. */
function stripBlock(text: string): string {
  return text.replace(/^[ \t]*(```|~~~)[ \t]*(aiw-propuneri|aiw-proposals)[ \t]*\n[\s\S]*?(^[ \t]*\1[ \t]*$|(?![\s\S]))/gim, "").trim();
}

function countProposals(text: string, refs: Record<string, string>, entries: Parameters<typeof parseReply>[2]): number {
  return parseReply(text, refs, entries).proposals.length;
}

function puterKey(e: unknown): Key {
  const p = e instanceof puter.PuterError ? e.problem : puter.classify(e).problem;
  return `chErr_${p}` as Key;
}

// ---------- sheets ----------

function ModelSheet(props: { value: string; onChoose: (m: string) => void; onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  const [custom, setCustom] = useState(findModel(props.value) ? "" : props.value);
  const valid = isModelId(custom.trim());
  return (
    <Dialog title={t("chModelTitle")} onClose={props.onClose} id="model-sheet">
      <p class="muted small-left">{t("chModelHint")}</p>
      <ul class="model-list" role="radiogroup" aria-label={t("chModel")}>
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

function EconomySheet(props: { value: Economy; onChange: (e: Economy) => void; onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  const e = props.value;
  const set = (c: Partial<Economy>) => props.onChange({ ...e, ...c });
  const preset = presetOf(e);
  return (
    <Dialog title={t("chEcoTitle")} onClose={props.onClose} id="eco-sheet">
      <p class="muted small-left">{t("chEcoHint")}</p>
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

function PromptsSheet(props: { list: MyPrompt[]; draft: string; onChange: (l: MyPrompt[]) => void; onUse: (p: MyPrompt) => void; onClose: () => void }): JSX.Element {
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
