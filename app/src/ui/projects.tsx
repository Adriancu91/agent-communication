// Project manager screens: list (search, order, pin), project page, trash, create/edit dialogs.
import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";
import { DESCRIPTION_MAX, matches, NAME_MAX, sortProjects, type Project, type SortOrder } from "../core";
import { askPersistOnce, errorKey, isIOS, store, useProjects } from "./data";
import { useI18n } from "./i18n";
import { IconMore, IconPin } from "./icons";
import { Confirm, Dialog, toast } from "./widgets";

const SORT_KEY = "aiw.sort";
const IOS_NOTICE_KEY = "aiw.iosNotice";

function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* not fatal */
  }
}

export function useDate(): (iso: string) => string {
  const { lang } = useI18n();
  const f = useMemo(() => new Intl.DateTimeFormat(lang === "ro" ? "ro-RO" : "en-GB", { dateStyle: "medium", timeStyle: "short" }), [lang]);
  return (iso) => f.format(new Date(iso));
}

/** Runs a store action; on failure shows the reason and returns false (nothing was changed). */
function useAction() {
  const { t } = useI18n();
  return async (fn: () => Promise<unknown>, ok?: Parameters<typeof toast>[0]): Promise<boolean> => {
    try {
      await fn();
      if (ok) toast(ok);
      return true;
    } catch (e) {
      toast({ text: t(errorKey(e)), error: true });
      return false;
    }
  };
}

// ---------- Create / edit ----------

export function ProjectForm(props: { project?: Project; onClose: () => void; onSaved?: (p: Project) => void }): JSX.Element {
  const { t } = useI18n();
  const [name, setName] = useState(props.project?.name ?? "");
  const [description, setDescription] = useState(props.project?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let p: Project;
      if (props.project) {
        p = await store.rename(props.project.id, name);
        p = await store.setDescription(p.id, description);
      } else {
        p = await store.create(name, description);
        void askPersistOnce();
      }
      props.onSaved?.(p);
      props.onClose();
    } catch (err) {
      setError(t(errorKey(err))); // the dialog stays open: nothing typed is lost
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title={t(props.project ? "editProjectTitle" : "newProjectTitle")} onClose={props.onClose} id="project-form">
      <form onSubmit={submit} noValidate>
        <label class="field">
          <span>{t("nameLabel")}</span>
          <input
            name="name"
            value={name}
            maxLength={NAME_MAX * 4}
            autoComplete="off"
            enterKeyHint="done"
            placeholder={t("namePlaceholder")}
            autoFocus
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            aria-invalid={!!error}
          />
        </label>
        <label class="field">
          <span>{t("descriptionLabel")}</span>
          <textarea
            name="description"
            value={description}
            rows={3}
            maxLength={DESCRIPTION_MAX * 4}
            onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)}
          />
        </label>
        {error && <p class="form-error" role="alert">{error}</p>}
        <div class="sheet-actions">
          <button type="button" class="button secondary" onClick={props.onClose}>{t("cancel")}</button>
          <button type="submit" class="button" disabled={busy}>{t(props.project ? "save" : "create")}</button>
        </div>
      </form>
    </Dialog>
  );
}

// ---------- Actions (⋯ menu, trash confirmation) ----------

type Pending = { kind: "menu" | "edit" | "trash"; project: Project } | null;

function ProjectDialogs(props: { pending: Pending; set: (p: Pending) => void; afterTrash?: () => void }): JSX.Element | null {
  const { t } = useI18n();
  const run = useAction();
  const p = props.pending;
  if (!p) return null;
  const close = () => props.set(null);
  if (p.kind === "edit") return <ProjectForm project={p.project} onClose={close} />;
  if (p.kind === "trash") {
    return (
      <Confirm
        title={t("confirmTrashTitle")}
        text={`„${p.project.name}”. ${t("confirmTrashText")}`}
        confirm={t("moveToTrash")}
        cancel={t("cancel")}
        danger
        onClose={close}
        onConfirm={async () => {
          const ok = await run(() => store.trash(p.project.id), {
            text: t("movedToTrash"),
            action: { label: t("undo"), run: () => void run(() => store.restore(p.project.id)) },
          });
          close();
          if (ok) props.afterTrash?.();
        }}
      />
    );
  }
  return (
    <Dialog title={p.project.name} onClose={close} id="project-menu">
      <div class="menu">
        <a class="menu-item" href={`#/proiect/${encodeURIComponent(p.project.id)}`} onClick={close}>{t("open")}</a>
        <button type="button" class="menu-item" onClick={() => props.set({ kind: "edit", project: p.project })}>{t("edit")}</button>
        <button type="button" class="menu-item" onClick={async () => {
          close();
          await run(() => store.setPinned(p.project.id, !p.project.pinned));
        }}>{t(p.project.pinned ? "unpin" : "pin")}</button>
        <button type="button" class="menu-item danger" onClick={() => props.set({ kind: "trash", project: p.project })}>{t("moveToTrash")}</button>
      </div>
      <div class="sheet-actions single">
        <button type="button" class="button secondary" onClick={close}>{t("close")}</button>
      </div>
    </Dialog>
  );
}

