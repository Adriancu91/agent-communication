// AIW-04 screens: export (one project / all), and import with a preview and a choice per project.
import type { JSX } from "preact";
import { useRef, useState } from "preact/hooks";
import { CATEGORIES } from "../core";
import {
  ArchiveError, ImportError, MAX_ARCHIVE_BYTES, TransferService, ZipError,
  type ImportChoice, type ImportPreview, type PreviewProject, type ProjectFile,
} from "../archive";
import { base, errorKey } from "./data";
import { fill, useDate, useI18n, type Key } from "./i18n";
import { Dialog, toast } from "./widgets";

export const transfer = new TransferService(base, __APP_VERSION__);

/** The text explaining why an archive was refused or an import failed. */
export function transferErrorKey(e: unknown): Key {
  if (e instanceof ZipError) {
    if (e.problem === "notZip") return "imp_notZip";
    if (e.problem === "tooLarge" || e.problem === "tooManyFiles") return "imp_tooLarge";
    if (e.problem === "unsupportedMethod" || e.problem === "encrypted" || e.problem === "zip64") return "imp_unsupported";
    return "imp_damaged";
  }
  if (e instanceof ArchiveError) {
    if (e.problem === "notAiw") return "imp_notAiw";
    if (e.problem === "newerVersion") return "imp_newer";
    return "imp_damaged";
  }
  if (e instanceof ImportError) return e.reason === "changed" ? "imp_changed" : e.reason === "idConflict" ? "imp_idConflict" : "imp_nothing";
  return errorKey(e);
}

// ---------- export ----------

interface Ready { file: File; count: number }

/** Builds the archive, then shows a dialog with the download (a fresh tap: some phones need it to save a file). */
export function useExport(): { start: (ids: string[] | "all") => Promise<void>; busy: boolean; dialog: JSX.Element | null } {
  const { t } = useI18n();
  const [ready, setReady] = useState<Ready | null>(null);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const start = async (ids: string[] | "all") => {
    if (running.current) return; // one export at a time
    running.current = true;
    setBusy(true);
    try {
      const { bytes, fileName, count } = await transfer.exportArchive(ids);
      setReady({ file: new File([bytes as BlobPart], fileName, { type: "application/zip" }), count });
    } catch (e) {
      toast({ text: t(transferErrorKey(e)), error: true });
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const dialog = ready ? <ExportReady ready={ready} onClose={() => setReady(null)} /> : null;
  return { start, busy, dialog };
}

function ExportReady(props: { ready: Ready; onClose: () => void }): JSX.Element {
  const { t } = useI18n();
  const { file, count } = props.ready;
  const canShare = typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });
  const download = () => {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };
  return (
    <Dialog title={t("exportReadyTitle")} onClose={props.onClose} id="export-ready">
      <p>{fill(t("exportReadyText"), { n: String(count) })}</p>
      <p class="muted small-left" data-file={file.name}>{file.name} · {Math.max(1, Math.round(file.size / 1024))} KB</p>
      <p class="muted">{t("exportPrivacy")}</p>
      <div class="sheet-actions">
        {canShare && (
          <button type="button" class="button secondary" data-action="share-export" onClick={() => {
            navigator.share({ files: [file], title: file.name }).catch(() => undefined);
          }}>{t("exportShare")}</button>
        )}
        <button type="button" class="button" data-action="download-export" onClick={download}>{t("exportDownload")}</button>
      </div>
      <div class="sheet-actions single">
        <button type="button" class="button secondary" onClick={props.onClose}>{t("close")}</button>
      </div>
    </Dialog>
  );
}

// ---------- import ----------

