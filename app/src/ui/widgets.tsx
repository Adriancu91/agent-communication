// Small shared pieces: modal dialog (bottom sheet on phones), confirmation, toast.
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

export function Dialog(props: { title: string; onClose: () => void; children: ComponentChildren; id?: string }): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  // the control that opened the dialog, captured before any field inside takes the focus
  const [opener] = useState(() => (typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null));
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    const cancel = (e: Event) => {
      e.preventDefault();
      props.onClose();
    };
    d.addEventListener("cancel", cancel);
    return () => {
      d.removeEventListener("cancel", cancel);
      if (d.open) d.close();
      // keyboard users continue where they were: focus goes back to the control that opened the dialog
      if (opener && opener.isConnected && document.activeElement !== opener) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog ref={ref} class="sheet" aria-labelledby={(props.id ?? "dlg") + "-t"} id={props.id}>
      <h2 class="sheet-title" id={(props.id ?? "dlg") + "-t"}>{props.title}</h2>
      {props.children}
    </dialog>
  );
}

export function Confirm(props: {
  title: string; text: string; confirm: string; cancel: string; danger?: boolean; check?: string;
  onConfirm: () => Promise<void> | void; onClose: () => void; error?: string | null;
}): JSX.Element {
  const [checked, setChecked] = useState(!props.check);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={props.title} onClose={props.onClose} id="confirm">
      <p>{props.text}</p>
      {props.check && (
        <label class="check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked((e.target as HTMLInputElement).checked)} />
          <span>{props.check}</span>
        </label>
      )}
      {props.error && <p class="form-error" role="alert">{props.error}</p>}
      <div class="sheet-actions">
        <button type="button" class="button secondary" onClick={props.onClose}>{props.cancel}</button>
        <button
          type="button"
          class={"button" + (props.danger ? " danger" : "")}
          disabled={!checked || busy}
          onClick={async () => {
            setBusy(true);
            try {
              await props.onConfirm();
            } finally {
              setBusy(false);
            }
          }}
        >
          {props.confirm}
        </button>
      </div>
    </Dialog>
  );
}

// Toast: one message at a time, above the tab bar, read out by screen readers.
interface ToastMsg { text: string; action?: { label: string; run: () => void }; error?: boolean }
let showToast: (m: ToastMsg) => void = () => {};
export function toast(m: ToastMsg): void {
  showToast(m);
}
export function ToastHost(): JSX.Element {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    showToast = (m) => {
      setMsg(m);
      clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setMsg(null), m.error ? 9000 : 6000);
    };
  }, []);
  return (
    <div class="toast-host" aria-live="polite">
      {msg && (
        <div class={"toast" + (msg.error ? " error" : "")} role={msg.error ? "alert" : "status"}>
          <span>{msg.text}</span>
          {msg.action && (
            <button type="button" onClick={() => { msg.action!.run(); setMsg(null); }}>{msg.action.label}</button>
          )}
        </div>
      )}
    </div>
  );
}
