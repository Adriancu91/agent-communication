// AIW-06: ready-made requests for the in-app chat (one tap fills the message box), plus the user's own.
import { charCount, stripUnsafe } from "../core";
import type { PackLang } from "../continuity";

export interface PromptTemplate {
  id: string;
  /** a one-character symbol shown on the chip */
  icon: string;
  label: string;
  text: string;
  /** the message needs the user to add something (the cursor waits at the end) */
  open?: boolean;
}

const BUILT_IN: Record<PackLang, PromptTemplate[]> = {
  ro: [
    { id: "summary", icon: "◎", label: "Rezumat", text: "Fă un rezumat scurt al proiectului: unde suntem, ce s-a decis și ce e încă deschis." },
    { id: "next", icon: "→", label: "Pașii următori", text: "Propune următorii 3–5 pași concreți, în ordine, și adaugă-i ca propuneri de tip pas." },
    { id: "check", icon: "✓", label: "Verifică deciziile", text: "Verifică deciziile confirmate: e ceva contradictoriu, învechit sau riscant? Spune clar ce și de ce." },
    { id: "risks", icon: "!", label: "Riscuri", text: "Ce probleme sau riscuri vezi acum în proiect? Adaugă-le ca propuneri de tip problemă." },
    { id: "plan", icon: "▤", label: "Plan pe etape", text: "Fă un plan de lucru pe etape pentru obiectivele proiectului, cu ce trebuie terminat la fiecare etapă." },
    { id: "simple", icon: "☺", label: "Explică simplu", text: "Explică-mi starea proiectului pe înțelesul unui începător, fără jargon." },
    { id: "report", icon: "✉", label: "Raport", text: "Scrie un raport scurt de progres pe care îl pot trimite altcuiva (fără detalii interne inutile)." },
    { id: "extract", icon: "⇣", label: "Extrage din text", text: "Extrage din textul de mai jos deciziile, pașii, problemele și informațiile importante, ca propuneri pentru memorie:\n\n", open: true },
    { id: "app", icon: "⌘", label: "Fă o aplicație", text: "Construiește o aplicație mică într-un singur fișier HTML (HTML, CSS și JavaScript în același fișier, fără biblioteci sau resurse de pe internet), pe care o pot rula direct. Pune tot codul într-un singur bloc ```html. Aplicația: ", open: true },
  ],
  en: [
    { id: "summary", icon: "◎", label: "Summary", text: "Give a short summary of the project: where we are, what was decided and what is still open." },
    { id: "next", icon: "→", label: "Next steps", text: "Propose the next 3–5 concrete steps, in order, and add them as step proposals." },
    { id: "check", icon: "✓", label: "Check decisions", text: "Check the confirmed decisions: is anything contradictory, outdated or risky? Say clearly what and why." },
    { id: "risks", icon: "!", label: "Risks", text: "What problems or risks do you see in the project now? Add them as problem proposals." },
    { id: "plan", icon: "▤", label: "Phased plan", text: "Make a phased work plan for the project's goals, with what must be finished in each phase." },
    { id: "simple", icon: "☺", label: "Explain simply", text: "Explain the state of the project to me as to a beginner, without jargon." },
    { id: "report", icon: "✉", label: "Report", text: "Write a short progress report I can send to someone else (no unnecessary internal detail)." },
    { id: "extract", icon: "⇣", label: "Extract from text", text: "Extract the decisions, steps, problems and important facts from the text below, as memory proposals:\n\n", open: true },
    { id: "app", icon: "⌘", label: "Make an app", text: "Build a small app in one HTML file (HTML, CSS and JavaScript in the same file, no libraries or resources from the internet) that I can run directly. Put all the code in one ```html block. The app: ", open: true },
  ],
};

export const builtInPrompts = (lang: PackLang): PromptTemplate[] => BUILT_IN[lang];

export const MY_PROMPTS_MAX = 30;
export const MY_PROMPT_LABEL_MAX = 30;
export const MY_PROMPT_TEXT_MAX = 2000;

export interface MyPrompt {
  id: string; // "U-<n>"
  label: string;
  text: string;
}

/** The user's own templates read back from storage: invalid items are dropped, limits enforced. */
export function cleanMyPrompts(raw: unknown): MyPrompt[] {
  if (!Array.isArray(raw)) return [];
  const out: MyPrompt[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    if (typeof r.id !== "string" || !/^U-\d{1,16}$/.test(r.id) || seen.has(r.id)) continue;
    const label = typeof r.label === "string" ? stripUnsafe(r.label).replace(/\s+/g, " ").trim() : "";
    const text = typeof r.text === "string" ? stripUnsafe(r.text).trim() : "";
    if (!label || !text || charCount(label) > MY_PROMPT_LABEL_MAX || charCount(text) > MY_PROMPT_TEXT_MAX) continue;
    seen.add(r.id);
    out.push({ id: r.id, label, text });
    if (out.length >= MY_PROMPTS_MAX) break;
  }
  return out;
}
