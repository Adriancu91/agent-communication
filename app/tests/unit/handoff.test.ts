// AIW-05.1: text shared into the app (Android share sheet) and the reply waiting between screens.
import { describe, expect, it } from "vitest";
import { captureSharedText, readSharedText, clearSharedText, setPendingReply, sharedText, takePendingReply } from "../../src/ui/handoff";

function fakes(search: string) {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } as unknown as Storage;
  const calls: string[] = [];
  const loc = { search, pathname: "/agent-communication/" } as Location;
  const hist = { replaceState: (_a: unknown, _b: string, url: string) => calls.push(url) } as unknown as History;
  return { storage, store, calls, loc, hist };
}

describe("share target", () => {
  it("keeps the shared reply and removes it from the address at once", () => {
    const f = fakes("?aiw_title=ChatGPT&aiw_text=" + encodeURIComponent("Răspuns\n```aiw-propuneri\n[]\n```"));
    expect(captureSharedText(f.loc, f.hist, f.storage)).toBe(true);
    expect(f.calls).toEqual(["/agent-communication/#/primire"]); // no text left in the address / history
    expect(f.store.get("aiw.shared")).toBe("ChatGPT\n\nRăspuns\n```aiw-propuneri\n[]\n```");
    expect(readSharedText()).toContain("Răspuns");
    clearSharedText();
  });

  it("does nothing for a normal start", () => {
    const f = fakes("");
    expect(captureSharedText(f.loc, f.hist, f.storage)).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it("joins title, text and link without repeating them", () => {
    expect(sharedText(["Titlu", "Titlu\nText complet", "https://chatgpt.com/share/x"])).toBe("Titlu\nText complet\n\nhttps://chatgpt.com/share/x");
    expect(sharedText(["", "  ", "Doar text"])).toBe("Doar text");
  });

  it("a reply waiting for one session is not given to another", () => {
    setPendingReply("S-1", "pentru S-1");
    expect(takePendingReply("S-2")).toBeNull();
    expect(takePendingReply("S-1")).toBe("pentru S-1");
    expect(takePendingReply("S-1")).toBeNull(); // taken once
  });
});
