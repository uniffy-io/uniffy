import { describe, expect, it } from "vitest";
import { draftChannelIds } from "@features/chat/draftIndicators";
import type { SerializedDraft } from "@features/chat/chatSerializer";

function draft(channelId: string, rootMessageId: string | null = null): SerializedDraft {
  return { channelId, rootMessageId, content: "unsent", updatedAt: "2026-09-16T00:00:00Z" };
}

describe("mobile draft indicators", () => {
  it("hides autosaved text in the current chat and shows it after navigation", () => {
    const drafts = { first: draft("first") };
    expect(draftChannelIds(drafts, "/chat/first")).toEqual(new Set());
    expect(draftChannelIds(drafts, "/chat/second")).toEqual(new Set(["first"]));
    expect(draftChannelIds(drafts, "/chat/first")).toEqual(new Set());
    expect(drafts.first.content).toBe("unsent");
  });

  it.each(["/chat", "/notes", "/calendar", "/chat/create"])("shows saved drafts on %s", (path) => {
    expect(draftChannelIds({ first: draft("first") }, path)).toEqual(new Set(["first"]));
  });

  it("hides only the open thread while other thread drafts retain the channel marker", () => {
    const drafts = { "first:root": draft("first", "root") };
    expect(draftChannelIds(drafts, "/chat/thread/root")).toEqual(new Set());
    expect(draftChannelIds(drafts, "/chat/first")).toEqual(new Set(["first"]));
    expect(
      draftChannelIds({ ...drafts, "first:other": draft("first", "other") }, "/chat/thread/root"),
    ).toEqual(new Set(["first"]));
  });

  it("retains a channel draft marker while composing a reply in its thread", () => {
    expect(draftChannelIds({ first: draft("first") }, "/chat/thread/root")).toEqual(
      new Set(["first"]),
    );
  });

  it("handles drafts before the initial snapshot arrives", () => {
    expect(draftChannelIds(undefined, "/chat/first")).toEqual(new Set());
  });
});
