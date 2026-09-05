import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
}));

vi.mock("@/features/chat/api/chatApi", () => ({
  chatApi: { sendMessage: mocks.sendMessage },
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

const getState = () => ({ auth: { currentOrganizationId: "org-1" } }) as unknown as RootState;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.sendMessage.mockResolvedValue({ message: protoMessage() });
});

describe("sendMessage metadata pass-through", () => {
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
