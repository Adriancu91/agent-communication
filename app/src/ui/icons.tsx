// Small inline icons (no icon font, no external request). Stroke uses currentColor.
import type { JSX } from "preact";

const base = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  "stroke-width": 1.8,
  "stroke-linecap": "round",
  "stroke-linejoin": "round",
  "aria-hidden": "true",
} as const;

export const IconProjects = (): JSX.Element => (
  <svg {...base}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
);
export const IconMemory = (): JSX.Element => (
  <svg {...base}><path d="M12 4v16M5 7h4M5 12h4M5 17h4M15 7h4M15 12h4M15 17h4" /></svg>
);
export const IconContinuity = (): JSX.Element => (
  <svg {...base}><path d="M4 12h12M12 6l6 6-6 6" /><circle cx="4" cy="12" r="1.5" /></svg>
);
export const IconLauncher = (): JSX.Element => (
  <svg {...base}><path d="M14 4h6v6M20 4l-9 9M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg>
);
export const IconSettings = (): JSX.Element => (
  <svg {...base}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>
);
