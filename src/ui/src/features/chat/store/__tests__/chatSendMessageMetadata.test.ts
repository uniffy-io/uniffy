import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock("@/features/chat/api/chatApi", () => ({
  chatApi: { sendMessage: mocks.sendMessage },
}));

vi.mock("@/features/chat/utils/pendingSends", () => ({
  preparePendingSend: mocks.prepare,
  forgetPendingSend: vi.fn().mockResolvedValue(undefined),
}));

import { sendMessage } from "@/features/chat/store/chatThunks";
import type { RootState } from "@/app/store";
import { matchLeadingSkillCommand } from "@/features/agents/utils/slashCommands";

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
  };
}

const getState = () =>
  ({
    auth: { currentOrganizationId: "org-1", user: { id: "u1" } },
    chatDrafts: { byKey: {} },
    chatChannels: { revisionsById: {} },
  }) as unknown as RootState;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockImplementation(async (userId, organizationId, request) => ({
    userId,
    organizationId,
    request,
  }));
  mocks.sendMessage.mockResolvedValue({ message: protoMessage() });
});

describe("sendMessage metadata pass-through", () => {
  it("renders before the request completes and removes pending state on failure", async () => {
    let rejectRequest!: (reason: Error) => void;
    mocks.sendMessage.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectRequest = reject;
      }),
    );
    const dispatch = vi.fn();
    const result = sendMessage({ channelId: "ch-1", content: "hi", clientMessageId: "send-1" })(
      dispatch,
      getState,
      undefined,
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "chatMessages/appendMessage",
        payload: expect.objectContaining({
          message: expect.objectContaining({ content: "hi", sendStatus: "sending" }),
        }),
      }),
    );
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledOnce());
    rejectRequest(new Error("Unavailable"));
    expect((await result).meta.requestStatus).toBe("rejected");
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "chatMessages/removeMessage" }),
    );
    expect(dispatch.mock.calls.some(([action]) => action.type === "chatDrafts/draftRemoved")).toBe(
      false,
    );
  });
  it("preserves client identity across repeated send attempts", async () => {
    const params = { channelId: "ch-1", content: "hi", clientMessageId: "send-1" };
    await sendMessage(params)(vi.fn(), getState, undefined);
    await sendMessage(params)(vi.fn(), getState, undefined);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    for (const [request] of mocks.sendMessage.mock.calls) {
      expect(request.clientMessageId).toBe("send-1");
    }
  });
  it("strips only the leading command and sends the remainder unchanged as user content", async () => {
    const skills = [
      { id: "sk-1", name: "summarize" },
      { id: "sk-2", name: "review" },
    ];
    const content =
      "First line\n/review remains text\n[[[Note|urn:uniffy:content:NOTE:n1]]]\n{{input}}";
    const command = matchLeadingSkillCommand(`/summarize ${content}`, skills);
    expect(command).not.toBeNull();
    if (!command) throw new Error("Expected a leading skill command");

    await sendMessage({
      channelId: "ch-1",
      content: command.rest,
      metadata: {
        invoked_skill_id: command.skill.id,
        invoked_skill_name: command.skill.name,
      },
    })(vi.fn(), getState, undefined);

    expect(mocks.sendMessage).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        content,
        metadata: { invoked_skill_id: "sk-1", invoked_skill_name: "summarize" },
      }),
    );
  });

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

it("coalesces a reconnect retry with the already running send", async () => {
  let finish!: (value: unknown) => void;
  mocks.sendMessage.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const params = { channelId: "ch-1", content: "hi", clientMessageId: "same" };
  const first = sendMessage(params)(vi.fn(), getState, undefined);
  const retry = sendMessage(params)(vi.fn(), getState, undefined);
  await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledOnce());
  finish({ message: protoMessage() });
  await Promise.all([first, retry]);
  expect(mocks.sendMessage).toHaveBeenCalledOnce();
});
