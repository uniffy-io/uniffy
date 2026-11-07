import { describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import {
  NotificationSchema,
  NotificationType,
} from "@uniffy/proto/notifications/v1/notifications_pb";
import { notificationToPlain, routeFromUrn } from "@features/notifications/notificationSerializer";

vi.mock("@features/chat/useJoinCallParam", () => ({
  JOIN_CALL_PARAM: "call",
  JOIN_CALL_VALUE: "join",
}));

function notification(notificationType: NotificationType, sourceUrn = "") {
  return create(NotificationSchema, { id: "n-1", notificationType, sourceUrn, title: "t" });
}

describe("calendar sync notifications", () => {
  it("send a reconnect notice to the calendar list as a warning", () => {
    const plain = notificationToPlain(
      notification(NotificationType.CALENDAR_CONNECTION_NEEDS_RECONNECT),
    );
    expect(plain.iconKind).toBe("calendar");
    expect(plain.tone).toBe("warning");
    expect(plain.route).toBe("/calendar");
    expect(plain.eventId).toBeNull();
  });

  it("open the event a sync conflict replaced", () => {
    const plain = notificationToPlain(
      notification(
        NotificationType.CALENDAR_SYNC_CONFLICT,
        "urn:uniffy:content:CALENDAR_EVENT:evt-1",
      ),
    );
    expect(plain.iconKind).toBe("calendar");
    expect(plain.tone).toBe("warning");
    expect(plain.route).toBe("/calendar/evt-1");
  });

  it("open the calendar a failing feed belongs to", () => {
    const plain = notificationToPlain(
      notification(
        NotificationType.CALENDAR_SUBSCRIPTION_FAILED,
        "urn:uniffy:content:CALENDAR:cal-1",
      ),
    );
    expect(plain.tone).toBe("warning");
    expect(plain.route).toBe("/calendar?calendar=cal-1");
  });

  it("route nowhere for a content type mobile cannot open", () => {
    expect(routeFromUrn("urn:uniffy:content:WHITEBOARD:x")).toBeNull();
    expect(routeFromUrn("")).toBeNull();
  });
});
