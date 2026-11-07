// AIW-05 screens. The app never talks to an AI: it prepares the project's context, the user copies it
// into the assistant's own site, and brings the reply back; nothing enters the official memory until
// the user accepts it.
//   Launcher (#/lansator[/<project>[/<session it continues>]]): project → assistant → task → package → copy / open → session
//   Continuity (#/continuitate): the sessions; Session (#/sesiune/<id>): its steps, the reply review.
import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  assistantName, CATEGORIES, PROVIDERS, providerUrl, sha256, TITLE_MAX, BODY_MAX, TASK_MAX,
  type Category, type Exchange, type MemoryEntry, type ProviderId, type Session,
} from "../core";
import { buildPack, DEFAULT_PACK_LIMIT, PACK_LIMITS, parseReply, SessionError, type Pack, type ParsedReply, type ProposalDraft, type Verdict } from "../continuity";
import { errorKey, lastProject, rememberProject, sessionStore, useMemory, useProjects } from "./data";
import { fill, useDate, useI18n, type Key } from "./i18n";
import { Dialog, toast } from "./widgets";
import { canShareText, clearSharedText, readClipboard, readSharedText, setPendingReply, takePendingReply } from "./handoff";


const oneKey = (c: Category) => `one_${c}` as Key;
const sessionUrl = (id: string) => `#/sesiune/${encodeURIComponent(id)}`;