export function ImportButton(): JSX.Element {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    if (input.current) input.current.value = ""; // the same file can be chosen again
    if (f.size > MAX_ARCHIVE_BYTES) {
      setError(t("imp_tooLarge")); // refused before reading it into memory
      return;
    }
    setBusy(true);
    try {
      setPreview(await transfer.preview(new Uint8Array(await f.arrayBuffer())));
    } catch (e) {
      setError(t(transferErrorKey(e)));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <input ref={input} type="file" accept=".zip,application/zip" hidden id="import-file"
        onChange={(e) => void pick((e.target as HTMLInputElement).files?.[0])} />
      <button type="button" class="button secondary" data-action="import" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? t("importChecking") : t("importButton")}
      </button>
      {error && <p class="form-error" role="alert" data-import-error>{error}</p>}
      {preview && (
        <ImportDialog preview={preview} onClose={() => setPreview(null)} onStale={(msg) => {
          setPreview(null); // the preview no longer matches this device: it must be read again
          setError(msg);
        }} />
      )}
    </>
  );
}

const CHOICE_KEY: Record<ImportChoice, Key> = { add: "impAdd", skip: "impSkip", replace: "impReplace", copy: "impCopy" };
const MATCH_KEY: Record<PreviewProject["match"], Key> = { new: "impMatchNew", same: "impMatchSame", sameId: "impMatchSameId", sameName: "impMatchSameName" };

/** A row of choices that behaves like radio buttons, including the arrow keys. */
function Choices(props: { label: string; options: ImportChoice[]; value: ImportChoice; onChange: (c: ImportChoice) => void }): JSX.Element {
  const { t } = useI18n();
  const move = (e: KeyboardEvent) => {
    const i = props.options.indexOf(props.value);
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = props.options[(i + step + props.options.length) % props.options.length];
    props.onChange(next);
    ((e.currentTarget as HTMLElement).querySelector(`[data-choice="${next}"]`) as HTMLElement | null)?.focus();
  };
  return (
    <div class="segmented choices" role="radiogroup" aria-label={props.label} onKeyDown={move}>
      {props.options.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={props.value === c} tabIndex={props.value === c ? 0 : -1}
          class={props.value === c ? "on" : ""} data-choice={c} onClick={() => props.onChange(c)}>
          {t(CHOICE_KEY[c])}
        </button>
      ))}
    </div>
  );
}

