import { describe, expect, it } from "vitest";
import {
  broadcastKindFromUrn,
  broadcastMentionsIn,
  broadcastUrn,
  buildBroadcastEntries,
  effectiveBroadcastKind,
} from "@/features/chat/utils/broadcastMentions";

describe("broadcastKindFromUrn", () => {
  it("maps the two broadcast urns", () => {
    expect(broadcastKindFromUrn("urn:uniffy:broadcast:channel")).toBe("channel");
    expect(broadcastKindFromUrn("urn:uniffy:broadcast:here")).toBe("here");
  });

  it("rejects unknown kinds and other schemes", () => {
    expect(broadcastKindFromUrn("urn:uniffy:broadcast:everyone")).toBeNull();
    expect(broadcastKindFromUrn("urn:uniffy:broadcast:admins")).toBeNull();
    expect(broadcastKindFromUrn("urn:uniffy:content:USER:x")).toBeNull();
  });
});

describe("broadcastMentionsIn", () => {
  it("collects unique kinds from markup", () => {
    const markdown = [
      `[[[@channel|${broadcastUrn("channel")}]]]`,
      `[[[@here|${broadcastUrn("here")}]]]`,
      `[[[@channel|${broadcastUrn("channel")}]]]`,
      "[[[Ada|urn:uniffy:content:USER:33333333-3333-3333-3333-333333333333]]]",
    ].join(" ");
    expect(broadcastMentionsIn(markdown).sort()).toEqual(["channel", "here"]);
  });

  it("ignores plain-text @channel", () => {
    expect(broadcastMentionsIn("hey @channel")).toEqual([]);
  });
});

describe("effectiveBroadcastKind", () => {
  it("widens here+channel to channel", () => {
    expect(effectiveBroadcastKind(["here", "channel"])).toBe("channel");
  });

  it("keeps a lone @here", () => {
    expect(effectiveBroadcastKind(["here"])).toBe("here");
  });

  it("returns null for no kinds", () => {
    expect(effectiveBroadcastKind([])).toBeNull();
  });
});

describe("buildBroadcastEntries", () => {
  it("labels entries the way chips store them", () => {
    const entries = buildBroadcastEntries();
    expect(entries.map((e) => e.title)).toEqual(["@channel", "@here"]);
    expect(entries.map((e) => e.urn)).toEqual([
      "urn:uniffy:broadcast:channel",
      "urn:uniffy:broadcast:here",
    ]);
  });
});
