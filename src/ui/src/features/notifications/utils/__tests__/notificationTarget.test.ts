import { describe, expect, it } from "vitest";
import { NotificationType } from "@uniffy/proto/notifications/v1/notifications_pb";
import { notificationTargetPath } from "../notificationTarget";

describe("notificationTargetPath for timesheets", () => {
  it("sends a reviewer to the approvals inbox of the period", () => {
    expect(
      notificationTargetPath({
        notificationType: NotificationType.TIMESHEET_SUBMITTED,
        sourceUrn: "",
        metadata: { period_start: "2026-10-12", audience: "reviewer" },
      }),
    ).toBe("/projects/time?tab=approvals&period=2026-10-12");
  });

  it("sends a worker to their own week", () => {
    expect(
      notificationTargetPath({
        notificationType: NotificationType.TIMESHEET_REJECTED,
        sourceUrn: "",
        metadata: { period_start: "2026-10-12", audience: "worker" },
      }),
    ).toBe("/projects/time?day=2026-10-12");
    expect(
      notificationTargetPath({
        notificationType: NotificationType.TIMESHEET_REMINDER,
        sourceUrn: "",
        metadata: {},
      }),
    ).toBe("/projects/time");
  });
});
