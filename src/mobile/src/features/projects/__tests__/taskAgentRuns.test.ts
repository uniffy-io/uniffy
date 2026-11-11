import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  TaskAgentAssignmentSchema,
  TaskAgentAssignmentStatus,
} from "@uniffy/proto/projects/v1/agents_pb";
import { TaskSchema } from "@uniffy/proto/projects/v1/projects_pb";
import {
  agentRunStatusLabel,
  canRequestAgentChanges,
  isAgentRunActive,
  isAgentRunOpen,
  taskToPlain,
  type SerializedTaskAgent,
} from "@features/projects/projectsSerializer";

function agentFrom(status: TaskAgentAssignmentStatus, extra: object = {}): SerializedTaskAgent {
  const task = taskToPlain(
    create(TaskSchema, {
      id: "t-1",
      agentAssignment: create(TaskAgentAssignmentSchema, {
        id: "a-1",
        agentId: "agent-1",
        agentName: "Writer",
        assignedById: "u-1",
        status,
        ...extra,
      }),
    }),
  );
  return task.agentAssignment!;
}

describe("task agent runs", () => {
  it("reads a scheduled run as open but not working yet", () => {
    const at = new Date("2026-11-11T14:00:00Z");
    const scheduled = agentFrom(TaskAgentAssignmentStatus.PENDING, {
      startAt: timestampFromDate(at),
    });
    expect(scheduled.startAt).toBe(at.toISOString());
    expect(agentRunStatusLabel(scheduled)).toBe("Scheduled");
    expect(isAgentRunActive(scheduled)).toBe(false);
    expect(isAgentRunOpen(scheduled)).toBe(true);
  });

  it("reads a held run as waiting for Start", () => {
    const waiting = agentFrom(TaskAgentAssignmentStatus.WAITING);
    expect(waiting.status).toBe("waiting");
    expect(agentRunStatusLabel(waiting)).toBe("Waiting to start");
    expect(isAgentRunOpen(waiting)).toBe(true);
  });

  it("offers changes only on an ended run with a session", () => {
    const done = agentFrom(TaskAgentAssignmentStatus.COMPLETED, { sessionId: "s-1" });
    expect(canRequestAgentChanges(done)).toBe(true);
    expect(canRequestAgentChanges(agentFrom(TaskAgentAssignmentStatus.COMPLETED))).toBe(false);
    expect(
      canRequestAgentChanges(agentFrom(TaskAgentAssignmentStatus.RUNNING, { sessionId: "s-1" })),
    ).toBe(false);
  });
});