// ---------- List ----------

export function ProjectsScreen(): JSX.Element {
  const { t, lang } = useI18n();
  const { projects, loading, error } = useProjects();
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<SortOrder>(readPref(SORT_KEY) === "alpha" ? "alpha" : "recent");
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<Pending>(null);
  const [iosNotice, setIosNotice] = useState(() => isIOS() && !readPref(IOS_NOTICE_KEY));
  const date = useDate();

  const active = projects.filter((p) => !p.deletedAt);
  const trashed = projects.length - active.length;
  const shown = useMemo(() => sortProjects(active.filter((p) => matches(p, query)), order, lang), [projects, query, order, lang]);

  const newButton = (
    <button type="button" class="button" data-action="new-project" disabled={!!error} onClick={() => setCreating(true)}>
      {t("projectsNew")}
    </button>
  );

  return (
    <section>
      <div class="title-row">
        <h1 class="large-title">{t("projectsTitle")}</h1>
        {active.length > 0 && newButton}
      </div>

      {iosNotice && (
        <div class="card notice" data-notice="ios">
          <h2>{t("iosNoticeTitle")}</h2>
          <p>{t("iosNoticeText")}</p>
          <button type="button" class="button secondary small-button" onClick={() => {
            writePref(IOS_NOTICE_KEY, "1");
            setIosNotice(false);
          }}>{t("understood")}</button>
        </div>
      )}

      {error && (
        <div class="card error-card" role="alert">
          <p>{t(errorKey(error))}</p>
          <button type="button" class="button secondary small-button" onClick={() => location.reload()}>{t("reload")}</button>
        </div>
      )}

      {loading ? (
        <p class="muted">{t("loading")}</p>
      ) : active.length === 0 && !error ? (
        <div class="card empty">
          <p class="lead">{t("projectsEmpty")}</p>
          <p class="muted">{t("projectsEmptyHint")}</p>
          {newButton}
        </div>
      ) : (
        active.length > 0 && (
          <>
            <div class="toolbar">
              <input
                type="search"
                class="search"
                placeholder={t("projectsSearch")}
                aria-label={t("projectsSearch")}
                value={query}
                onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              />
              <div class="segmented compact" role="radiogroup" aria-label={t("sortLabel")}>
                {(["recent", "alpha"] as SortOrder[]).map((o) => (
                  <button key={o} type="button" role="radio" aria-checked={order === o} class={order === o ? "on" : ""}
                    onClick={() => { setOrder(o); writePref(SORT_KEY, o); }}>
                    {t(o === "recent" ? "sortRecent" : "sortAlpha")}
                  </button>
                ))}
              </div>
            </div>
            {shown.length === 0 ? (
              <p class="muted center">{t("noResults")}</p>
            ) : (
              <ul class="list" aria-label={t("projectsTitle")}>
                {shown.map((p) => (
                  <li key={p.id} class="row" data-project={p.name}>
                    <a class="row-main" href={`#/proiect/${encodeURIComponent(p.id)}`}>
                      <span class="row-title">
                        {p.pinned && <span class="pin" title={t("pinnedLabel")} aria-label={t("pinnedLabel")}><IconPin /></span>}
                        <span class="row-name">{p.name}</span>
                      </span>
                      {p.description && <span class="row-desc">{p.description}</span>}
                      <span class="row-meta">{t("updatedOn")} {date(p.updatedAt)}</span>
                    </a>
                    <button type="button" class="icon-button" aria-label={`${t("moreActions")} ${p.name}`}
                      onClick={() => setPending({ kind: "menu", project: p })}>
                      <IconMore />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )
      )}

      <a class="trash-link" href="#/cos" data-trash-count={trashed}>
        {t("trash")}{trashed > 0 ? ` (${trashed})` : ""}
      </a>

      {creating && <ProjectForm onClose={() => setCreating(false)} />}
      <ProjectDialogs pending={pending} set={setPending} />
    </section>
  );
}

// ---------- Project page ----------

export function ProjectPage(props: { id: string }): JSX.Element {
  const { t } = useI18n();
  const { projects, loading } = useProjects();
  const [pending, setPending] = useState<Pending>(null);
  const run = useAction();
  const date = useDate();
  const p = projects.find((x) => x.id === props.id);

  return (
    <section>
      <a class="back" href="#/proiecte">‹ {t("back")}</a>
      {loading ? (
        <p class="muted">{t("loading")}</p>
      ) : !p ? (
        <div class="card empty"><p class="lead">{t("projectMissing")}</p></div>
      ) : (
        <>
          <h1 class="large-title project-title">
            {p.pinned && <span class="pin" aria-label={t("pinnedLabel")}><IconPin /></span>}
            {p.name}
          </h1>
          {p.deletedAt && (
            <div class="card notice" role="status">
              <p>{t("inTrashBanner")}</p>
              <button type="button" class="button small-button" onClick={() => run(() => store.restore(p.id), { text: t("restored") })}>
                {t("restore")}
              </button>
            </div>
          )}
          {p.description && <p class="description">{p.description}</p>}
          <p class="muted small-left">
            {t("createdOn")} {date(p.createdAt)} · {t("updatedOn")} {date(p.updatedAt)}
          </p>
          {!p.deletedAt && (
            <div class="actions">
              <button type="button" class="button secondary" onClick={() => setPending({ kind: "edit", project: p })}>{t("edit")}</button>
              <button type="button" class="button secondary" onClick={() => run(() => store.setPinned(p.id, !p.pinned))}>
                {t(p.pinned ? "unpin" : "pin")}
              </button>
              <button type="button" class="button secondary danger-text" onClick={() => setPending({ kind: "trash", project: p })}>
                {t("moveToTrash")}
              </button>
            </div>
          )}
          <div class="card">
            <h2>{t("projectContent")}</h2>
            <p class="muted">{t("projectContentHint")}</p>
            <span class="badge">{t("comingSoon")}</span>
          </div>
          {p.nameHistory.length > 0 && (
            <div class="card">
              <h2>{t("nameHistory")}</h2>
              <ul class="history">
                {[...p.nameHistory].reverse().map((h) => (
                  <li key={h.until}>
                    <span class="row-name">{h.name}</span> <span class="muted">· {t("until")} {date(h.until)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <ProjectDialogs pending={pending} set={setPending} afterTrash={() => (location.hash = "#/proiecte")} />
    </section>
  );
}

// ---------- Trash ----------

export function TrashScreen(): JSX.Element {
  const { t } = useI18n();
  const { projects, loading } = useProjects();
  const [purging, setPurging] = useState<Project | null>(null);
  const [purgeError, setPurgeError] = useState<string | null>(null);
  const run = useAction();
  const date = useDate();
  const trashed = projects.filter((p) => p.deletedAt).sort((a, b) => b.deletedAt!.localeCompare(a.deletedAt!));

  return (
    <section>
      <a class="back" href="#/proiecte">‹ {t("back")}</a>
      <h1 class="large-title">{t("trashTitle")}</h1>
      <p class="muted">{t("trashHint")}</p>
      {loading ? null : trashed.length === 0 ? (
        <div class="card empty"><p class="lead">{t("trashEmpty")}</p></div>
      ) : (
        <ul class="list" aria-label={t("trashTitle")}>
          {trashed.map((p) => (
            <li key={p.id} class="row trash-row" data-project={p.name}>
              <div class="row-main">
                <span class="row-name">{p.name}</span>
                <span class="row-meta">{t("trashedOn")} {date(p.deletedAt!)}</span>
              </div>
              <div class="row-actions">
                <button type="button" class="button secondary small-button" onClick={() => run(() => store.restore(p.id), { text: t("restored") })}>
                  {t("restore")}
                </button>
                <button type="button" class="button secondary small-button danger-text" onClick={() => { setPurgeError(null); setPurging(p); }}>
                  {t("deleteForever")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {purging && (
        <Confirm
          title={t("confirmPurgeTitle")}
          text={`„${purging.name}”. ${t("confirmPurgeText")}`}
          check={t("confirmPurgeCheck")}
          confirm={t("deleteForever")}
          cancel={t("cancel")}
          danger
          error={purgeError}
          onClose={() => setPurging(null)}
          onConfirm={async () => {
            try {
              await store.purge(purging.id);
              setPurging(null);
              toast({ text: t("purged") });
            } catch (e) {
              setPurgeError(t(errorKey(e)));
            }
          }}
        />
      )}
    </section>
  );
}
