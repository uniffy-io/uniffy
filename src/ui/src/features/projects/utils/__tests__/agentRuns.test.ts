import { describe, expect, it } from "vitest";
import type { TaskAgentAssignment } from "@/features/projects/types/project";
import {
  agentRunStatusLabel,
  canRequestAgentChanges,
  isAgentRunActive,
  isAgentRunOpen,
  isAgentRunScheduled,
} from "@/features/projects/utils/agentRuns";

function run(overrides: Partial<TaskAgentAssignment> = {}): TaskAgentAssignment {
  return {
    id: "a-1",
    agentId: "agent-1",
    agentName: "Writer",
    agentAvatarEmoji: null,
    agentIsDeleted: false,
    assignedById: "user-1",
    status: "pending",
    reason: "task",
    sessionId: null,
    runId: null,
    createdAt: "2026-11-11T10:00:00.000Z",
    endedAt: null,
    startAt: null,
    ...overrides,
  };
}

describe("agent run states", () => {
  it("treats a scheduled run as open but not yet active", () => {
    const scheduled = run({ startAt: "2026-11-11T14:00:00.000Z" });
    expect(isAgentRunScheduled(scheduled)).toBe(true);
    expect(isAgentRunActive(scheduled)).toBe(false);
    expect(isAgentRunOpen(scheduled)).toBe(true);
    expect(agentRunStatusLabel(scheduled)).toBe("Scheduled");
  });

  it("keeps a waiting run open and idle until someone starts it", () => {
    const waiting = run({ status: "waiting" });
    expect(isAgentRunActive(waiting)).toBe(false);
    expect(isAgentRunOpen(waiting)).toBe(true);
    expect(agentRunStatusLabel(waiting)).toBe("Waiting to start");
  });

  it("offers changes only on an ended run with a session and a live agent", () => {
    expect(canRequestAgentChanges(run({ status: "completed", sessionId: "s-1" }))).toBe(true);
    expect(canRequestAgentChanges(run({ status: "stopped", sessionId: "s-1" }))).toBe(true);
    expect(canRequestAgentChanges(run({ status: "running", sessionId: "s-1" }))).toBe(false);
    expect(canRequestAgentChanges(run({ status: "stopped", sessionId: null }))).toBe(false);
    expect(canRequestAgentChanges(run({ status: "skipped", sessionId: "s-1" }))).toBe(false);
    expect(
      canRequestAgentChanges(run({ status: "completed", sessionId: "s-1", agentIsDeleted: true })),
    ).toBe(false);
  });
});
