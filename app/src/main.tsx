import { render } from "preact";
import { App } from "./ui/App";
import { currentLang } from "./ui/i18n";
import { registerOffline } from "./ui/offline";
import { captureSharedText } from "./ui/handoff";
import "./ui/styles.css";

document.documentElement.lang = currentLang();
captureSharedText(); // opened from the share sheet (Android): keep the AI reply, clean the address
render(<App />, document.getElementById("app")!);
registerOffline();