/** What the archived project contains, by section: the titles, with proposals and archived items marked. */
function Contents(props: { pf: ProjectFile }): JSX.Element {
  const { t } = useI18n();
  const shown = props.pf.memory.slice(0, 300);
  return (
    <details class="import-contents">
      <summary>{t("importShowContent")}</summary>
      {props.pf.project.description && <p class="muted small-left">{props.pf.project.description}</p>}
      {shown.length === 0 && <p class="muted small-left">{t("importNoMemory")}</p>}
      {CATEGORIES.map((c) => {
        const list = shown.filter((e) => e.category === c);
        if (!list.length) return null;
        return (
          <div key={c}>
            <p class="small-left"><strong>{t(`cat_${c}` as Key)}</strong></p>
            <ul class="plain small-left">
              {list.map((e) => (
                <li key={e.id} data-import-entry={e.title}>
                  {e.title}
                  {e.confirmation === "pending" ? ` · ${t("memPendingBadge")}` : e.confirmation === "rejected" ? ` · ${t("memRejectedBadge")}` : e.archived ? ` · ${t("importArchived")}` : ""}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {props.pf.memory.length > shown.length && <p class="muted small-left">…</p>}
    </details>
  );
}

function ImportDialog(props: { preview: ImportPreview; onClose: () => void; onStale: (msg: string) => void }): JSX.Element {
  const { t } = useI18n();
  const date = useDate();
  const pv = props.preview;
  const exp = useExport();
  const [choices, setChoices] = useState<Record<string, ImportChoice>>(() => Object.fromEntries(pv.projects.map((p) => [p.id, p.choices[0]])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupOk, setBackupOk] = useState(false);
  const todo = pv.projects.filter((p) => choices[p.id] !== "skip").length;
  const replacing = pv.projects.filter((p) => choices[p.id] === "replace");

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await transfer.importArchive(pv, choices);
      props.onClose();
      toast({ text: fill(t("importDone"), { n: String(res.imported.length) }) });
      return;
    } catch (e) {
      if (e instanceof ImportError && e.reason === "changed") {
        props.onStale(t("imp_changed"));
        return;
      }
      setError(t(transferErrorKey(e))); // nothing was changed: the import is all or nothing
    }
    setBusy(false);
  };

  return (
    <Dialog title={t("importTitle")} onClose={props.onClose} id="import-dialog">
      <p class="ok-line" data-integrity="ok">✓ {t("importVerified")}</p>
      <p class="muted small-left">{t("importFrom")} {date(pv.exportedAt)} · {t("version")} {pv.app}</p>
      <p class="muted small-left">{t("importTrust")}</p>
      {!pv.sourceJournalOk && <p class="muted">{t("importSourceWarning")}</p>}
      <ul class="import-list">
        {pv.projects.map((p) => {
          const choice = choices[p.id];
          return (
            <li key={p.id} class="import-item" data-import={p.name} data-match={p.match}>
              <p class="row-name">{p.name}{p.trashed ? ` · ${t("importInTrash")}` : ""}</p>
              <p class="muted small-left">
                {fill(t("importCounts"), { e: String(p.counts.entries), l: String(p.counts.links), v: String(p.counts.versions) })}
                {p.counts.pending > 0 ? ` · ${fill(t("importPending"), { n: String(p.counts.pending) })}` : ""}
              </p>
              <p class={p.match === "new" ? "muted small-left" : "small-left warn"}>
                {t(MATCH_KEY[p.match])}
                {p.local && p.match !== "new" ? ` (${t("updatedOn")} ${date(p.local.updatedAt)})` : ""}
              </p>
              {p.renameTo && (choice === "add" || choice === "copy") && (
                <p class="muted small-left" data-rename={p.renameTo}>{fill(t("importRenamed"), { name: p.renameTo })}</p>
              )}
              <Contents pf={pv.archive.projects.find((x) => x.project.id === p.id)!} />
              <Choices label={`${t("importChoice")} ${p.name}`} options={p.choices} value={choice}
                onChange={(c) => setChoices({ ...choices, [p.id]: c })} />
            </li>
          );
        })}
      </ul>
      {replacing.length > 0 && (
        <div class="warn" role="note" data-replace-note>
          <p>{t("importReplaceWarning")}</p>
          <button type="button" class="button secondary small-button" data-action="backup-before-replace" disabled={exp.busy}
            onClick={() => void exp.start(replacing.map((p) => p.local!.id))}>{t("importBackupFirst")}</button>
          <label class="check">
            <input type="checkbox" checked={backupOk} data-action="backup-ok" onChange={(e) => setBackupOk((e.target as HTMLInputElement).checked)} />
            <span>{t("importBackupCheck")}</span>
          </label>
        </div>
      )}
      {error && <p class="form-error" role="alert">{error}</p>}
      <div class="sheet-actions">
        <button type="button" class="button secondary" onClick={props.onClose}>{t("cancel")}</button>
        <button type="button" class="button" data-action="confirm-import" disabled={busy || todo === 0 || (replacing.length > 0 && !backupOk)} onClick={run}>
          {todo === 0 ? t("importNothing") : fill(t("importConfirm"), { n: String(todo) })}
        </button>
      </div>
      {exp.dialog}
    </Dialog>
  );
}

/** The Settings card: export everything, import an archive. */
export function BackupCard(): JSX.Element {
  const { t } = useI18n();
  const exp = useExport();
  return (
    <div class="card notice" id="backup">
      <h2>{t("backupTitle")}</h2>
      <p>{t("backupText")}</p>
      <div class="actions">
        <button type="button" class="button" data-action="export-all" disabled={exp.busy} onClick={() => void exp.start("all")}>{t("exportAll")}</button>
        <ImportButton />
      </div>
      <p class="muted">{t("backupMove")}</p>
      {exp.dialog}
    </div>
  );
}
