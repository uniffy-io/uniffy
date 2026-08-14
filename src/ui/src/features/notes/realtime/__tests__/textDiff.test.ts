import { describe, expect, it } from "vitest";
import { diffStrings } from "@/features/notes/realtime/textDiff";

function applyDelta(prev: string, next: string): string {
  const delta = diffStrings(prev, next);
  if (!delta) return prev;
  return prev.slice(0, delta.index) + delta.insert + prev.slice(delta.index + delta.deleteCount);
}

describe("diffStrings", () => {
  it("returns null for equal strings", () => {
    expect(diffStrings("same", "same")).toBeNull();
    expect(diffStrings("", "")).toBeNull();
  });

  it("produces a delta bounded by the changed region, not the doc", () => {
    const prev = `# Title\n\n${"lorem ipsum ".repeat(200)}end`;
    const next = prev.replace("end", "end!");
    const delta = diffStrings(prev, next);
    expect(delta).not.toBeNull();
    expect(delta!.deleteCount).toBe(0);
    expect(delta!.insert).toBe("!");
  });

  it("reconstructs the target for inserts, deletes, and replacements", () => {
    const cases: Array<[string, string]> = [
      ["", "fresh"],
      ["gone", ""],
      ["hello world", "hello brave world"],
      ["hello brave world", "hello world"],
      ["abcdef", "abXYef"],
      ["aaaa", "aa"],
      ["aa", "aaaa"],
      ["repeat repeat", "repeat mid repeat"],
    ];
    for (const [prev, next] of cases) {
      expect(applyDelta(prev, next)).toBe(next);
    }
  });

  it("handles multi-byte and surrogate-pair content", () => {
    expect(applyDelta("café", "cafés")).toBe("cafés");
    expect(applyDelta("a\u{1F600}b", "a\u{1F601}b")).toBe("a\u{1F601}b");
  });
});
