// AIW-07: voice — dictating a message and hearing the answer, with what the browser already has.
// No key and no cost. Dictation uses the browser's speech recognition: Chrome / Android send the audio to
// Google, Safari / iPhone to Apple (sometimes on the device); the app never receives or keeps the audio.
// Reading aloud uses the voices installed on the device (speechSynthesis), entirely on the device.

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;

function ctor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canListen = (): boolean => !!ctor();
export const canSpeak = (): boolean => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

export type ListenProblem = "denied" | "unavailable" | "noSpeech" | "network" | "other";

export interface Listening {
  stop(): void;
}

/**
 * Listens once (until a pause, or stop()). `onText` gets the text so far (final + what is still being
 * heard); `onDone` gets the final text ("" if nothing was understood) or the problem.
 */
export function listen(lang: string, onText: (text: string) => void, onDone: (text: string, problem: ListenProblem | null) => void): Listening {
  const C = ctor();
  if (!C) {
    onDone("", "other");
    return { stop: () => undefined };
  }
  const r = new C();
  r.lang = lang === "ro" ? "ro-RO" : "en-US";
  r.continuous = false;
  r.interimResults = true;
  r.maxAlternatives = 1;
  let final = "";
  let problem: ListenProblem | null = null;
  let done = false;
  r.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) final += res[0].transcript;
      else interim += res[0].transcript;
    }
    onText((final + interim).trim());
  };
  r.onerror = (e) => {
    problem = e.error === "not-allowed" ? "denied" : e.error === "service-not-allowed" ? "unavailable" : e.error === "no-speech" ? "noSpeech" : e.error === "network" ? "network" : e.error === "aborted" ? null : "other";
  };
  r.onend = () => {
    if (done) return;
    done = true;
    onDone(final.trim(), final.trim() ? null : problem);
  };
  try {
    r.start();
  } catch {
    done = true;
    onDone("", "other");
  }
  return { stop: () => r.stop() };
}

/** Text as it should be heard: no code blocks, links or markdown signs. */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^[ \t]*[#>*-]+[ \t]*/gm, "")
    .replace(/[*_~|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pieces of at most ~220 characters, cut at sentence ends (long utterances stop early on some phones). */
export function chunks(text: string, max = 220): string[] {
  const out: string[] = [];
  let cur = "";
  // sentences, without look-behind (older iPhone browsers cannot read it)
  const sentences = text.split(/([.!?;:])\s+/).reduce<string[]>((acc, p, i, all) => (i % 2 === 0 ? [...acc, p + (all[i + 1] ?? "")] : acc), []);
  for (const part of sentences) {
    if ((cur + " " + part).trim().length > max && cur) {
      out.push(cur.trim());
      cur = "";
    }
    if (part.length > max) {
      for (let i = 0; i < part.length; i += max) out.push(part.slice(i, i + max));
    } else cur += " " + part;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Called from a tap: some phones (iPhone) let the page speak later only after this. */
export function unlockSpeech(): void {
  if (!canSpeak()) return;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

/** Reads a text aloud on the device; resolves when finished or stopped (or if the phone stays silent). */
export function speak(text: string, lang: string): Promise<void> {
  return new Promise((resolve) => {
    if (!canSpeak()) return resolve();
    const synth = window.speechSynthesis;
    if (synth.speaking || synth.pending) synth.cancel();
    const code = lang === "ro" ? "ro" : "en";
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(code)) ?? null;
    const parts = chunks(speakable(text));
    if (!parts.length) return resolve();
    let left = parts.length;
    for (const p of parts) {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = lang === "ro" ? "ro-RO" : "en-US";
      if (voice) u.voice = voice;
      u.rate = 1.05;
      let ended = false;
      const end = () => {
        if (ended) return;
        ended = true;
        if (--left === 0) resolve();
      };
      // a phone that blocks speech never says it ended: each piece gets a time limit
      setTimeout(end, 4000 + p.length * 90);
      u.onend = end;
      u.onerror = () => {
        left = 1;
        end();
      };
      synth.speak(u);
    }
  });
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}
