// AIW-07: the code agent — a page of code from an answer runs in an isolated preview (sandbox.html inside
// <iframe sandbox="allow-scripts">: its own origin, no access to the app's data, no network); errors come
// back here and can be sent to the model with one tap to fix them. The page can also be downloaded.
import type { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { useI18n } from "./i18n";
import type { CodeBlock } from "./markdown";
import { Dialog } from "./widgets";

/** A block that can run as a page: HTML, or JavaScript / CSS wrapped in a page. */
export function runnable(b: CodeBlock): string | null {
  const c = b.code;
  if (b.lang === "html" || b.lang === "htm" || /<(!doctype html|html|body)\b/i.test(c)) return c;
  if (b.lang === "js" || b.lang === "javascript") return `<!doctype html><meta charset="utf-8"><body><script>\n${c}\n</script></body>`;
  if (b.lang === "svg" || /^\s*<svg\b/i.test(c)) return `<!doctype html><meta charset="utf-8"><body style="margin:0">${c}</body>`;
  return null;
}

export function download(html: string, name = "aplicatie.html"): void {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function CodeTools(props: { block: CodeBlock; onRun: (html: string) => void }): JSX.Element | null {
  const { t } = useI18n();
  const html = runnable(props.block);
  if (!html) return null;
  return (
    <div class="code-tools">
      <button type="button" class="pill acc" data-action="run-code" onClick={() => props.onRun(html)}>▶ {t("cdRun")}</button>
      <button type="button" class="pill" data-action="download-code" onClick={() => download(html)}>⇩ {t("cdDownload")}</button>
    </div>
  );
}

export function PreviewDialog(props: { html: string; onClose: () => void; onFix: (errors: string[]) => void }): JSX.Element {
  const { t } = useI18n();
  const frame = useRef<HTMLIFrameElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [state, setState] = useState<"loading" | "running">("loading");
  const started = useRef(false);
  // the preview page is loaded (its listener is ready): the code is handed over once — never on a message
  // from inside, since the code running there can post messages too
  const start = () => {
    if (started.current || !frame.current?.contentWindow) return;
    started.current = true;
    frame.current.contentWindow.postMessage({ type: "aiw-run", html: props.html }, "*");
    setState("running");
  };
  useEffect(() => {
    const on = (e: MessageEvent) => {
      // only messages from this preview frame (its origin is opaque, so the frame itself is checked)
      if (!frame.current || e.source !== frame.current.contentWindow || !e.data || e.data.type !== "aiw-sandbox") return;
      if (e.data.kind === "ready") start();
      else if (e.data.kind === "error") setErrors((l) => (l.length >= 20 ? l : [...l, String(e.data.msg).slice(0, 300)]));
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [props.html]);
  return (
    <Dialog title={t("cdPreview")} onClose={props.onClose} id="code-preview">
      <iframe ref={frame} class="preview-frame" src="./sandbox.html" sandbox="allow-scripts" referrerpolicy="no-referrer" title={t("cdPreview")} data-state={state} onLoad={start} />
      <p class="muted small-left">{t("cdIsolated")}</p>
      {errors.length > 0 && (
        <div class="card error-card" role="alert" data-preview-errors>
          <p><strong>{t("cdErrors")}</strong></p>
          <ul>{errors.slice(0, 5).map((e, i) => <li key={i}>{e}</li>)}</ul>
          <button type="button" class="button small-button" data-action="fix-code" onClick={() => props.onFix(errors)}>{t("cdFix")}</button>
        </div>
      )}
      <div class="sheet-actions">
        <button type="button" class="button secondary" onClick={() => download(props.html)}>⇩ {t("cdDownload")}</button>
        <button type="button" class="button" onClick={props.onClose}>{t("close")}</button>
      </div>
    </Dialog>
  );
}
