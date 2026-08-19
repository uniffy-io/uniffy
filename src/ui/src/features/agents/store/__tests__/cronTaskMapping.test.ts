import { describe, expect, it } from "vitest";
import type { CronTaskInfo } from "@uniffy/proto/agents/v1/cron_pb";
import { AccessMode, ContentRole } from "@uniffy/proto/common/v1/common_pb";
import { cronTaskToPlain } from "@/features/agents/store/agentCronThunks";

describe("cronTaskToPlain", () => {
  it("maps ownership and access-policy fields", () => {
    const proto = {
      id: "t1",
      organizationId: "org1",
      ownerId: "u1",
      agentId: "a1",
      executionUserId: "u1",
      name: "Daily digest",
      description: "",
      prompt: "Summarize yesterday",
      cronExpression: "0 9 * * *",
      timezone: "UTC",
      isEnabled: true,
      runCount: 3,
      consecutiveFailures: 0,
      maxConsecutiveFailures: 5,
      accessMode: AccessMode.EXPLICIT_MEMBERS,
      baselineRole: ContentRole.VIEWER,
      userRole: ContentRole.ADMIN,
    } as unknown as CronTaskInfo;
    const plain = cronTaskToPlain(proto);
    expect(plain.ownerId).toBe("u1");
    expect(plain.accessMode).toBe(AccessMode.EXPLICIT_MEMBERS);
    expect(plain.baselineRole).toBe(ContentRole.VIEWER);
    expect(plain.userRole).toBe(ContentRole.ADMIN);
  });

  it("keeps an absent user role as UNSPECIFIED", () => {
    const proto = {
      id: "t2",
      userRole: ContentRole.UNSPECIFIED,
    } as unknown as CronTaskInfo;
    expect(cronTaskToPlain(proto).userRole).toBe(ContentRole.UNSPECIFIED);
  });
});
