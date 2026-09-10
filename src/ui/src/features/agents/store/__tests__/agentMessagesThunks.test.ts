import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RootState } from "@/app/store";
import { runtimeApi } from "@/features/agents/api/runtimeApi";
import { streamSendMessage } from "@/features/agents/store/agentMessagesThunks";
import { createAgentStreamConsumer } from "@/features/agents/store/agentStreamFold";

vi.mock("@/features/agents/api/runtimeApi", () => ({ runtimeApi: { streamSendMessage: vi.fn() } }));
vi.mock("@/features/agents/store/agentStreamFold", () => ({ createAgentStreamConsumer: vi.fn() }));
vi.mock("@/shared/utils/timezone", () => ({ getEffectiveTimeZone: () => "UTC" }));

const params = {
  sessionId: "session",
  content: "User context",
  invokedSkillId: "skill",
  invokedSkillName: "report",
};
const getState = () => ({ auth: { currentOrganizationId: "org" } }) as RootState;
const dispose = vi.fn();
const handle = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  handle.mockReset();
  vi.mocked(createAgentStreamConsumer).mockReturnValue({ handle, dispose });
  vi.mocked(runtimeApi.streamSendMessage).mockReturnValue(
    (async function* () {
      yield {} as never;
    })(),
  );
});

describe("session send acknowledgement", () => {
  it.each(["done", "cancelled"] as const)(
    "distinguishes %s from rejected sends",
    async (status) => {
      handle.mockReturnValue({ status });
      const action = await streamSendMessage(params)(vi.fn(), getState, undefined);
      expect(streamSendMessage.fulfilled.match(action)).toBe(true);
      expect(action.payload).toBe(status);
      expect(runtimeApi.streamSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org",
          content: "User context",
          invokedSkillId: "skill",
        }),
      );
      expect(dispose).toHaveBeenCalledOnce();
    },
  );

  it("rejects typed invocation errors so the composer can retain the draft", async () => {
    handle.mockReturnValue({ status: "error", errorMessage: "Skill is unavailable" });
    const action = await streamSendMessage(params)(vi.fn(), getState, undefined);
    expect(streamSendMessage.rejected.match(action)).toBe(true);
    expect(action.payload).toBe("Skill is unavailable");
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("rejects a stream that closes without a terminal outcome", async () => {
    handle.mockReturnValue(null);
    const action = await streamSendMessage(params)(vi.fn(), getState, undefined);
    expect(streamSendMessage.rejected.match(action)).toBe(true);
    expect(action.payload).toBe("Stream ended before completion");
    expect(dispose).toHaveBeenCalledOnce();
  });

  it("rejects transport failure", async () => {
    vi.mocked(runtimeApi.streamSendMessage).mockReturnValue(
      (async function* () {
        yield {} as never;
        throw new Error("Connection lost");
      })(),
    );
    const action = await streamSendMessage(params)(vi.fn(), getState, undefined);
    expect(streamSendMessage.rejected.match(action)).toBe(true);
    expect(action.payload).toBe("Connection lost");
    expect(dispose).toHaveBeenCalledOnce();
  });
});
