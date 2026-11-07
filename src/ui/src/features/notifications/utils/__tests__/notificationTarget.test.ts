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

describe("notificationTargetPath for connected calendars", () => {
  it("opens the account's connections when it must be reconnected", () => {
    expect(
      notificationTargetPath({
        notificationType: NotificationType.CALENDAR_CONNECTION_NEEDS_RECONNECT,
        sourceUrn: "",
        metadata: { connection_id: "c-1", provider: "google" },
      }),
    ).toBe("/calendar?connections=c-1");
  });

  it("opens the event a sync conflict replaced", () => {
    const path = notificationTargetPath({
      notificationType: NotificationType.CALENDAR_SYNC_CONFLICT,
      sourceUrn: "urn:uniffy:content:CALENDAR_EVENT:0b6a3b52-7a43-4d55-8f0d-3f6a7c1b9d10",
      metadata: {},
    });
    expect(path).toBe("/calendar/0b6a3b52-7a43-4d55-8f0d-3f6a7c1b9d10");
  });
});
