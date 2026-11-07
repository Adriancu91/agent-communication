// App shell: a large title per screen, bottom tab bar on phones, side bar on wide screens.
// Routing uses the URL hash (#/proiecte), so the back button works and GitHub Pages never returns 404.
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { useClosedByNewerVersion, useStorageInfo } from "./data";
import { setLang, useI18n, type Key, type Lang } from "./i18n";
import { IconContinuity, IconLauncher, IconMemory, IconProjects, IconSettings } from "./icons";
import { isStandalone, useOfflineState } from "./offline";
import { ContextPreview, EntryPage, MemoryHistory, MemoryTab, ProjectMemory } from "./memory";
import { ProjectPage, ProjectsScreen, TrashScreen } from "./projects";
import { ToastHost } from "./widgets";

type Route = "proiecte" | "memorie" | "continuitate" | "lansator" | "setari";

const TABS: { route: Route; label: Key; Icon: () => JSX.Element }[] = [
  { route: "proiecte", label: "tabProjects", Icon: IconProjects },
  { route: "memorie", label: "tabMemory", Icon: IconMemory },
  { route: "continuitate", label: "tabContinuity", Icon: IconContinuity },
  { route: "lansator", label: "tabLauncher", Icon: IconLauncher },
  { route: "setari", label: "tabSettings", Icon: IconSettings },
];

/** #/proiecte, #/proiect/<id>, #/cos and the other tabs. Unknown addresses open the project list. */
interface Location {
  route: Route;
  view: "list" | "project" | "trash" | "tab" | "memory" | "entry" | "history" | "context";
  id?: string;
  entry?: string;
}

