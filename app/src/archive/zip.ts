// A minimal ZIP writer and a strict ZIP reader, written by hand (no library).
// Only what the export format needs: plain files, "stored" or "deflate" (via the browser's
// CompressionStream), no encryption, no ZIP64. The reader is defensive: it checks every size, offset
// and CRC, refuses unsafe names, and stops decompressing as soon as a size limit is passed
// (protection against "zip bombs"). Nothing read from an archive is ever executed.

export type ZipProblem =
  | "notZip" | "truncated" | "tooManyFiles" | "tooLarge" | "badName" | "duplicateName" | "encrypted"
  | "unsupportedMethod" | "zip64" | "crc" | "sizeMismatch" | "inflate";

export class ZipError extends Error {
  constructor(public problem: ZipProblem, detail?: string) {
    super(`zip:${problem}${detail ? ` (${detail})` : ""}`);
    this.name = "ZipError";
  }
}

export interface ZipLimits {
  maxFiles: number;
  /** Largest single file after decompression, in bytes. */
  maxFileBytes: number;
  /** All files together after decompression, in bytes. */
  maxTotalBytes: number;
}

export const DEFAULT_LIMITS: ZipLimits = { maxFiles: 2000, maxFileBytes: 64 * 1024 * 1024, maxTotalBytes: 128 * 1024 * 1024 };

// ---------- CRC-32 ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// ---------- names ----------

