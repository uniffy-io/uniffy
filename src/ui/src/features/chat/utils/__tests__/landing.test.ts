import { describe, expect, it } from "vitest";
import type { ChatChannel } from "@/features/chat/types";
import { chooseChatLanding } from "@/features/chat/utils/landing";

function channel(id: string): ChatChannel {
  return { id } as ChatChannel;
}

describe("chooseChatLanding", () => {
  it("keeps an accessible last-opened channel", () => {
    expect(chooseChatLanding([channel("first"), channel("recent")], "recent")).toBe("recent");
  });

  it("falls back to the first accessible channel when the saved channel is stale", () => {
    expect(chooseChatLanding([channel("first"), channel("second")], "missing")).toBe("first");
  });

  it("returns null for an empty chat workspace", () => {
    expect(chooseChatLanding([], "missing")).toBeNull();
  });
});
