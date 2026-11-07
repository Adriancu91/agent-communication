// Registers the service worker (production builds only) and reports whether offline mode is ready.
import { useEffect, useState } from "preact/hooks";

export type OfflineState = "ready" | "pending" | "unavailable";

export function registerOffline(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {
    // not fatal: the app still works online
  });
}

function stateNow(): OfflineState {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return "unavailable";
  return navigator.serviceWorker.controller ? "ready" : "pending";
}

export function useOfflineState(): OfflineState {
  const [state, setState] = useState<OfflineState>(stateNow);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const update = () => setState(stateNow());
    navigator.serviceWorker.addEventListener("controllerchange", update);
    navigator.serviceWorker.ready.then(update, update);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", update);
  }, []);
  return state;
}

/** True when the app was opened from the home screen (optional install). */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;
}