/** Only simple relative names: letters, digits, - _ . and / between parts. No "..", no absolute paths. */
export function isSafeName(name: string): boolean {
  if (!name || name.length > 200) return false;
  if (!/^[A-Za-z0-9._\-/]+$/.test(name)) return false;
  if (name.startsWith("/") || name.endsWith("/")) return false;
  return name.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

// ---------- compression helpers ----------

function hasStream(kind: "CompressionStream" | "DecompressionStream"): boolean {
  try {
    const C = (globalThis as unknown as Record<string, new (f: string) => unknown>)[kind];
    if (!C) return false;
    new C("deflate-raw");
    return true;
  } catch {
    return false;
  }
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate-raw");
  const out = new Blob([data as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Inflates, refusing to produce more than `limit` bytes (the stream is cancelled as soon as it would). */
async function inflate(data: Uint8Array, limit: number): Promise<Uint8Array> {
  if (!hasStream("DecompressionStream")) throw new ZipError("unsupportedMethod", "no DecompressionStream");
  const reader = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        void reader.cancel().catch(() => undefined);
        throw new ZipError("sizeMismatch", "inflated data larger than declared");
      }
      chunks.push(value);
    }
  } catch (e) {
    if (e instanceof ZipError) throw e;
    throw new ZipError("inflate", String((e as Error)?.message ?? e).slice(0, 80));
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

// ---------- writer ----------

export interface ZipInput {
  name: string;
  data: Uint8Array;
}

/** DOS date/time of a Date (the format ZIP uses); local time, 2-second precision. */
function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Builds a ZIP file. Files are compressed with deflate when the browser can (and when it helps),
 * otherwise stored as they are. File names must be safe (see isSafeName) and unique.
 */
export async function createZip(files: ZipInput[], when = new Date()): Promise<Uint8Array> {
  const names = new Set<string>();
  for (const f of files) {
    if (!isSafeName(f.name)) throw new ZipError("badName", f.name);
    if (names.has(f.name)) throw new ZipError("duplicateName", f.name);
    names.add(f.name);
  }
  const canDeflate = hasStream("CompressionStream");
  const { time, date } = dosTime(when);
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    let method = 0;
    let body = f.data;
    if (canDeflate && f.data.length > 64) {
      const z = await deflate(f.data);
      if (z.length < f.data.length) {
        method = 8;
        body = z;
      }
    }
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, method, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, body.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);

    parts.push(local, body);
    central.push(cen);
    offset += local.length + body.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of all) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---------- reader ----------

/** Reads every file of a ZIP into memory, checking sizes, names and CRCs. */
export async function readZip(bytes: Uint8Array, limits: ZipLimits = DEFAULT_LIMITS): Promise<Map<string, Uint8Array>> {
  if (bytes.length < 22) throw new ZipError(bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b ? "truncated" : "notZip");
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new ZipError("notZip");
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // the end record: last 22 bytes + an optional comment of at most 65 535 bytes
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === 0x06054b50 && i + 22 + v.getUint16(i + 20, true) === bytes.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("truncated", "no end record");
  const count = v.getUint16(eocd + 10, true);
  const cdSize = v.getUint32(eocd + 12, true);
  const cdOffset = v.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError("zip64");
  if (v.getUint16(eocd + 4, true) !== 0 || v.getUint16(eocd + 6, true) !== 0 || v.getUint16(eocd + 8, true) !== count) {
    throw new ZipError("notZip", "multi-disk");
  }
  if (count > limits.maxFiles) throw new ZipError("tooManyFiles");
  if (cdOffset + cdSize > eocd) throw new ZipError("truncated", "central directory");

  const dec = new TextDecoder("utf-8", { fatal: true });
  const out = new Map<string, Uint8Array>();
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > eocd || v.getUint32(p, true) !== 0x02014b50) throw new ZipError("truncated", "central entry");
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const csize = v.getUint32(p + 20, true);
    const usize = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true);
    const xlen = v.getUint16(p + 30, true);
    const clen = v.getUint16(p + 32, true);
    const lho = v.getUint32(p + 42, true);
    if (p + 46 + nlen + xlen + clen > eocd) throw new ZipError("truncated", "central entry");
    let name: string;
    try {
      name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    } catch {
      throw new ZipError("badName");
    }
    p += 46 + nlen + xlen + clen;

    if (flags & 0x0001) throw new ZipError("encrypted", name);
    // known option bits only: deflate level (1-2), data descriptor (3), UTF-8 names (11)
    if (flags & ~0x080e) throw new ZipError("unsupportedMethod", `flags ${flags}`);
    if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) throw new ZipError("zip64");
    if (name.endsWith("/") && usize === 0) continue; // a folder entry added by some zip tools: nothing to read
    if (!isSafeName(name)) throw new ZipError("badName", name.slice(0, 60));
    if (out.has(name)) throw new ZipError("duplicateName", name);
    if (method !== 0 && method !== 8) throw new ZipError("unsupportedMethod", String(method));
    if (usize > limits.maxFileBytes) throw new ZipError("tooLarge", name);
    total += usize;
    if (total > limits.maxTotalBytes) throw new ZipError("tooLarge", "total");

    if (lho + 30 > cdOffset || v.getUint32(lho, true) !== 0x04034b50) throw new ZipError("truncated", "local header");
    // the local header must agree with the central directory (any difference = a damaged archive)
    const lflags = v.getUint16(lho + 6, true);
    const lnlen = v.getUint16(lho + 26, true);
    if (v.getUint16(lho + 8, true) !== method || lflags !== flags || lnlen !== nlen) throw new ZipError("sizeMismatch", `local header ${name}`);
    if (!(lflags & 0x0008) && (v.getUint32(lho + 14, true) !== crc || v.getUint32(lho + 18, true) !== csize || v.getUint32(lho + 22, true) !== usize)) {
      throw new ZipError("sizeMismatch", `local header ${name}`);
    }
    const lname = bytes.subarray(lho + 30, lho + 30 + lnlen);
    const cname = bytes.subarray(p - clen - xlen - nlen, p - clen - xlen);
    if (lname.length !== cname.length || lname.some((b, i) => b !== cname[i])) throw new ZipError("badName", `local header ${name}`);
    const start = lho + 30 + lnlen + v.getUint16(lho + 28, true);
    if (start + csize > cdOffset) throw new ZipError("truncated", "file data");
    const raw = bytes.subarray(start, start + csize);
    let data: Uint8Array;
    if (method === 0) {
      if (csize !== usize) throw new ZipError("sizeMismatch", name);
      data = raw.slice();
    } else {
      data = await inflate(raw, usize);
    }
    if (data.length !== usize) throw new ZipError("sizeMismatch", name);
    if (crc32(data) !== crc) throw new ZipError("crc", name);
    out.set(name, data);
  }
  return out;
}
