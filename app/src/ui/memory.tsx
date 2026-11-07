// Project memory screens (AIW-03): memory view, entry page, history + integrity check, context preview.
// User text is always rendered as text (never as HTML).
import type { JSX } from "preact";
import { useEffect, useLayoutEffect, useMemo, useState } from "preact/hooks";
import {
  BODY_MAX, CATEGORIES, isOfficial, LINK_TYPES, searchMemory, sortEntries, TITLE_MAX,
  type Category, type JournalEvent, type LinkType, type MemoryEntry, type MemoryLink, type Project,
} from "../core";
import { buildContext, DEFAULT_MAX_CHARS } from "../memory";
import type { IntegrityReport } from "../storage";
import { errorKey, lastProject, memoryStore, rememberProject, useMemory, useProjects } from "./data";
import { fill, useDate, useI18n, type Key } from "./i18n";
import { Confirm, Dialog, toast } from "./widgets";

type View = "memory" | "pending" | "archive";
const catKey = (c: Category) => `cat_${c}` as Key;
const oneKey = (c: Category) => `one_${c}` as Key;
const memUrl = (projectId: string, rest = "") => `#/proiect/${encodeURIComponent(projectId)}/memorie${rest}`;

function useRun() {
  const { t } = useI18n();
  return async (fn: () => Promise<unknown>, ok?: Key): Promise<boolean> => {
    try {
      await fn();
      if (ok) toast({ text: t(ok) });
      return true;
    } catch (e) {
      toast({ text: t(errorKey(e)), error: true });
      return false;
    }
  };
}

function statusKey(e: MemoryEntry): Key | null {
  if (e.status === "replaced") return "st_replaced";
  if (e.status === "resolved") return e.category === "step" ? "st_done" : "st_resolved";
  return null;
}

/** Small labels shown next to an entry: importance, status, provenance, archive. */
function Badges(props: { e: MemoryEntry }): JSX.Element {
  const { t } = useI18n();
  const e = props.e;
  const st = statusKey(e);
  return (
    <span class="badges">
      {e.important && <span class="tag accent" title={t("memImportant")}>★ {t("memImportant")}</span>}
      {st && <span class="tag">{t(st)}</span>}
      {e.confirmation === "pending" && <span class="tag warn">{t("memPendingBadge")}</span>}
      {e.confirmation === "rejected" && <span class="tag">{t("memRejectedBadge")}</span>}
      {e.author === "ai" && e.confirmation === "confirmed" && <span class="tag">{t("memByAiConfirmed")}</span>}
      {e.archived && e.confirmation !== "rejected" && <span class="tag">{t("memArchivedBadge")}</span>}
    </span>
  );
}

// ---------- Memory tab: last used project + selector ----------

