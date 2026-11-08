// AIW-06.1: Import (#/import) — the conversations from the user's own ChatGPT / Claude account become
// chats of a project, which can then be continued in the in-app chat. The file is read on the device;
// nothing is sent anywhere. The official memory is not touched (proposals come from a review, later).
import type { JSX } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { readZip, ZipError } from "../archive";
import { ImportError, parseConversationsText, type ImportedConversation, type ImportSource } from "../importer";
import { chatUrl } from "./chat";
import { errorKey, lastProject, rememberProject, sessionStore, useProjects } from "./data";
import { fill, useDate, useI18n, type Key } from "./i18n";
import { toast } from "./widgets";

/** A conversations.json can be large; it is read whole on the device. */
const MAX_FILE = 150 * 1024 * 1024; // a phone cannot hold much more (file + unpacked text + objects)
const MAX_JSON = 80 * 1024 * 1024;
const DONE = "aiw.imported.";

function importedIds(projectId: string): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(DONE + projectId) ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}
function rememberImported(projectId: string, ids: string[]): void {
  try {
    const all = [...importedIds(projectId), ...ids].slice(-5000);
    localStorage.setItem(DONE + projectId, JSON.stringify(all));
  } catch {
    /* not fatal: only the "already imported" mark is lost */
  }
}

async function readExport(file: File): Promise<{ source: ImportSource; conversations: ImportedConversation[] }> {
  if (file.size > MAX_FILE) throw new ImportError("tooLarge");
  const bytes = new Uint8Array(await file.arrayBuffer());
  let json: string;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let files: Map<string, Uint8Array>;
    try {
      files = await readZip(bytes, { maxFiles: 200000, maxFileBytes: MAX_JSON, maxTotalBytes: MAX_JSON }, (n) => /(^|\/)conversations\.json$/.test(n));
    } catch (e) {
      throw new ImportError(e instanceof ZipError && e.problem === "tooLarge" ? "tooLarge" : "zip", e instanceof Error ? e.message : "");
    }
    const entry = [...files.entries()].sort((a, b) => a[0].length - b[0].length)[0];
    if (!entry) throw new ImportError("noConversations");
    json = new TextDecoder().decode(entry[1]);
  } else {
    json = new TextDecoder().decode(bytes);
  }
  return parseConversationsText(json);
}

const importKey = (e: unknown): Key => (e instanceof ImportError ? (`imErr_${e.problem}` as Key) : errorKey(e));