/** Sessions of all projects (or one), reloaded after any change. */
function useSessions(): { sessions: Session[]; loading: boolean } {
  const [state, setState] = useState<{ sessions: Session[]; loading: boolean }>({ sessions: [], loading: true });
  useEffect(() => {
    let alive = true;
    const load = () => sessionStore.list().then((sessions) => alive && setState({ sessions, loading: false }), () => alive && setState({ sessions: [], loading: false }));
    load();
    const off = sessionStore.subscribe(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

function useSteps(sessionId: string): Exchange[] | null {
  const [steps, setSteps] = useState<Exchange[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => sessionStore.exchanges(sessionId).then((x) => alive && setSteps(x), () => alive && setSteps([]));
    load();
    const off = sessionStore.subscribe(load);
    return () => {
      alive = false;
      off();
    };
  }, [sessionId]);
  return steps;
}

/** Copies text; returns false when the browser refuses (the caller then shows the text to copy by hand). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function slug(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "proiect";
}

/** A row of choices that behaves like radio buttons, including the arrow keys. */
function Segmented<T extends string>(props: { label: string; options: { value: T; label: string }[]; value: T; onChange: (v: T) => void; name: string }): JSX.Element {
  const move = (e: KeyboardEvent) => {
    const i = props.options.findIndex((o) => o.value === props.value);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = props.options[(i + step + props.options.length) % props.options.length].value;
    props.onChange(next);
    ((e.currentTarget as HTMLElement).querySelector(`[data-${props.name}="${next}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div class="segmented choices" role="radiogroup" aria-label={props.label} onKeyDown={move}>
      {props.options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={props.value === o.value}
          tabIndex={props.value === o.value || (!props.options.some((x) => x.value === props.value) && o === props.options[0]) ? 0 : -1}
          class={props.value === o.value ? "on" : ""} {...{ [`data-${props.name}`]: o.value }} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Launcher ----------

export function Launcher(props: { projectId?: string; continues?: string }): JSX.Element {
  const { t, lang } = useI18n();
  const date = useDate();
  const { projects, loading } = useProjects();
  const active = projects.filter((p) => !p.deletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const [projectId, setProjectId] = useState<string | null>(props.projectId ?? null);
  const chosen = active.find((p) => p.id === projectId) ?? active.find((p) => p.id === lastProject()) ?? active[0] ?? null;
  const { entries, links, loading: memLoading } = useMemory(chosen?.id ?? null);
  const [continues, setContinues] = useState<Session | null>(null);
  const [provider, setProvider] = useState<ProviderId>("claude");
  const [providerName, setProviderName] = useState("");
  const [task, setTask] = useState("");
  // saved replies are included only on request: they are raw AI text (some of their ideas may have been rejected)
  const [historyN, setHistoryN] = useState<"0" | "1" | "3">("0");
  const [maxChars, setMaxChars] = useState<number>(DEFAULT_PACK_LIMIT);
  const [includeClosed, setIncludeClosed] = useState(false);
  const [history, setHistory] = useState<Awaited<ReturnType<typeof sessionStore.savedReplies>>>([]);
  const [started, setStarted] = useState<{ session: Session; copied: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!props.continues) return;
    void sessionStore.get(props.continues).then((s) => {
      if (!s) return;
      setContinues(s);
      setProjectId(s.projectId);
      setTask(s.task);
      // continuing elsewhere: suggest another assistant than the one used before
      setProvider(s.provider === "claude" ? "chatgpt" : "claude");
    });
  }, [props.continues]);
  useEffect(() => {
    if (!chosen) return;
    let alive = true;
    void sessionStore.savedReplies(chosen.id, Number(historyN)).then((h) => alive && setHistory(h));
    return () => void (alive = false);
  }, [chosen?.id, historyN, started]);
  useEffect(() => setStarted(null), [chosen?.id, provider]);

  const assistant = provider === "other" ? providerName.trim() || t("lnOtherAi") : PROVIDERS.find((p) => p.id === provider)!.name;
  const pack: Pack | null = useMemo(() => {
    if (!chosen || memLoading) return null;
    return buildPack(chosen, entries, links, {
      lang, assistant, task: task.trim(), history, maxChars, includeClosed,
      date: date(new Date().toISOString()), formatDate: date,
    });
  }, [chosen, entries, links, memLoading, lang, assistant, task, history, maxChars, includeClosed]);

  // the package's fingerprint is ready before the tap: sharing must start inside the tap itself
  const [packSha, setPackSha] = useState<string | null>(null);
  useEffect(() => {
    setPackSha(null);
    if (!pack) return;
    let alive = true;
    void sha256(pack.text).then((h) => alive && setPackSha(h));
    return () => void (alive = false);
  }, [pack?.text]);

  const record = async (copied: boolean, text: string) => {
    if (!chosen || !pack || !packSha) return;
    try {
      const session = await sessionStore.start(chosen.id, { provider, providerName, task, continues: continues?.id ?? null },
        { sha256: packSha, chars: text.length, refs: pack.refs });
      rememberProject(chosen.id);
      setStarted({ session, copied, text });
    } catch (e) {
      setError(t(errorKey(e)));
    } finally {
      setBusy(false);
    }
  };

  /** One tap: the share sheet on phones (choose the AI app), copy + the AI site in a new tab on computers. */
  const send = () => {
    if (!chosen || !pack || !packSha) return;
    const text = pack.text;
    setBusy(true);
    setError(null);
    if (canShareText()) {
      navigator.share({ text }).then(
        () => void record(false, text),
        (e: unknown) => {
          if ((e as { name?: string })?.name === "AbortError") return setBusy(false); // closed: nothing started
          void copyText(text).then((ok) => record(ok, text)); // share refused: copy instead
        },
      );
      return;
    }
    const copying = copyText(text);
    const url = providerUrl(provider);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
    void copying.then((ok) => record(ok, text));
  };

  const download = () => {
    if (!chosen || !pack) return;
    setBusy(true);
    downloadText(`context-${slug(chosen.name)}.md`, pack.text);
    void record(false, pack.text);
  };

  /** Back from the AI app with the reply copied: one tap reads it and opens the review. */
  const bringBack = async (sessionId: string) => {
    setPendingReply(sessionId, (await readClipboard()) ?? "");
    location.hash = sessionUrl(sessionId);
  };

  if (loading) return <section><h1 class="large-title">{t("launcherTitle")}</h1><p class="muted">{t("loading")}</p></section>;
  if (!chosen) {
    return (
      <section>
        <h1 class="large-title">{t("launcherTitle")}</h1>
        <div class="card empty">
          <p class="lead">{t("lnNoProjects")}</p>
          <a class="button link-button" href="#/proiecte">{t("projectsNew")}</a>
        </div>
      </section>
    );
  }
  const url = providerUrl(provider);
  const official = entries.filter((e) => e.confirmation === "confirmed" && !e.archived).length;

  return (
    <section class="launcher">
      <h1 class="large-title">{t("launcherTitle")}</h1>
      <p class="muted">{t("lnIntro")}</p>
      {continues && (
        <p class="card notice" data-continues={continues.id}>
          {fill(t("lnContinues"), { ai: assistantName(continues), date: date(continues.createdAt) })}
        </p>
      )}

      <div class="card step-card">
        <h2>1. {t("lnStepProject")}</h2>
        <label class="field">
          <span class="sr-only">{t("lnStepProject")}</span>
          <select name="project" value={chosen.id} disabled={!!continues} onChange={(e) => setProjectId((e.target as HTMLSelectElement).value)}>
            {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <p class="muted small-left">{fill(t("lnOfficialCount"), { n: String(official) })}</p>
      </div>

      <div class="card step-card">
        <h2>2. {t("lnStepAi")}</h2>
        <Segmented name="provider" label={t("lnStepAi")} value={provider} onChange={setProvider}
          options={PROVIDERS.map((p) => ({ value: p.id, label: p.id === "other" ? t("lnOtherAi") : p.name }))} />
        {provider === "other" && (
          <label class="field">
            <span>{t("lnOtherName")}</span>
            <input name="providerName" value={providerName} maxLength={40} placeholder="Mistral, Copilot, Perplexity…"
              onInput={(e) => setProviderName((e.target as HTMLInputElement).value)} />
          </label>
        )}
        <p class="muted small-left">{t("lnNoApi")}</p>
      </div>

      <div class="card step-card">
        <h2>3. {t("lnStepTask")}</h2>
        <label class="field">
          <span>{t("lnTaskLabel")}</span>
          <textarea name="task" rows={3} maxLength={TASK_MAX} value={task} placeholder={t("lnTaskPlaceholder")}
            onInput={(e) => setTask((e.target as HTMLTextAreaElement).value)} />
        </label>
        <p class="small-left"><strong>{t("lnHistory")}</strong></p>
        <Segmented name="history" label={t("lnHistory")} value={historyN} onChange={setHistoryN}
          options={[{ value: "0", label: t("lnHistory0") }, { value: "1", label: t("lnHistory1") }, { value: "3", label: t("lnHistory3") }]} />
        {historyN !== "0" && <p class="small-left warn" data-history-warn>{t("lnHistoryWarn")}</p>}
        <label class="check">
          <input type="checkbox" checked={includeClosed} onChange={(e) => setIncludeClosed((e.target as HTMLInputElement).checked)} />
          <span>{t("ctxIncludeClosed")}</span>
        </label>
        <label class="field">
          <span>{t("lnLimit")}</span>
          <select name="limit" value={String(maxChars)} onChange={(e) => setMaxChars(Number((e.target as HTMLSelectElement).value))}>
            {PACK_LIMITS.map((n) => <option key={n} value={n}>{fill(t("lnLimitOption"), { n: new Intl.NumberFormat(lang).format(n) })}</option>)}
          </select>
        </label>
      </div>

      <div class="card step-card" data-step="pack">
        <h2>4. {t("lnStepPack")}</h2>
        {pack && (
          <>
            <p class="small-left" data-pack-chars={pack.stats.chars}>
              {fill(t("lnPackStats"), { n: String(pack.stats.included), c: new Intl.NumberFormat(lang).format(pack.stats.chars), max: new Intl.NumberFormat(lang).format(pack.stats.maxChars) })}
              {pack.historyIncluded > 0 ? ` · ${fill(t("lnPackHistory"), { n: String(pack.historyIncluded) })}` : ""}
            </p>
            {pack.omitted.length + pack.historyOmitted > 0 && (
              <details class="small-left" data-omitted-count={pack.omitted.length}>
                <summary>{fill(t("lnPackOmitted"), { n: String(pack.omitted.length + pack.historyOmitted) })}</summary>
                <ul class="plain">
                  {pack.omitted.map((o) => <li key={o.id} data-pack-omitted={o.title}>{o.title} · {t(`om_${o.reason}` as Key)}</li>)}
                  {pack.historyOmitted > 0 && <li>{fill(t("lnHistoryOmitted"), { n: String(pack.historyOmitted) })}</li>}
                </ul>
              </details>
            )}
            <details class="pack-preview-wrap">
              <summary>{t("lnShowPack")}</summary>
              <pre class="pack-preview" data-pack>{pack.text}</pre>
            </details>
            <p class="muted small-left">{fill(t("lnNothingSent"), { ai: assistant })}</p>
            {error && <p class="form-error" role="alert">{error}</p>}
            <div class="actions">
              <button type="button" class="button" data-action="send-pack" disabled={busy || !packSha || (provider === "other" && !providerName.trim())} onClick={send}>
                {fill(t("lnSend"), { ai: assistant })}
              </button>
              <button type="button" class="button secondary" data-action="download-pack" disabled={busy || !packSha || (provider === "other" && !providerName.trim())} onClick={download}>{t("lnDownloadStart")}</button>
            </div>
            <p class="muted small-left">{t(canShareText() ? "lnSendPhone" : "lnSendComputer")}</p>
          </>
        )}
      </div>

      {started && (
        <div class="card step-card notice" data-step="work" data-session={started.session.id}>
          <h2>5. {fill(t("lnStepWork"), { ai: assistant })}</h2>
          {started.copied && <p data-copied>✓ {fill(t("lnCopiedOpened"), { ai: assistant })}</p>}
          {!started.copied && !canShareText() && (
            <>
              <p>{t("lnCopyManual")}</p>
              <textarea class="manual-copy" readOnly rows={6} value={started.text} onFocus={(e) => (e.target as HTMLTextAreaElement).select()} />
            </>
          )}
          {url && (
            <a class="button secondary link-button" href={url} target="_blank" rel="noopener noreferrer" data-action="open-ai">
              {fill(t("lnOpenAi"), { ai: assistant })} ↗
            </a>
          )}
          <h2>6. {t("lnStepBack")}</h2>
          <p class="small-left">{t("lnBackOneTap")}</p>
          <div class="actions">
            <button type="button" class="button" data-action="bring-back" onClick={() => void bringBack(started.session.id)}>{t("lnBringBack")}</button>
            <a class="button secondary link-button" href={sessionUrl(started.session.id)} data-action="open-session">{t("lnOpenSession")}</a>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- Continuity (sessions list) ----------

export function ContinuityScreen(): JSX.Element {
  const { t } = useI18n();
  const date = useDate();
  const { sessions, loading } = useSessions();
  const { projects } = useProjects();
  const name = new Map(projects.map((p) => [p.id, p]));
  const visible = sessions.filter((s) => name.has(s.projectId));
  const open = visible.filter((s) => s.status === "open");
  const closed = visible.filter((s) => s.status === "closed");
  const row = (s: Session) => (
    <li key={s.id} class="row" data-session={s.id}>
      <a class="row-main" href={sessionUrl(s.id)}>
        <span class="row-name">{assistantName(s)} · {name.get(s.projectId)!.name}</span>
        {s.task && <span class="row-desc">{s.task}</span>}
        <span class="row-meta">{t("updatedOn")} {date(s.updatedAt)}{name.get(s.projectId)!.deletedAt ? ` · ${t("importInTrash")}` : ""}</span>
      </a>
    </li>
  );
  return (
    <section>
      <div class="title-row">
        <h1 class="large-title">{t("continuityTitle")}</h1>
        {visible.length > 0 && <a class="button link-button" href="#/lansator" data-action="new-session">{t("ctNew")}</a>}
      </div>
      <p class="muted">{t("ctIntro")}</p>
      {loading ? <p class="muted">{t("loading")}</p> : visible.length === 0 ? (
        <div class="card empty">
          <p class="lead">{t("continuityEmpty")}</p>
          <p class="muted">{t("ctEmptyHint")}</p>
          <a class="button link-button" href="#/lansator" data-action="new-session">{t("ctNew")}</a>
        </div>
      ) : (
        <>
          {open.length > 0 && <><h2 class="section-title">{t("ctOpen")}</h2><ul class="list" data-list="open">{open.map(row)}</ul></>}
          {closed.length > 0 && <><h2 class="section-title">{t("ctClosed")}</h2><ul class="list" data-list="closed">{closed.map(row)}</ul></>}
        </>
      )}
    </section>
  );
}

// ---------- Received through the share sheet (Android) ----------

export function ReceiveScreen(): JSX.Element {
  const { t } = useI18n();
  const date = useDate();
  const { sessions, loading } = useSessions();
  const { projects } = useProjects();
  const text = readSharedText();
  const byId = new Map(projects.map((p) => [p.id, p]));
  const open = sessions.filter((s) => s.status === "open" && byId.has(s.projectId) && !byId.get(s.projectId)!.deletedAt);
  const attach = (sessionId: string) => {
    setPendingReply(sessionId, text ?? "");
    clearSharedText();
    location.hash = sessionUrl(sessionId);
  };
  return (
    <section data-receive>
      <h1 class="large-title">{t("rcTitle")}</h1>
      {!text ? <div class="card empty"><p class="lead">{t("rcNothing")}</p></div> : (
        <>
          <div class="card"><p class="pre muted" data-received>{text.length > 400 ? text.slice(0, 400) + "…" : text}</p></div>
          {loading ? <p class="muted">{t("loading")}</p> : open.length === 0 ? (
            <div class="card empty">
              <p class="lead">{t("rcNoSession")}</p>
              <a class="button link-button" href="#/lansator">{t("ctNew")}</a>
            </div>
          ) : (
            <>
              <h2 class="section-title">{t("rcChoose")}</h2>
              <ul class="list">
                {open.map((s) => (
                  <li key={s.id} class="row" data-receive-session={s.id}>
                    <button type="button" class="row-main as-button" onClick={() => attach(s.id)}>
                      <span class="row-name">{assistantName(s)} · {byId.get(s.projectId)!.name}</span>
                      <span class="row-meta">{t("updatedOn")} {date(s.updatedAt)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <button type="button" class="button secondary" onClick={() => { clearSharedText(); location.hash = "#/continuitate"; }}>{t("rcDiscard")}</button>
        </>
      )}
    </section>
  );
}

// ---------- Session page ----------

export function SessionPage(props: { id: string }): JSX.Element {
  const { t } = useI18n();
  const date = useDate();
  const { sessions, loading } = useSessions();
  const { projects } = useProjects();
  const s = sessions.find((x) => x.id === props.id);
  const project = projects.find((p) => p.id === s?.projectId);
  const steps = useSteps(props.id);
  const { entries, loading: memLoading } = useMemory(s?.projectId ?? null);
  const [dlg, setDlg] = useState<"reply" | "note" | null>(null);
  const [initial, setInitial] = useState<string>("");
  // a reply brought from the launcher, the share sheet or the clipboard opens the review at once
  useEffect(() => {
    const text = takePendingReply(props.id);
    if (text !== null) {
      setInitial(text);
      setDlg("reply");
    }
  }, [props.id]);
  const addReply = async () => {
    setInitial((await readClipboard()) ?? "");
    setDlg("reply");
  };
  const awaiting = !!steps?.length && steps[steps.length - 1].kind === "sent";
  const byId = new Map(entries.map((e) => [e.id, e]));
  const prev = s?.continues ? sessions.find((x) => x.id === s.continues) : undefined;
  const writable = !!s && s.status === "open" && !!project && !project.deletedAt;

  const run = async (fn: () => Promise<unknown>, ok: Key) => {
    try {
      await fn();
      toast({ text: t(ok) });
    } catch (e) {
      toast({ text: t(errorKey(e)), error: true });
    }
  };

  if (loading) return <section><a class="back" href="#/continuitate">‹ {t("continuityTitle")}</a><p class="muted">{t("loading")}</p></section>;
  if (!s || !project) return <section><a class="back" href="#/continuitate">‹ {t("continuityTitle")}</a><div class="card empty"><p class="lead">{t("ssMissing")}</p></div></section>;

  return (
    <section data-session-page={s.id}>
      <a class="back" href="#/continuitate">‹ {t("continuityTitle")}</a>
      <h1 class="large-title">{assistantName(s)} · {project.name}</h1>
      <p class="muted small-left">
        {t("createdOn")} {date(s.createdAt)} · <span class="tag" data-status={s.status}>{t(s.status === "open" ? "ssOpen" : "ssClosed")}</span>
        {prev ? <> · <a href={sessionUrl(prev.id)}>{fill(t("ssContinues"), { ai: assistantName(prev) })}</a></> : null}
      </p>
      {writable && awaiting && (
        <div class="card notice" data-awaiting>
          <p><strong>{fill(t("ssAwaiting"), { ai: assistantName(s) })}</strong></p>
          <p class="muted small-left">{t("ssAwaitingHint")}</p>
        </div>
      )}
      {s.task && <div class="card"><h2>{t("lnStepTask")}</h2><p class="pre">{s.task}</p></div>}

      {writable && (
        <div class="actions">
          <button type="button" class="button" data-action="add-reply" onClick={() => void addReply()}>{t("ssAddReply")}</button>
          <button type="button" class="button secondary" data-action="add-note" onClick={() => setDlg("note")}>{t("ssAddNote")}</button>
          <a class="button secondary link-button" href={`#/lansator/${encodeURIComponent(project.id)}/${encodeURIComponent(s.id)}`} data-action="continue-elsewhere">{t("ssContinueElsewhere")}</a>
          <button type="button" class="button secondary" data-action="close-session" onClick={() => run(() => sessionStore.close(s.id), "ssClosedToast")}>{t("ssClose")}</button>
        </div>
      )}
      {!writable && s.status === "closed" && !project.deletedAt && (
        <div class="actions">
          <a class="button secondary link-button" href={`#/lansator/${encodeURIComponent(project.id)}/${encodeURIComponent(s.id)}`} data-action="continue-elsewhere">{t("ssContinueElsewhere")}</a>
          <button type="button" class="button secondary" data-action="reopen-session" onClick={() => run(() => sessionStore.reopen(s.id), "ssReopenedToast")}>{t("ssReopen")}</button>
        </div>
      )}

      <h2 class="section-title">{t("ssSteps")}</h2>
      <ol class="steps" data-steps>
        {(steps ?? []).map((x) => (
          <li key={x.id} class="card" data-kind={x.kind}>
            <p class="row-meta">{date(x.createdAt)}</p>
            {x.kind === "sent" && <p>{fill(t("ssSent"), { c: String(x.pack!.chars), n: String(Object.keys(x.pack!.refs).length) })}</p>}
            {x.kind === "note" && <p class="pre">{x.text}</p>}
            {x.kind === "reply" && (
              <>
                <p><strong>{fill(t("ssReplyFrom"), { ai: assistantName(s) })}</strong></p>
                <details><summary>{t("ssShowReply")}</summary><p class="pre">{x.text}</p></details>
                {x.proposals.length > 0 && (
                  <ul class="plain small-left">
                    {x.proposals.map((id) => {
                      const e = byId.get(id);
                      if (!e) return <li key={id} class="muted">{t("ssProposalGone")}</li>;
                      const st = e.confirmation === "confirmed" ? "ssAccepted" : e.confirmation === "rejected" ? "ssRejected" : "ssLater";
                      return (
                        <li key={id} data-proposal={e.title} data-state={e.confirmation}>
                          <a href={`#/proiect/${encodeURIComponent(e.projectId)}/memorie/${encodeURIComponent(e.id)}`}>{e.title}</a>
                          {" · "}{t(oneKey(e.category))}{" · "}<span class={e.confirmation === "pending" ? "tag warn" : "tag"}>{t(st)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            )}
          </li>
        ))}
      </ol>

      {dlg === "note" && <NoteDialog sessionId={s.id} onClose={() => setDlg(null)} />}
      {/* the review compares with the memory and resolves the package's references: it waits until both are loaded */}
      {dlg === "reply" && steps !== null && !memLoading && <ReplyDialog session={s} entries={entries} steps={steps ?? []} initialText={initial} onClose={() => setDlg(null)} />}
    </section>
  );
}

function NoteDialog(props: { sessionId: string; onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={t("ssAddNote")} onClose={props.onClose} id="note-form">
      <form onSubmit={async (e) => {
        e.preventDefault();
        try {
          await sessionStore.addNote(props.sessionId, text);
          props.onClose();
          toast({ text: t("ssNoteSaved") });
        } catch (err) {
          setError(t(errorKey(err)));
        }
      }}>
        <label class="field"><span>{t("ssNoteLabel")}</span>
          <textarea name="note" rows={5} value={text} autoFocus onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} /></label>
        {error && <p class="form-error" role="alert">{error}</p>}
        <div class="sheet-actions">
          <button type="button" class="button secondary" onClick={props.onClose}>{t("cancel")}</button>
          <button type="submit" class="button">{t("save")}</button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------- Bringing the reply back: paste → analyse → review → save ----------

interface Item extends ProposalDraft { verdict: Verdict | null; editedTitle: string; editedBody: string; editedCategory: Category; keepRelation: boolean }

function ReplyDialog(props: { session: Session; entries: MemoryEntry[]; steps: Exchange[]; initialText?: string; onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  const [text, setText] = useState(props.initialText ?? "");
  const [parsed, setParsed] = useState<ParsedReply | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorItem, setErrorItem] = useState<string | null>(null);
  const top = useRef<HTMLParagraphElement>(null);
  const byId = new Map(props.entries.map((e) => [e.id, e]));
  // the references of the latest package sent in this session (D1 → the entry it meant)
  const refs = [...props.steps].reverse().find((x) => x.kind === "sent")?.pack?.refs ?? {};

  const analyse = (source = text) => {
    setText(source);
    const r = parseReply(source, refs, props.entries);
    setParsed(r);
    setItems(r.proposals.map((p) => ({
      // a proposal that replaces / resolves something must be decided now (no default); duplicates: reject
      ...p, verdict: p.replaces || p.resolves ? null : p.match === "duplicate" || p.notes.includes("duplicateInReply") ? "reject" : "later",
      editedTitle: p.title, editedBody: p.body, editedCategory: p.category, keepRelation: true,
    })));
    setError(null);
    setTimeout(() => top.current?.focus(), 0);
  };
  const set = (key: string, change: Partial<Item>) => (touched.current = true, setItems((list) => list.map((x) => {
    if (x.key !== key) return x;
    const next = { ...x, ...change };
    // "later" is not possible while a relation is kept
    if (next.verdict === "later" && next.keepRelation && hasRelation(next)) next.verdict = null;
    return next;
  })));
  const hasRelation = (x: Item) => !!((x.editedCategory === "decision" && x.replaces) || (x.editedCategory !== "issue" && x.resolves));
  const undecided = items.filter((x) => x.verdict === null).length;
  const counts = { accept: items.filter((x) => x.verdict === "accept").length, reject: items.filter((x) => x.verdict === "reject").length, later: items.filter((x) => x.verdict === "later").length };

  // a reply that arrived already (share sheet / clipboard) is analysed at once, and again if the memory
  // or the session's steps finish loading afterwards (as long as the person has not changed anything yet)
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current && (parsed || props.initialText?.trim())) analyse(parsed ? text : props.initialText!);
  }, [props.entries, props.steps]);
  const pasteClipboard = async () => {
    const c = await readClipboard();
    if (c) analyse(c);
    else setError(t("rvClipboardEmpty"));
  };

  /** One tap: every new proposal accepted, duplicates rejected, the rest left to decide; then saved. */
  const acceptAllAndSave = () => {
    touched.current = true;
    const next = items.map((x) => {
      if (x.match === "duplicate" || x.notes.includes("duplicateInReply")) return { ...x, verdict: "reject" as Verdict };
      if (x.match === "new") return { ...x, verdict: "accept" as Verdict };
      return x.verdict === null && x.keepRelation && hasRelation(x) ? x : { ...x, verdict: x.verdict ?? ("later" as Verdict) };
    });
    setItems(next);
    if (next.some((x) => x.verdict === null)) return setError(t("rvStillUndecided"));
    void save(next);
  };

  const save = async (list: Item[] = items) => {
    setBusy(true);
    setError(null);
    setErrorItem(null);
    try {
      await sessionStore.applyReply(props.session.id, text, list.map((x) => {
        const changed = x.editedTitle !== x.title || x.editedBody !== x.body;
        const decisionRel = x.editedCategory === "decision" && x.keepRelation ? x.replaces : null;
        const resolveRel = x.editedCategory !== "issue" && x.keepRelation ? x.resolves : null;
        return {
          category: x.editedCategory, title: x.editedTitle, body: x.editedBody, important: x.important,
          original: changed ? { title: x.title, body: x.body } : undefined,
          replaces: decisionRel, resolves: resolveRel, reason: x.reason, verdict: x.verdict!,
        };
      }));
      props.onClose();
      const c = { a: list.filter((x) => x.verdict === "accept").length, r: list.filter((x) => x.verdict === "reject").length, l: list.filter((x) => x.verdict === "later").length };
      toast({ text: fill(t("rvSaved"), { a: String(c.a), r: String(c.r), l: String(c.l) }) });
    } catch (e) {
      setError(t(errorKey(e)));
      // point at the proposal that could not be saved
      const i = e instanceof SessionError ? e.item : undefined;
      if (i !== undefined && list[i]) {
        setErrorItem(list[i].key);
        setTimeout(() => document.querySelector(`[data-review-key="${list[i].key}"]`)?.scrollIntoView({ block: "center" }), 0);
      }
      setBusy(false);
    }
  };

  const matchText = (x: Item): string | null => {
    const other = x.similarTo ? byId.get(x.similarTo) : undefined;
    if (x.match === "duplicate") return fill(t("rvDuplicate"), { title: other?.title ?? "" });
    if (x.match === "similar") return fill(t("rvSimilar"), { title: other?.title ?? "" });
    return null;
  };

  return (
    <Dialog title={t("rvTitle")} onClose={props.onClose} id="reply-dialog">
      {!parsed ? (
        <>
          <p class="muted">{fill(t("rvPasteHint"), { ai: assistantName(props.session) })}</p>
          <button type="button" class="button" data-action="paste-clipboard" onClick={() => void pasteClipboard()}>{t("rvPasteClipboard")}</button>
          {error && <p class="form-error" role="alert">{error}</p>}
          <label class="field"><span>{t("rvPasteLabel")}</span>
            <textarea name="reply" rows={8} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} /></label>
          <div class="sheet-actions">
            <button type="button" class="button secondary" onClick={props.onClose}>{t("cancel")}</button>
            <button type="button" class="button secondary" data-action="analyse" disabled={!text.trim()} onClick={() => analyse()}>{t("rvAnalyse")}</button>
          </div>
        </>
      ) : (
        <>
          <p ref={top} tabIndex={-1} data-found={parsed.found}>
            {parsed.found === "block" ? fill(t("rvFoundBlock"), { n: String(items.length) })
              : parsed.found === "sections" ? fill(t("rvFoundSections"), { n: String(items.length) }) : t("rvFoundNone")}
          </p>
          {parsed.blockInvalid && <p class="warn">{t("rvBlockInvalid")}</p>}
          <p class="muted small-left">{t("rvRule")}</p>
          {items.length > 0 && (
            <div class="actions">
              <button type="button" class="button" data-action="accept-all-save" disabled={busy} onClick={acceptAllAndSave}>{t("rvAcceptAllSave")}</button>
              {items.length > 1 && (
                <button type="button" class="button secondary small-button" data-action="accept-new" onClick={() => (touched.current = true) && setItems((l) => l.map((x) => (x.match === "new" && !x.notes.includes("duplicateInReply") ? { ...x, verdict: "accept" } : x)))}>{t("rvAcceptNew")}</button>
              )}
            </div>
          )}
          <ul class="import-list">
            {items.map((x) => {
              const rel = x.replaces ? byId.get(x.replaces) : x.resolves ? byId.get(x.resolves) : undefined;
              const m = matchText(x);
              return (
                <li key={x.key} class={"import-item" + (errorItem === x.key ? " has-error" : "")} data-review={x.title} data-review-key={x.key} data-match={x.match}>
                  {errorItem === x.key && error && <p class="form-error" role="alert" data-item-error>{error}</p>}
                  <label class="field"><span>{t("memCategory")}</span>
                    <select name="category" value={x.editedCategory} onChange={(e) => set(x.key, { editedCategory: (e.target as HTMLSelectElement).value as Category })}>
                      {CATEGORIES.map((c) => <option key={c} value={c}>{t(oneKey(c))}</option>)}
                    </select></label>
                  <label class="field"><span>{t("memTitle")}</span>
                    <input name="title" value={x.editedTitle} maxLength={TITLE_MAX * 2} onInput={(e) => set(x.key, { editedTitle: (e.target as HTMLInputElement).value })} /></label>
                  <details open={!!x.body}>
                    <summary class="small-left">{t("memBody")}</summary>
                    <label class="field"><span class="sr-only">{t("memBody")}</span>
                      <textarea name="body" rows={3} maxLength={BODY_MAX} value={x.editedBody} onInput={(e) => set(x.key, { editedBody: (e.target as HTMLTextAreaElement).value })} /></label>
                  </details>
                  <label class="check small-left">
                    <input type="checkbox" name="important" checked={x.important} onChange={(e) => set(x.key, { important: (e.target as HTMLInputElement).checked })} />
                    <span>{t("rvImportant")}</span>
                  </label>
                  {m && <p class="small-left warn" data-similar>{m}</p>}
                  {rel && (
                    <label class="check small-left" data-relation={x.replaces ? "replaces" : "resolves"}>
                      <input type="checkbox" checked={x.keepRelation} onChange={(e) => set(x.key, { keepRelation: (e.target as HTMLInputElement).checked })} />
                      <span>{fill(t(x.replaces ? "rvReplaces" : "rvResolves"), { title: rel.title })}{x.reason ? ` — ${x.reason}` : ""}</span>
                    </label>
                  )}
                  {x.notes.includes("unknownRef") && <p class="muted small-left">{t("rvUnknownRef")}</p>}
                  {x.notes.includes("titleCut") && <p class="muted small-left">{t("rvTitleCut")}</p>}
                  {x.verdict === null && <p class="small-left warn" data-choose>{t("rvChooseNow")}</p>}
                  <Segmented name="verdict" label={`${t("rvVerdict")} ${x.title}`} value={x.verdict ?? ("" as Verdict)} onChange={(v) => set(x.key, { verdict: v })}
                    options={[{ value: "accept" as Verdict, label: t("rvAccept") }, { value: "reject" as Verdict, label: t("rvReject") },
                      ...(x.keepRelation && hasRelation(x) ? [] : [{ value: "later" as Verdict, label: t("rvLater") }])]} />
                </li>
              );
            })}
          </ul>
          {error && !errorItem && <p class="form-error" role="alert">{error}</p>}
          {undecided > 0 && <p class="muted small-left" data-undecided={undecided}>{fill(t("rvUndecided"), { n: String(undecided) })}</p>}
          <div class="sheet-actions">
            <button type="button" class="button secondary" onClick={() => setParsed(null)}>{t("rvBack")}</button>
            <button type="button" class="button" data-action="save-review" disabled={busy || undecided > 0} onClick={() => void save()}>
              {items.length ? fill(t("rvSave"), { a: String(counts.accept), r: String(counts.reject), l: String(counts.later) }) : t("rvSaveOnly")}
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}



