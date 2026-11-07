import { render } from "preact";
import { App } from "./ui/App";
import { currentLang } from "./ui/i18n";
import { registerOffline } from "./ui/offline";
import "./ui/styles.css";

document.documentElement.lang = currentLang();
render(<App />, document.getElementById("app")!);
registerOffline();
