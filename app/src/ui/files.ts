// AIW-07: reading a file the user attaches to a chat message — on the device, nothing is uploaded here.
// Photos are shrunk (≤1600 px, JPEG); PDFs are read with pdf.js (Apache-2.0, loaded only when needed):
// their text, or, for scanned pages without text, pictures of the first pages; .docx: the text of the
// document; text files: as they are. What leaves the device is only what the chosen model receives.
import { readZip } from "../archive";
import { capText, MAX_FILE_BYTES, MAX_IMAGES, type Attachment } from "../chat";
import { cleanText } from "../core";

export class FileError extends Error {
  constructor(public problem: "tooLarge" | "unsupported" | "unreadable" | "empty") {
    super(`file:${problem}`);
    this.name = "FileError";
  }
}

const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|xml|html?|css|js|ts|tsx|jsx|py|java|c|cpp|h|cs|go|rs|rb|php|sql|ya?ml|ini|log|sh|bat|ps1)$/i;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i;
export const ACCEPT = "image/*,.pdf,application/pdf,.docx,.txt,.md,.csv,.tsv,.json,.xml,.html,.htm,.js,.ts,.py,.sql,.yaml,.yml,.log";

let next = 0;
const newId = () => `F-${Date.now().toString(36)}-${(next++).toString(36)}`;

/** A picture made smaller (longest side ≤ max px) and re-encoded as JPEG. */
async function shrink(source: CanvasImageSource & { width: number; height: number }, max = 1600, quality = 0.82): Promise<string> {
  const scale = Math.min(1, max / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  if (!g) throw new FileError("unreadable");
  g.fillStyle = "#fff"; // transparent PNGs on white, as a person would see them
  g.fillRect(0, 0, w, h);
  g.drawImage(source, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}

async function readImage(file: File): Promise<Attachment> {
  let bmp: ImageBitmap;
  try {
    // a big phone photo (tens of megapixels) is decoded already reduced, to spare the phone's memory
    bmp = file.size > 3 * 1024 * 1024 ? await createImageBitmap(file, { resizeWidth: 2000, resizeQuality: "high" }) : await createImageBitmap(file);
  } catch {
    // some browsers cannot decode every format (for example HEIC outside Safari)
    throw new FileError("unreadable");
  }
  try {
    return { id: newId(), kind: "image", name: file.name || "poza.jpg", text: "", images: [await shrink(bmp)], pages: 0, cut: false };
  } finally {
    bmp.close();
  }
}

async function readPdf(file: File): Promise<Attachment> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    disableFontFace: true,
    useWorkerFetch: false,
    stopAtErrors: false,
    enableXfa: false,
    // decoders for scanned images (JBIG2, JPEG 2000), served by the app itself
    wasmUrl: new URL("./pdfjs/wasm/", document.baseURI).href,
  });
  let doc: Awaited<typeof task.promise>;
  try {
    doc = await task.promise;
  } catch {
    throw new FileError("unreadable");
  }
  try {
    const pages = doc.numPages;
    const texts: string[] = [];
    const scanned: number[] = []; // pages with (almost) no text: shown to the model as pictures
    let total = 0;
    for (let i = 1; i <= pages && total < 60000; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = "";
      const out: string[] = [];
      for (const it of content.items) {
        if (!("str" in it)) continue;
        line += it.str;
        if (it.hasEOL) {
          out.push(line);
          line = "";
        } else if (it.str && !it.str.endsWith(" ")) line += " ";
      }
      if (line.trim()) out.push(line);
      const pageText = out.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
      texts.push(pageText);
      if (pageText.replace(/\s/g, "").length < 10) scanned.push(i);
      total += pageText.length;
      page.cleanup();
    }
    const { text, cut } = capText(texts.join("\n\n"));
    // scanned pages have (almost) no text: the first of them go as pictures
    const images: string[] = [];
    {
      for (const i of scanned.slice(0, MAX_IMAGES)) {
        const page = await doc.getPage(i);
        const v = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 1400 / Math.max(v.width, v.height));
        const vp = page.getViewport({ scale });
        const c = document.createElement("canvas");
        c.width = Math.ceil(vp.width);
        c.height = Math.ceil(vp.height);
        const g = c.getContext("2d");
        if (!g) break;
        await page.render({ canvasContext: g, canvas: c, viewport: vp }).promise;
        images.push(await shrink(c, 1400, 0.8));
        page.cleanup();
      }
    }
    if (!text.trim() && !images.length) throw new FileError("empty");
    return { id: newId(), kind: "pdf", name: file.name || "document.pdf", text, images, pages, cut: cut || scanned.length > MAX_IMAGES };
  } finally {
    void task.destroy();
  }
}

async function readDocx(file: File): Promise<Attachment> {
  let files: Map<string, Uint8Array>;
  try {
    files = await readZip(new Uint8Array(await file.arrayBuffer()), { maxFiles: 5000, maxFileBytes: 30 * 1024 * 1024, maxTotalBytes: 30 * 1024 * 1024 }, (n) => n === "word/document.xml");
  } catch {
    throw new FileError("unreadable");
  }
  const xml = files.get("word/document.xml");
  if (!xml) throw new FileError("unreadable");
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(xml), "application/xml");
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const paras = [...doc.getElementsByTagNameNS(W, "p")].map((p) => {
    let s = "";
    for (const el of p.getElementsByTagNameNS(W, "*")) {
      if (el.localName === "t") s += el.textContent ?? "";
      else if (el.localName === "tab") s += "\t";
      else if (el.localName === "br") s += "\n";
    }
    return s;
  });
  const { text, cut } = capText(paras.join("\n").replace(/\n{3,}/g, "\n\n"));
  if (!text.trim()) throw new FileError("empty");
  return { id: newId(), kind: "docx", name: file.name, text, images: [], pages: 0, cut };
}

async function readText(file: File): Promise<Attachment> {
  const { text, cut } = capText(await file.text());
  if (!text.trim()) throw new FileError("empty");
  return { id: newId(), kind: "text", name: file.name, text, images: [], pages: 0, cut };
}

/** Reads one attached file. */
export async function readAttachment(file: File): Promise<Attachment> {
  if (file.size > MAX_FILE_BYTES) throw new FileError("tooLarge");
  const a = await readAny(file);
  // the name goes into the saved question: no hidden control or direction characters, not too long
  return { ...a, name: [...cleanText(a.name).replace(/[\n\]]/g, " ")].slice(0, 120).join("") || "fisier" };
}

async function readAny(file: File): Promise<Attachment> {
  const name = file.name || "";
  if (file.type.startsWith("image/") || IMAGE_EXT.test(name)) return readImage(file);
  if (file.type === "application/pdf" || /\.pdf$/i.test(name)) return readPdf(file);
  if (/\.docx$/i.test(name)) return readDocx(file);
  if (file.type.startsWith("text/") || TEXT_EXT.test(name) || file.type === "application/json") return readText(file);
  throw new FileError("unsupported");
}