function readRoute(): Location {
  const r = location.hash.replace(/^#\/?/, "");
  const mem = /^proiect\/([^/]+)\/memorie(?:\/(.+))?$/.exec(r);
  if (mem) {
    const id = decodeURIComponent(mem[1]);
    const rest = mem[2] ? decodeURIComponent(mem[2]) : "";
    if (!rest) return { route: "memorie", view: "memory", id };
    if (rest === "istoric") return { route: "memorie", view: "history", id };
    if (rest === "context") return { route: "memorie", view: "context", id };
    return { route: "memorie", view: "entry", id, entry: rest };
  }
  const m = /^proiect\/([^/]+)$/.exec(r);
  if (m) return { route: "proiecte", view: "project", id: decodeURIComponent(m[1]) };
  if (r === "cos") return { route: "proiecte", view: "trash" };
  if (r === "proiecte" || !TABS.some((t) => t.route === r)) return { route: "proiecte", view: "list" };
  return { route: r as Route, view: "tab" };
}

function useRoute(): Location {
  const [route, setRoute] = useState<Location>(readRoute);
  useEffect(() => {
    const on = () => {
      setRoute(readRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export function App(): JSX.Element {
  const { t } = useI18n();
  const loc = useRoute();
  const route = loc.route;
  const closed = useClosedByNewerVersion();
  return (
    <div class="shell">
      <nav class="tabbar" aria-label={t("nav")}>
        <div class="brand" aria-hidden="true">{t("appName")}</div>
        {TABS.map(({ route: r, label, Icon }) => (
          <a
            key={r}
            href={`#/${r}`}
            class="tab"
            aria-current={route === r ? "page" : undefined}
            data-route={r}
          >
            <Icon />
            <span>{t(label)}</span>
          </a>
        ))}
      </nav>
      <main class="screen" id="main">
        {closed && (
          <div class="card error-card" role="alert">
            <p>{t("errBlocked")}</p>
            <button type="button" class="button secondary small-button" onClick={() => location.reload()}>{t("reload")}</button>
          </div>
        )}
        {loc.view === "list" && <ProjectsScreen />}
        {loc.view === "project" && <ProjectPage id={loc.id!} key={loc.id} />}
        {loc.view === "trash" && <TrashScreen />}
        {loc.view === "memory" && <ProjectMemory projectId={loc.id!} key={loc.id} />}
        {loc.view === "entry" && <EntryPage projectId={loc.id!} entryId={loc.entry!} key={loc.entry} />}
        {loc.view === "history" && <MemoryHistory projectId={loc.id!} key={loc.id} />}
        {loc.view === "context" && <ContextPreview projectId={loc.id!} key={loc.id} />}
        {loc.view === "tab" && route === "memorie" && <MemoryTab />}
        {route === "continuitate" && <Continuity />}
        {route === "lansator" && <Launcher />}
        {route === "setari" && <Settings />}
      </main>
      <ToastHost />
    </div>
  );
}

function Screen(props: { title: string; children: ComponentChildren }): JSX.Element {
  return (
    <section>
      <h1 class="large-title">{props.title}</h1>
      {props.children}
    </section>
  );
}

function Empty(props: { lead: string; hint: string; action?: string }): JSX.Element {
  const { t } = useI18n();
  return (
    <div class="card empty">
      <p class="lead">{props.lead}</p>
      <p class="muted">{props.hint}</p>
      {props.action && (
        <button type="button" class="button" disabled aria-describedby="soon">
          {props.action}
        </button>
      )}
      <span class="badge" id="soon">{t("comingSoon")}</span>
    </div>
  );
}

function Continuity(): JSX.Element {
  const { t } = useI18n();
  return (
    <Screen title={t("continuityTitle")}>
      <Empty lead={t("continuityEmpty")} hint={t("continuityHint")} />
    </Screen>
  );
}

function Launcher(): JSX.Element {
  const { t } = useI18n();
  return (
    <Screen title={t("launcherTitle")}>
      <Empty lead={t("launcherEmpty")} hint={t("launcherHint")} />
    </Screen>
  );
}

function Settings(): JSX.Element {
  const { t, lang } = useI18n();
  const offline = useOfflineState();
  const standalone = isStandalone();
  const offlineText =
    offline === "ready" ? t("offlineReady") : offline === "pending" ? t("offlinePending") : t("offlineUnavailable");
  return (
    <Screen title={t("settingsTitle")}>
      <div class="card">
        <h2>{t("language")}</h2>
        <div class="segmented" role="radiogroup" aria-label={t("language")}>
          {(["ro", "en"] as Lang[]).map((l) => (
            <button
              key={l}
              type="button"
              role="radio"
              aria-checked={lang === l}
              class={lang === l ? "on" : ""}
              onClick={() => setLang(l)}
            >
              {l === "ro" ? "Română" : "English"}
            </button>
          ))}
        </div>
      </div>
      <div class="card">
        <h2>{t("privacyTitle")}</h2>
        <p>{t("privacyText")}</p>
      </div>
      <StorageCard />
      <div class="card notice">
        <h2>{t("backupTitle")}</h2>
        <p>{t("backupText")}</p>
      </div>
      <div class="card">
        <h2>{t("offlineTitle")}</h2>
        <p data-offline={offline}>{offlineText}</p>
      </div>
      <div class="card">
        <h2>{t("installTitle")}</h2>
        {standalone ? (
          <p>{t("installed")}</p>
        ) : (
          <>
            <p>{t("installText")}</p>
            <p class="muted">{t("installIos")}</p>
            <p class="muted">{t("installAndroid")}</p>
          </>
        )}
      </div>
      <p class="muted small">
        {t("version")} {__APP_VERSION__}
      </p>
    </Screen>
  );
}

function StorageCard(): JSX.Element {
  const { t, lang } = useI18n();
  const [info, ask] = useStorageInfo();
  const text = info.persist === "persisted" ? t("persistOk") : info.persist === "not-persisted" ? t("persistNo") : info.persist ? t("persistUnsupported") : "";
  const mb = info.used === null ? null : new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(info.used / 1048576) + " MB";
  return (
    <div class="card" data-persist={info.persist ?? "unknown"}>
      <h2>{t("storageTitle")}</h2>
      <p>{text}</p>
      {mb && <p class="muted">{t("usedSpace")}: {mb}</p>}
      {info.persist === "not-persisted" && (
        <button type="button" class="button secondary small-button" onClick={() => void ask()}>{t("persistAsk")}</button>
      )}
    </div>
  );
}