export function ImportScreen(): JSX.Element {
  const { t } = useI18n();
  const date = useDate();
  const { projects, loading } = useProjects();
  const live = projects.filter((p) => !p.deletedAt);
  const [projectId, setProjectId] = useState<string | null>(null);
  const pid = projectId && live.some((p) => p.id === projectId) ? projectId : live.find((p) => p.id === lastProject())?.id ?? live[0]?.id ?? null;
  const [data, setData] = useState<{ source: ImportSource; conversations: ImportedConversation[] } | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<Key | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<{ title: string; sid: string }[]>([]);
  const [runs, setRuns] = useState(0);
  const done = useMemo(() => (pid ? importedIds(pid) : new Set<string>()), [pid, runs]);
  useEffect(() => void (pid && rememberProject(pid)), [pid]);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setData(null);
    setResult([]);
    setReading(true);
    try {
      const d = await readExport(file);
      setData(d);
      setChosen(new Set());
    } catch (e) {
      setError(importKey(e));
    } finally {
      setReading(false);
    }
  };

  const shown = (data?.conversations ?? []).filter((c) => !filter.trim() || c.title.toLowerCase().includes(filter.trim().toLowerCase()));
  const visible = shown.slice(0, 300);

  const run = async () => {
    if (!data || !pid || busy) return;
    const list = data.conversations.filter((c) => chosen.has(c.id));
    setBusy({ done: 0, total: list.length });
    const ok: { title: string; sid: string }[] = [];
    let failed = 0;
    for (const c of list) {
      try {
        const s = await sessionStore.importChat(pid, c.source, c.title, c.messages);
        ok.push({ title: c.title, sid: s.id });
        rememberImported(pid, [c.id]);
      } catch {
        failed++;
      }
      setBusy({ done: ok.length + failed, total: list.length });
    }
    setBusy(null);
    setChosen(new Set());
    setResult(ok);
    setRuns((n) => n + 1);
    toast({ text: fill(t(failed ? "imDonePartial" : "imDone"), { n: String(ok.length), f: String(failed) }), error: failed > 0 });
  };

  if (loading) return <section><h1 class="large-title">{t("imTitle")}</h1><p class="muted">{t("loading")}</p></section>;
  if (!pid) {
    return (
      <section>
        <h1 class="large-title">{t("imTitle")}</h1>
        <div class="card empty"><p class="lead">{t("imNoProject")}</p><a class="button link-button" href="#/proiecte">{t("projectsNew")}</a></div>
      </section>
    );
  }
  return (
    <section class="import" data-import>
      <h1 class="large-title">{t("imTitle")}</h1>
      <p class="muted">{t("imIntro")}</p>

      <div class="card">
        <h2>{t("imStep1")}</h2>
        <label class="field"><span class="sr-only">{t("chProject")}</span>
          <select name="project" value={pid} onChange={(e) => setProjectId((e.target as HTMLSelectElement).value)}>
            {live.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>

      <div class="card">
        <h2>{t("imStep2")}</h2>
        <details class="howto"><summary>ChatGPT</summary><p>{t("imHowChatgpt")}</p></details>
        <details class="howto"><summary>Claude</summary><p>{t("imHowClaude")}</p></details>
        <label class="button file-button" data-action="pick-export">
          {reading ? t("imReading") : t("imPick")}
          <input type="file" name="export" accept=".zip,.json,application/zip,application/json" class="sr-only" disabled={reading || !!busy}
            onChange={(e) => { const i = e.target as HTMLInputElement; void pick(i.files?.[0]); i.value = ""; }} />
        </label>
        <p class="muted small-left">{t("imPrivacy")}</p>
        {error && <p class="form-error" role="alert" data-import-error>{t(error)}</p>}
      </div>

      {data && (
        <div class="card" data-conversations={data.conversations.length}>
          <h2>{fill(t("imStep3"), { n: String(data.conversations.length), src: data.source === "chatgpt" ? "ChatGPT" : "Claude" })}</h2>
          <input class="search" type="search" name="filter" placeholder={t("imFilter")} value={filter} onInput={(e) => { setFilter((e.target as HTMLInputElement).value); setChosen(new Set()); }} />
          <div class="import-tools">
            <button type="button" class="button secondary small-button" data-action="select-all" onClick={() => setChosen(new Set(visible.filter((c) => !done.has(c.id)).map((c) => c.id)))}>{t("imSelectAll")}</button>
            <button type="button" class="button secondary small-button" onClick={() => setChosen(new Set())}>{t("imSelectNone")}</button>
          </div>
          <ul class="list conv-list">
            {visible.map((c) => (
              <li key={c.id} class="row" data-conv={c.title}>
                <label class="row-main conv">
                  <input type="checkbox" checked={chosen.has(c.id)} onChange={(e) => {
                    const n = new Set(chosen);
                    if ((e.target as HTMLInputElement).checked) n.add(c.id);
                    else n.delete(c.id);
                    setChosen(n);
                  }} />
                  <span>
                    <span class="row-name">{c.title}</span>
                    <span class="row-meta">{fill(t("imMeta"), { n: String(c.messages.length) })}{c.updated ? ` · ${date(c.updated)}` : ""}{c.dropped ? ` · ${fill(t("imDropped"), { n: String(c.dropped) })}` : ""}{done.has(c.id) ? ` · ${t("imAlready")}` : ""}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {shown.length > 300 && <p class="muted small-left">{fill(t("imMore"), { n: String(shown.length - 300) })}</p>}
          <div class="sheet-actions single">
            <button type="button" class="button" data-action="import-chats" disabled={chosen.size === 0 || !!busy} onClick={() => void run()}>
              {busy ? fill(t("imImporting"), { d: String(busy.done), n: String(busy.total) }) : fill(t("imImport"), { n: String(chosen.size) })}
            </button>
          </div>
        </div>
      )}

      {result.length > 0 && (
        <div class="card" data-import-result>
          <h2>{t("imResult")}</h2>
          <div class="menu">
            {result.slice(0, 20).map((r) => <a key={r.sid} class="menu-item" href={chatUrl(pid, r.sid)} data-imported={r.title}>{r.title} → {t("chOpenInChat")}</a>)}
          </div>
          <p class="muted small-left">{t("imAfter")}</p>
        </div>
      )}
    </section>
  );
}
