import { describe, expect, it } from "vitest";
import { NotificationType } from "@uniffy/proto/notifications/v1/notifications_pb";
import { NOTIFICATION_PREFERENCE_GROUPS } from "@/features/settings/config/notificationPreferences";

describe("notification preference catalog", () => {
  it("covers every notification type exactly once", () => {
    const configured = NOTIFICATION_PREFERENCE_GROUPS.flatMap((group) =>
      group.rows.map((row) => row.type),
    );
    const notificationTypes = Object.keys(NotificationType).filter(
      (key) => Number.isNaN(Number(key)) && key !== "UNSPECIFIED",
    );

    expect(new Set(configured)).toEqual(new Set(notificationTypes));
    expect(configured).toHaveLength(notificationTypes.length);
  });
});
