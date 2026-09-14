import { describe, expect, it } from "vitest";

import { firstUnreadMessageId } from "@/features/chat/utils/readCursor";

describe("firstUnreadMessageId", () => {
  const window = ["m1", "m2", "m3", "m4"];

  it("returns the message after the cursor", () => {
    expect(firstUnreadMessageId(window, "m2")).toBe("m3");
  });

  it("treats a cursor outside the loaded window as everything unread", () => {
    // The real first unread is older than anything loaded, so the top of the
    // window is the closest anchor the client can render.
    expect(firstUnreadMessageId(window, "older-than-window")).toBe("m1");
  });

  it("treats a missing cursor as never read", () => {
    expect(firstUnreadMessageId(window, undefined)).toBe("m1");
  });

  it("returns null when the cursor is the newest message", () => {
    expect(firstUnreadMessageId(window, "m4")).toBeNull();
  });

  it("returns null for an empty window", () => {
    expect(firstUnreadMessageId([], "m1")).toBeNull();
  });

  it("does not depend on unread count arithmetic past the 100 cap", () => {
    // 150 unread with a 100-cap count: the arithmetic would land at index 50
    // of a 120-row window; the anchor lands on the row after the cursor.
    const long = Array.from({ length: 120 }, (_, i) => `m${i}`);
    expect(firstUnreadMessageId(long, "m20")).toBe("m21");
  });
});
