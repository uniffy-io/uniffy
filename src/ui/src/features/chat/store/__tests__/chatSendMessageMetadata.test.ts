import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

vi.mock("@/features/chat/api/chatApi", () => ({
  chatApi: { sendMessage: mocks.sendMessage },
}));

import { sendMessage } from "@/features/chat/store/chatThunks";
import type { RootState } from "@/app/store";

function protoMessage() {
  return {
    id: "m1",
    channelId: "ch-1",
    senderId: "u1",
    senderType: 1,
    content: "hi",
    metadata: {},
    reactions: [],
    isDeleted: false,
    isPinned: false,
    feedbackRating: "",
  };
}

const getState = () => ({ auth: { currentOrganizationId: "org-1" } }) as unknown as RootState;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendMessage.mockResolvedValue({ message: protoMessage() });
});

describe("sendMessage metadata pass-through", () => {
  it("forwards invoked-skill metadata onto the request", async () => {
    const thunk = sendMessage({
      channelId: "ch-1",
      content: "hi",
      metadata: { invoked_skill_id: "sk-1", invoked_skill_name: "summarize" },
    });
    await thunk(vi.fn(), getState, undefined);

    expect(mocks.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        channelId: "ch-1",
        content: "hi",
        metadata: { invoked_skill_id: "sk-1", invoked_skill_name: "summarize" },
      }),
    );
  });

  it("sends an empty metadata map when none is given", async () => {
    await sendMessage({ channelId: "ch-1", content: "hi" })(vi.fn(), getState, undefined);

    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ metadata: {} }));
  });
});
