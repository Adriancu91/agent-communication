// App shell: a large title per screen, bottom tab bar on phones, side bar on wide screens.
// Routing uses the URL hash (#/proiecte), so the back button works and GitHub Pages never returns 404.
import type { ComponentChildren, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { setLang, useI18n, type Key, type Lang } from "./i18n";
import { IconContinuity, IconLauncher, IconMemory, IconProjects, IconSettings } from "./icons";
import { isStandalone, useOfflineState } from "./offline";

type Route = "proiecte" | "memorie" | "continuitate" | "lansator" | "setari";

const TABS: { route: Route; label: Key; Icon: () => JSX.Element }[] = [
  { route: "proiecte", label: "tabProjects", Icon: IconProjects },
  { route: "memorie", label: "tabMemory", Icon: IconMemory },
  { route: "continuitate", label: "tabContinuity", Icon: IconContinuity },
  { route: "lansator", label: "tabLauncher", Icon: IconLauncher },
  { route: "setari", label: "tabSettings", Icon: IconSettings },
];

function readRoute(): Route {
  const r = location.hash.replace(/^#\/?/, "");
  return TABS.some((t) => t.route === r) ? (r as Route) : "proiecte";
}

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(readRoute);
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
  const route = useRoute();
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
        {route === "proiecte" && <Projects />}
        {route === "memorie" && <Memory />}
        {route === "continuitate" && <Continuity />}
        {route === "lansator" && <Launcher />}
        {route === "setari" && <Settings />}
      </main>
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

function Projects(): JSX.Element {
  const { t } = useI18n();
  return (
    <Screen title={t("projectsTitle")}>
      <Empty lead={t("projectsEmpty")} hint={t("projectsEmptyHint")} action={t("projectsNew")} />
    </Screen>
  );
}

function Memory(): JSX.Element {
  const { t } = useI18n();
  return (
    <Screen title={t("memoryTitle")}>
      <Empty lead={t("memoryEmpty")} hint={t("memorySections")} />
    </Screen>
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
