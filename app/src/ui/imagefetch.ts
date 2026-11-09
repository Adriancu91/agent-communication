// AIW-09: the one request to the free picture service — in its own file, loaded only when a picture is
// made, so the rest of the app keeps making no network calls of its own (tests/unit/build.test.ts).
import { ImageError, imageProblem, isImageUrl } from "../chat";
import { mediaCache } from "./media";

/**
 * Asks the free service for a picture and keeps it. The service's refusals become ImageError (limit:
 * how long to wait; busy; unsafe). A network failure is "network".
 */
export async function fetchImage(url: string, signal?: AbortSignal): Promise<Blob> {
  if (!isImageUrl(url)) throw new ImageError("unknown");
  let res: Response;
  try {
    res = await fetch(url, { signal, mode: "cors", credentials: "omit", cache: "no-store" });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ImageError("network");
  }
  if (!res.ok || !(res.headers.get("content-type") ?? "").startsWith("image/")) {
    const body = res.ok ? "" : await res.text().catch(() => "");
    throw imageProblem(res.status, body, res.headers.get("retry-after"));
  }
  const blob = await res.blob();
  if (!blob.size) throw new ImageError("unknown");
  await mediaCache.put(url, blob);
  return blob;
}