export function MemoryTab(): JSX.Element {
  const { t } = useI18n();
  const { projects, loading } = useProjects();
  const active = useMemo(() => projects.filter((p) => !p.deletedAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [projects]);
  const [chosen, setChosen] = useState<string | null>(lastProject());
  if (loading) return <p class="muted">{t("loading")}</p>;
  if (active.length === 0) {
    return (
      <section>
        <h1 class="large-title">{t("memoryTitle")}</h1>
        <div class="card empty">
          <p class="lead">{t("memNoProjects")}</p>
          <a class="button link-button" href="#/proiecte">{t("memGoToProjects")}</a>
        </div>
      </section>
    );
  }
  const found = active.find((p) => p.id === chosen);
  const project = found ?? active[0];
  const fellBack = !!chosen && !found;
  return (
    <MemoryView
      project={project}
      selector={
        <label class="field selector">
          <span>{t("memProjectLabel")}</span>
          <select value={project.id} onChange={(e) => { const id = (e.target as HTMLSelectElement).value; rememberProject(id); setChosen(id); }}>
            {active.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      }
      notice={fellBack ? fill(t("memFallback"), { name: project.name }) : null}
    />
  );
}

/** The memory of one project, reached from the project page. */
export function ProjectMemory(props: { projectId: string }): JSX.Element {
  const { t } = useI18n();
  const { projects, loading } = useProjects();
  const p = projects.find((x) => x.id === props.projectId);
  if (loading) return <p class="muted">{t("loading")}</p>;
  if (!p) return <div class="card empty"><p class="lead">{t("projectMissing")}</p></div>;
  return <MemoryView project={p} back readOnly={!!p.deletedAt} />;
}

// ---------- Memory view ----------

function MemoryView(props: { project: Project; selector?: JSX.Element; notice?: string | null; back?: boolean; readOnly?: boolean }): JSX.Element {
  const { t } = useI18n();
  const p = props.project;
  useLayoutEffect(() => rememberProject(p.id), [p.id]);
  const { entries, versions, loading, error } = useMemory(p.id);
  const [view, setView] = useState<View>("memory");
  const [cat, setCat] = useState<Category | "all">("all");
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState(false);
  const [adding, setAdding] = useState(false);

  const pending = entries.filter((e) => e.confirmation === "pending");
  const archived = entries.filter((e) => e.archived);
  const current = entries.filter((e) => e.confirmation === "confirmed" && !e.archived);
  const hits = useMemo(
    () => searchMemory(p.id, entries, query, { history: history && view === "memory", archived: view === "archive" }, versions),
    [entries, versions, query, history, view, p.id],
  );
  const inView = view === "pending" ? pending : view === "archive" ? archived : current;
  const searching = query.trim() !== "";
  const counts = (c: Category) => current.filter((e) => e.category === c).length;

  return (
    <section>
      {props.back && <a class="back" href={`#/proiect/${encodeURIComponent(p.id)}`}>‹ {p.name}</a>}
      <div class="title-row">
        <h1 class="large-title">{t("memoryTitle")}</h1>
        {!props.readOnly && (
          <button type="button" class="button" data-action="add-memory" onClick={() => setAdding(true)} disabled={!!error}>{t("memAdd")}</button>
        )}
      </div>
      {props.readOnly && <div class="card notice" role="status" data-notice="read-only"><p>{t("memReadOnly")}</p></div>}
      {props.selector}
      {!props.selector && <p class="muted project-name">{p.name}</p>}
      {props.notice && <div class="card notice" role="status" data-notice="fallback"><p>{props.notice}</p></div>}
      {error && <div class="card error-card" role="alert"><p>{t(errorKey(error))}</p></div>}

      <div class="segmented three" role="radiogroup" aria-label={t("memoryTitle")}>
        {(["memory", "pending", "archive"] as View[]).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={view === v} class={view === v ? "on" : ""} data-view={v} onClick={() => setView(v)}>
            {t(v === "memory" ? "memViewMemory" : v === "pending" ? "memViewPending" : "memViewArchive")}
            {v === "pending" && pending.length > 0 ? ` (${pending.length})` : ""}
            {v === "archive" && archived.length > 0 ? ` (${archived.length})` : ""}
          </button>
        ))}
      </div>

      {view !== "pending" && (
        <div class="mem-search">
          <input type="search" class="search" placeholder={t("memSearch")} aria-label={t("memSearch")} value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
          {view === "memory" && (
            <label class="check small-check">
              <input type="checkbox" checked={history} onChange={(e) => setHistory((e.target as HTMLInputElement).checked)} />
              <span>{t("memIncludeHistory")}</span>
            </label>
          )}
        </div>
      )}

      {view === "memory" && !searching && (
        <div class="chips" role="radiogroup" aria-label={t("memCategory")}>
          <button type="button" role="radio" aria-checked={cat === "all"} class={"chip" + (cat === "all" ? " on" : "")} onClick={() => setCat("all")}>{t("memAll")}</button>
          {CATEGORIES.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={cat === c} class={"chip" + (cat === c ? " on" : "")} data-cat={c} onClick={() => setCat(c)}>
              {t(catKey(c))} <span class="count">{counts(c)}</span>
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <p class="muted">{t("loading")}</p>
      ) : searching ? (
        hits.length === 0 ? <p class="muted center">{t("memNoResults")}</p> : (
          <ul class="list" aria-label={t("memSearch")}>
            {hits.map((h) => <EntryRow key={h.entry.id} e={h.entry} projectId={p.id} version={h.version} showCategory />)}
          </ul>
        )
      ) : view === "memory" ? (
        (cat === "all" ? CATEGORIES : [cat]).map((c) => {
          const list = sortEntries(inView.filter((e) => e.category === c));
          return (
            <div key={c} class="mem-section" data-section={c}>
              <h2 class="section-title">{t(catKey(c))} <span class="count">{list.length}</span></h2>
              {list.length === 0 ? <p class="muted empty-line">{t("memEmptyCategory")}</p> : (
                <ul class="list">{list.map((e) => <EntryRow key={e.id} e={e} projectId={p.id} />)}</ul>
              )}
            </div>
          );
        })
      ) : inView.length === 0 ? (
        <div class="card empty"><p class="lead">{t(view === "pending" ? "memEmptyPending" : "memEmptyArchive")}</p></div>
      ) : (
        <ul class="list">{sortEntries(inView).map((e) => <EntryRow key={e.id} e={e} projectId={p.id} showCategory />)}</ul>
      )}

      <div class="mem-links">
        <a class="trash-link" href={memUrl(p.id, "/istoric")}>{t("memHistoryLink")}</a>
        <a class="trash-link" href={memUrl(p.id, "/context")}>{t("memContextLink")}</a>
      </div>

      {adding && <EntryForm projectId={p.id} initialCategory={cat === "all" ? "goal" : cat} onClose={() => setAdding(false)} />}
    </section>
  );
}

function EntryRow(props: { e: MemoryEntry; projectId: string; version?: number; showCategory?: boolean }): JSX.Element {
  const { t } = useI18n();
  const e = props.e;
  const firstLine = e.body.split("\n")[0];
  return (
    <li class="row" data-entry={e.title}>
      <a class="row-main" href={memUrl(props.projectId, `/${encodeURIComponent(e.id)}`)}>
        <span class="row-title">
          <span class="row-name">{e.title}</span>
        </span>
        {firstLine && <span class="row-desc">{firstLine}</span>}
        <span class="row-meta">
          {props.showCategory && <span>{t(oneKey(e.category))} · </span>}
          {props.version !== undefined && <span class="found-old">{fill(t("memFoundInVersion"), { v: String(props.version) })} · </span>}
          <Badges e={e} />
        </span>
      </a>
    </li>
  );
}

// ---------- Create / edit ----------

function EntryForm(props: { projectId: string; entry?: MemoryEntry; initialCategory?: Category; onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  const [category, setCategory] = useState<Category>(props.entry?.category ?? props.initialCategory ?? "goal");
  const [title, setTitle] = useState(props.entry?.title ?? "");
  const [body, setBody] = useState(props.entry?.body ?? "");
  const [important, setImportant] = useState(props.entry?.important ?? false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (ev: Event) => {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (props.entry) {
        const before = props.entry.version;
        const e = await memoryStore.edit(props.entry.id, { title, body });
        toast({ text: t(e.version > before ? "memNewVersion" : "memSaved") });
      } else {
        await memoryStore.create(props.projectId, { category, title, body, important });
        toast({ text: t("memSaved") });
      }
      props.onClose();
    } catch (e) {
      setError(t(errorKey(e))); // the dialog stays open: nothing typed is lost
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={t(props.entry ? "memEditTitle" : "memNewTitle")} onClose={props.onClose} id="entry-form">
      <form onSubmit={submit} noValidate>
        {!props.entry && (
          <label class="field">
            <span>{t("memCategory")}</span>
            <select name="category" value={category} onChange={(e) => setCategory((e.target as HTMLSelectElement).value as Category)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(oneKey(c))}</option>)}
            </select>
          </label>
        )}
        <label class="field">
          <span>{t("memTitle")}</span>
          <input name="title" value={title} maxLength={TITLE_MAX * 4} autoComplete="off" autoFocus
            onInput={(e) => setTitle((e.target as HTMLInputElement).value)} aria-invalid={!!error} />
        </label>
        <label class="field">
          <span>{t("memBody")}</span>
          <textarea name="body" value={body} rows={6} maxLength={BODY_MAX * 2} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} />
        </label>
        {!props.entry && (
          <label class="check">
            <input type="checkbox" name="important" checked={important} onChange={(e) => setImportant((e.target as HTMLInputElement).checked)} />
            <span>{t("memImportantLabel")}</span>
          </label>
        )}
        {error && <p class="form-error" role="alert">{error}</p>}
        <div class="sheet-actions">
          <button type="button" class="button secondary" onClick={props.onClose}>{t("cancel")}</button>
          <button type="submit" class="button" disabled={busy}>{t("save")}</button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------- Entry page ----------

type Dlg = null | "edit" | "reject" | "purge" | "link" | "replace" | "resolve" | { unlink: MemoryLink };

export function EntryPage(props: { projectId: string; entryId: string }): JSX.Element {
  const { t } = useI18n();
  const { entries, links, versions, loading } = useMemory(props.projectId);
  const { projects } = useProjects();
  const readOnly = !!projects.find((x) => x.id === props.projectId)?.deletedAt;
  const [dlg, setDlg] = useState<Dlg>(null);
  const [dlgError, setDlgError] = useState<string | null>(null);
  const run = useRun();
  const date = useDate();
  const e = entries.find((x) => x.id === props.entryId);
  const byId = new Map(entries.map((x) => [x.id, x]));
  const back = <a class="back" href={memUrl(props.projectId)}>‹ {t("memBackToMemory")}</a>;
  if (loading) return <section>{back}<p class="muted">{t("loading")}</p></section>;
  if (!e) return <section>{back}<div class="card empty"><p class="lead">{t("le_missing")}</p></div></section>;

  const mine = links.filter((l) => l.from === e.id || l.to === e.id);
  const vs = [...(versions.get(e.id) ?? [])].reverse();
  const close = () => { setDlg(null); setDlgError(null); };
  const official = isOfficial(e);

  return (
    <section data-entry-page={e.id}>
      {back}
      <p class="muted kicker">{t(oneKey(e.category))}</p>
      <h1 class="large-title project-title">{e.title}</h1>
      <Badges e={e} />

      {readOnly && <div class="card notice" role="status" data-notice="read-only"><p>{t("memReadOnly")}</p></div>}
      {!readOnly && e.confirmation === "pending" && (
        <div class="card notice" role="status">
          <p>{t("memPendingText")}</p>
          <div class="actions">
            <button type="button" class="button" onClick={() => run(() => memoryStore.confirm(e.id), "memConfirmed")}>{t("memConfirm")}</button>
            <button type="button" class="button secondary danger-text" onClick={() => setDlg("reject")}>{t("memReject")}</button>
          </div>
        </div>
      )}
      {e.confirmation === "rejected" && <div class="card notice"><p>{t("memRejectedText")}</p></div>}

      {e.body && <p class="description entry-body">{e.body}</p>}

      {!readOnly && <div class="actions">
        {e.confirmation !== "rejected" && !e.archived && <button type="button" class="button secondary" onClick={() => setDlg("edit")}>{t("edit")}</button>}
        {!e.archived && e.confirmation !== "rejected" && (
          <button type="button" class="button secondary" onClick={() => run(() => memoryStore.setImportant(e.id, !e.important))}>
            {t(e.important ? "memUnmarkImportant" : "memMarkImportant")}
          </button>
        )}
        {official && e.category === "decision" && e.status === "active" && (
          <button type="button" class="button secondary" data-action="replace" onClick={() => setDlg("replace")}>{t("memReplace")}</button>
        )}
        {official && e.category === "issue" && e.status === "active" && (
          <button type="button" class="button secondary" data-action="resolve" onClick={() => setDlg("resolve")}>{t("memResolve")}</button>
        )}
        {official && <button type="button" class="button secondary" data-action="link" onClick={() => setDlg("link")}>{t("memAddLink")}</button>}
        {!e.archived ? (
          <button type="button" class="button secondary" data-action="archive" onClick={() => run(() => memoryStore.archive(e.id), "memArchived")}>{t("memArchive")}</button>
        ) : (
          <>
            {e.confirmation !== "rejected" && (
              <button type="button" class="button secondary" data-action="restore" onClick={() => run(() => memoryStore.restore(e.id), "memRestored")}>{t("memRestore")}</button>
            )}
            <button type="button" class="button secondary danger-text" data-action="purge" onClick={() => setDlg("purge")}>{t("deleteForever")}</button>
          </>
        )}
      </div>}

      <div class="card" data-card="links">
        <h2>{t("memLinks")}</h2>
        {mine.length === 0 ? <p class="muted">{t("memNoLinks")}</p> : (
          <ul class="link-list">
            {mine.map((l) => {
              const out = l.from === e.id;
              const other = byId.get(out ? l.to : l.from);
              return (
                <li key={l.id} data-link={l.type}>
                  <span class="link-label">{t(`lnk_${l.type}_${out ? "out" : "in"}` as Key)}:</span>{" "}
                  {other ? <a href={memUrl(props.projectId, `/${encodeURIComponent(other.id)}`)}>{other.title}</a> : <span class="muted">—</span>}
                  {other?.archived && <span class="muted"> ({t("memArchivedBadge")})</span>}
                  {l.reason && <span class="muted link-reason"> — {l.reason}</span>}
                  {!readOnly && <button type="button" class="icon-button small" aria-label={`${t("memRemoveLink")}: ${other?.title ?? ""}`} onClick={() => setDlg({ unlink: l })}>×</button>}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div class="card" data-card="provenance">
        <h2>{t("memProvenance")}</h2>
        <dl class="facts">
          <dt>{t("memAuthor")}</dt><dd>{t(e.author === "user" ? "memAuthorUser" : "memAuthorAi")}</dd>
          <dt>{t("memSource")}</dt><dd>{e.source ?? t("memSourceNone")}</dd>
          <dt>{t("memConfirmation")}</dt>
          <dd>{e.confirmation === "confirmed" ? `${t("memConfirmedOn")} ${date(e.confirmedAt!)}` : t(e.confirmation === "pending" ? "memPendingBadge" : "memRejectedBadge")}</dd>
          <dt>{t("createdOn")}</dt><dd>{date(e.createdAt)}</dd>
          <dt>{t("updatedOn")}</dt><dd>{date(e.updatedAt)}</dd>
          <dt>{t("memVersion")}</dt><dd>{e.version}</dd>
        </dl>
      </div>

      <div class="card" data-card="versions">
        <h2>{t("memVersions")}</h2>
        <p class="muted">{t("memVersionsHint")}</p>
        <ol class="versions">
          {vs.map((v) => (
            <li key={v.seq} data-version={v.version} class={v.current ? "current" : ""}>
              <details open={v.current}>
                <summary>{t("memVersion")} {v.version}{v.current ? ` (${t("memCurrent")})` : ""} · {date(v.ts)}</summary>
                <p class="row-name">{v.title}</p>
                {v.body && <p class="description">{v.body}</p>}
              </details>
            </li>
          ))}
        </ol>
      </div>

      {dlg === "edit" && <EntryForm projectId={props.projectId} entry={e} onClose={close} />}
      {dlg === "reject" && (
        <Confirm title={t("memRejectTitle")} text={t("memRejectText")} confirm={t("memReject")} cancel={t("cancel")} danger onClose={close}
          onConfirm={async () => { if (await run(() => memoryStore.reject(e.id), "memRejectedToast")) close(); }} />
      )}
      {dlg === "purge" && (
        <Confirm title={t("memPurgeTitle")} text={`„${e.title}”. ${t("memPurgeText")}`} check={t("confirmPurgeCheck")} confirm={t("deleteForever")}
          cancel={t("cancel")} danger error={dlgError} onClose={close}
          onConfirm={async () => {
            try {
              await memoryStore.purge(e.id);
              toast({ text: t("memPurged") });
              location.hash = memUrl(props.projectId).slice(1);
            } catch (err) {
              setDlgError(t(errorKey(err)));
            }
          }} />
      )}
      {dlg && typeof dlg === "object" && (
        <Confirm title={t("memRemoveLinkTitle")} text={t("memRemoveLinkText")} confirm={t("memRemoveLink")} cancel={t("cancel")} onClose={close}
          onConfirm={async () => { if (await run(() => memoryStore.unlink(dlg.unlink.id))) close(); }} />
      )}
      {dlg === "link" && <LinkForm entry={e} entries={entries} onClose={close} />}
      {dlg === "replace" && <ReplaceForm entry={e} onClose={close} />}
      {dlg === "resolve" && <ResolveForm entry={e} entries={entries} onClose={close} />}
    </section>
  );
}

function LinkForm(props: { entry: MemoryEntry; entries: MemoryEntry[]; onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  const [type, setType] = useState<LinkType>("related_to");
  const eligible = sortEntries(props.entries.filter((x) => x.id !== props.entry.id && isOfficial(x)
    && (type !== "replaces" || (x.category === "decision" && x.status === "active"))
    && (type !== "resolves" || x.category === "issue")));
  const [target, setTarget] = useState<string>("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const chosen = eligible.find((x) => x.id === target) ?? eligible[0];
  return (
    <Dialog title={t("memAddLink")} onClose={props.onClose} id="link-form">
      <form noValidate onSubmit={async (ev) => {
        ev.preventDefault();
        if (!chosen) return;
        try {
          await memoryStore.link(props.entry.id, chosen.id, type, reason);
          toast({ text: t("memLinked") });
          props.onClose();
        } catch (err) {
          setError(t(errorKey(err)));
        }
      }}>
        <label class="field">
          <span>{t("memLinkType")}</span>
          <select name="type" value={type} onChange={(e) => { setType((e.target as HTMLSelectElement).value as LinkType); setTarget(""); setError(null); }}>
            {LINK_TYPES.map((lt) => <option key={lt} value={lt}>{t(`lt_${lt}` as Key)}</option>)}
          </select>
        </label>
        {type === "replaces" && <p class="muted">{t("memReplaceText")}</p>}
        {eligible.length === 0 ? <p class="muted">{t("memLinkNoTargets")}</p> : (
          <label class="field">
            <span>{t("memLinkTarget")}</span>
            <select name="target" value={chosen?.id} onChange={(e) => setTarget((e.target as HTMLSelectElement).value)}>
              {eligible.map((x) => <option key={x.id} value={x.id}>{t(oneKey(x.category))}: {x.title}</option>)}
            </select>
          </label>
        )}
        <label class="field">
          <span>{t("memLinkReason")}</span>
          <input name="reason" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} />
        </label>
        {error && <p class="form-error" role="alert">{error}</p>}
        <div class="sheet-actions">
          <button type="button" class="button secondary" onClick={props.onClose}>{t("cancel")}</button>
          <button type="submit" class="button" disabled={!chosen}>{t("memAddLink").replace("…", "")}</button>
        </div>
      </form>
    </Dialog>
  );
}

function ReplaceForm(props: { entry: MemoryEntry; onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={t("memReplaceTitle")} onClose={props.onClose} id="replace-form">
      <form noValidate onSubmit={async (ev) => {
        ev.preventDefault();
        try {
          const { entry } = await memoryStore.replaceDecision(props.entry.id, { title, body }, reason);
          toast({ text: t("memReplaced") });
          props.onClose();
          location.hash = memUrl(entry.projectId, `/${encodeURIComponent(entry.id)}`).slice(1);
        } catch (err) {
          setError(t(errorKey(err)));
        }
      }}>
        <p>„{props.entry.title}”. {t("memReplaceText")}</p>
        <label class="field"><span>{t("memTitle")}</span>
          <input name="title" value={title} autoFocus onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></label>
        <label class="field"><span>{t("memBody")}</span>
          <textarea name="body" rows={4} value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} /></label>
        <label class="field"><span>{t("memReplaceReason")}</span>
          <input name="reason" value={reason} onInput={(e) => setReason((e.target as HTMLInputElement).value)} /></label>
        {error && <p class="form-error" role="alert">{error}</p>}
        <div class="sheet-actions">
          <button type="button" class="button secondary" onClick={props.onClose}>{t("cancel")}</button>
          <button type="submit" class="button">{t("memReplaceDo")}</button>
        </div>
      </form>
    </Dialog>
  );
}

function ResolveForm(props: { entry: MemoryEntry; entries: MemoryEntry[]; onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  const eligible = sortEntries(props.entries.filter((x) => isOfficial(x) && x.category !== "issue"));
  const [mode, setMode] = useState<"existing" | "new">(eligible.length ? "existing" : "new");
  const [target, setTarget] = useState(eligible[0]?.id ?? "");
  const [category, setCategory] = useState<Category>("step");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog title={t("memResolveTitle")} onClose={props.onClose} id="resolve-form">
      <form noValidate onSubmit={async (ev) => {
        ev.preventDefault();
        try {
          await memoryStore.resolveIssue(props.entry.id, mode === "existing" ? { entryId: target } : { category, title, body });
          toast({ text: t("memResolvedToast") });
          props.onClose();
        } catch (err) {
          setError(t(errorKey(err)));
        }
      }}>
        <p>{t("memResolveText")}</p>
        <div class="segmented" role="radiogroup" aria-label={t("memResolveTitle")}>
          {(["existing", "new"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} class={mode === m ? "on" : ""} disabled={m === "existing" && !eligible.length}
              onClick={() => setMode(m)}>{t(m === "existing" ? "memResolveExisting" : "memResolveNew")}</button>
          ))}
        </div>
        {mode === "existing" ? (
          <label class="field"><span>{t("memLinkTarget")}</span>
            <select name="target" value={target} onChange={(e) => setTarget((e.target as HTMLSelectElement).value)}>
              {eligible.map((x) => <option key={x.id} value={x.id}>{t(oneKey(x.category))}: {x.title}</option>)}
            </select></label>
        ) : (
          <>
            <label class="field"><span>{t("memCategory")}</span>
              <select name="category" value={category} onChange={(e) => setCategory((e.target as HTMLSelectElement).value as Category)}>
                {CATEGORIES.filter((c) => c !== "issue").map((c) => <option key={c} value={c}>{t(oneKey(c))}</option>)}
              </select></label>
            <label class="field"><span>{t("memTitle")}</span>
              <input name="title" value={title} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></label>
            <label class="field"><span>{t("memBody")}</span>
              <textarea name="body" rows={3} value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} /></label>
          </>
        )}
        {error && <p class="form-error" role="alert">{error}</p>}
        <div class="sheet-actions">
          <button type="button" class="button secondary" onClick={props.onClose}>{t("cancel")}</button>
          <button type="submit" class="button">{t("memResolveDo")}</button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------- History + integrity ----------

export function MemoryHistory(props: { projectId: string }): JSX.Element {
  const { t } = useI18n();
  const date = useDate();
  const { entries, links } = useMemory(props.projectId);
  const [events, setEvents] = useState<JournalEvent[] | null>(null);
  const [report, setReport] = useState<(IntegrityReport & { inconsistencies: string[] }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => memoryStore.timeline(props.projectId).then((e) => alive && setEvents(e.reverse()), () => alive && setEvents([]));
    load();
    const off = memoryStore.subscribe(load);
    return () => { alive = false; off(); };
  }, [props.projectId]);
  const titles = new Map<string, string>();
  for (const e of entries) titles.set(e.id, e.title);
  const linkById = new Map(links.map((l) => [l.id, l]));
  const label = (ev: JournalEvent): string => {
    if (ev.type.startsWith("link.")) {
      const d = (ev.data ?? linkById.get(ev.entityId ?? "")) as { from?: string; to?: string; type?: LinkType } | null;
      if (!d?.from) return t("histErased");
      return `${titles.get(d.from) ?? "—"} → ${t(`lnk_${d.type}_out` as Key)} → ${titles.get(d.to!) ?? "—"}`;
    }
    const d = ev.data as { title?: string } | null;
    return titles.get(ev.entityId ?? "") ?? d?.title ?? t("histErased");
  };
  const detail = (r: IntegrityReport & { inconsistencies: string[] }) => {
    const parts: string[] = [];
    if (r.problem) parts.push(fill(t(`prob_${r.problem}` as Key), { n: String(r.at ?? "?") }));
    if (r.checkpoint === "behind") parts.push(t("intCheckpointBehind"));
    if (r.checkpoint === "mismatch") parts.push(t("intCheckpointMismatch"));
    if (r.inconsistencies.length) parts.push(fill(t("intInconsistent"), { n: String(r.inconsistencies.length) }));
    return parts.join("; ");
  };
  return (
    <section>
      <a class="back" href={memUrl(props.projectId)}>‹ {t("memBackToMemory")}</a>
      <h1 class="large-title">{t("histTitle")}</h1>
      <div class="card" data-card="integrity">
        <h2>{t("intTitle")}</h2>
        {report && !report.ok && (
          <p class="form-error" role="status" data-integrity="bad">{fill(t("intBad"), { detail: detail(report) })}</p>
        )}
        {report?.ok && report.checkpoint === "missing" && (
          <p class="warn-text" role="status" data-integrity="partial">{fill(t("intPartial"), { n: String(report.events) })}</p>
        )}
        {report?.ok && report.checkpoint === "ok" && (
          <p class="ok-text" role="status" data-integrity="ok">{fill(t("intOk"), { n: String(report.events) })}</p>
        )}
        {report && report.erased > 0 && <p class="muted">{fill(t("intErasedInfo"), { n: String(report.erased) })}</p>}
        {failed && <p class="form-error" role="alert">{t("intError")}</p>}
        <p class="muted">{t("intLimits")}</p>
        <button type="button" class="button secondary small-button" disabled={busy} data-action="verify"
          onClick={async () => {
            setBusy(true);
            setFailed(false);
            try {
              setReport(await memoryStore.verify(props.projectId));
            } catch {
              setReport(null);
              setFailed(true);
            } finally {
              setBusy(false);
            }
          }}>
          {t("intRun")}
        </button>
      </div>
      {events && events.length === 0 && <div class="card empty"><p class="lead">{t("histEmpty")}</p></div>}
      {events && events.length > 0 && (
        <ol class="list timeline">
          {events.map((ev) => (
            <li key={ev.seq} class="row" data-event={ev.type}>
              <div class="row-main">
                <span class="row-name">{label(ev)}</span>
                <span class="row-meta">{t(`ev_${ev.type.replace(".", "_")}` as Key)} · {date(ev.ts)}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ---------- Context preview (for AIW-05) ----------

export function ContextPreview(props: { projectId: string }): JSX.Element {
  const { t, lang } = useI18n();
  const { projects } = useProjects();
  const { entries, links } = useMemory(props.projectId);
  const [maxChars, setMaxChars] = useState(DEFAULT_MAX_CHARS);
  const [closed, setClosed] = useState(false);
  const p = projects.find((x) => x.id === props.projectId);
  const ctx = useMemo(() => (p ? buildContext(p, entries, links, { maxChars, includeClosed: closed }) : null), [p, entries, links, maxChars, closed]);
  const nf = new Intl.NumberFormat(lang);
  return (
    <section>
      <a class="back" href={memUrl(props.projectId)}>‹ {t("memBackToMemory")}</a>
      <h1 class="large-title">{t("ctxTitle")}</h1>
      <p class="muted">{t("ctxIntro")}</p>
      <div class="card">
        <label class="field"><span>{t("ctxLimit")}</span>
          <select name="limit" value={String(maxChars)} onChange={(e) => setMaxChars(Number((e.target as HTMLSelectElement).value))}>
            {[2000, 8000, 24000, 48000].map((n) => <option key={n} value={n}>{nf.format(n)}</option>)}
          </select></label>
        <label class="check"><input type="checkbox" checked={closed} onChange={(e) => setClosed((e.target as HTMLInputElement).checked)} /><span>{t("ctxIncludeClosed")}</span></label>
        {ctx && <p class="muted" data-chars={ctx.stats.chars}>{fill(t("ctxChars"), { n: nf.format(ctx.stats.chars), max: nf.format(ctx.stats.maxChars) })}</p>}
      </div>
      {ctx && (
        <>
          <h2 class="section-title">{fill(t("ctxIncluded"), { n: String(ctx.stats.included) })}</h2>
          {ctx.payload.sections.map((s) => (
            <div key={s.category} class="card" data-ctx-section={s.category}>
              <h2>{t(catKey(s.category))}</h2>
              <ul class="plain">{s.items.map((i) => <li key={i.id} data-ctx-item={i.title}>{i.important ? "★ " : ""}{i.title}</li>)}</ul>
            </div>
          ))}
          <h2 class="section-title">{fill(t("ctxOmitted"), { n: String(ctx.omitted.length) })}</h2>
          {ctx.omitted.length === 0 ? <p class="muted">{t("ctxNoneOmitted")}</p> : (
            <ul class="list">
              {ctx.omitted.map((o) => (
                <li key={o.id} class="row" data-omitted={o.title}>
                  <div class="row-main"><span class="row-name">{o.title}</span>
                    <span class="row-meta">{t(oneKey(o.category))} · {t(`om_${o.reason}` as Key)}</span></div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

// ---------- Card on the project page ----------

export function MemoryCard(props: { projectId: string }): JSX.Element {
  const { t } = useI18n();
  const { entries } = useMemory(props.projectId);
  const current = entries.filter((e) => e.confirmation === "confirmed" && !e.archived);
  const pending = entries.filter((e) => e.confirmation === "pending").length;
  return (
    <div class="card" data-card="memory">
      <h2>{t("memCardTitle")}</h2>
      {current.length === 0 ? <p class="muted">{t("memCardEmpty")}</p> : (
        <ul class="counts">
          {CATEGORIES.map((c) => {
            const n = current.filter((e) => e.category === c).length;
            return n ? <li key={c}>{t(catKey(c))}: <strong>{n}</strong></li> : null;
          })}
        </ul>
      )}
      {pending > 0 && <p class="muted">{t("memViewPending")}: {pending}</p>}
      <a class="button secondary small-button link-button" href={memUrl(props.projectId)} data-action="open-memory">{t("memOpen")}</a>
    </div>
  );
}


