import { describe, expect, it } from "vitest";
import { NotificationType } from "@uniffy/proto/notifications/v1/notifications_pb";
import { notificationActionFor } from "@/features/notifications/hooks/useNotificationAction";
import {
  meetingChannelIdFor,
  notificationHref,
} from "@/features/notifications/utils/notificationTarget";
import type { SerializedNotification } from "@/features/notifications/store/notificationsSlice";

const EVENT_URN = "urn:uniffy:content:CALENDAR_EVENT:019fc01f-12b6-7f11-a7f1-a3197c6cefca";

function notification(
  notificationType: NotificationType,
  overrides: Partial<SerializedNotification> = {},
): SerializedNotification {
  return {
    id: "notification-1",
    organizationId: "org-1",
    userId: "user-1",
    notificationType,
    title: "Standup starts in 10 minutes",
    body: "",
    sourceUrn: EVENT_URN,
    actorId: "",
    actorName: "",
    actorAvatarUrl: "",
    isRead: false,
    readAt: null,
    createdAt: "2026-08-26T10:00:00.000Z",
    expiresAt: null,
    metadata: {},
    ...overrides,
  };
}

describe("meeting reminder notification actions", () => {
  it("opens pre-join for a reminder whose event is bound to a channel", () => {
    const item = notification(NotificationType.CALENDAR_REMINDER, {
      metadata: { channel_id: "channel-1" },
    });

    expect(meetingChannelIdFor(item)).toBe("channel-1");
    expect(notificationActionFor(item)).toEqual({
      kind: "join_meeting",
      channelId: "channel-1",
    });
  });

  it("still navigates to the event when the reminder has no meeting", () => {
    const item = notification(NotificationType.CALENDAR_REMINDER);

    expect(meetingChannelIdFor(item)).toBeNull();
    expect(notificationActionFor(item)).toEqual({
      kind: "navigate",
      path: "/calendar/019fc01f-12b6-7f11-a7f1-a3197c6cefca",
    });
  });

  it("does not treat a channel id on another notification type as a meeting", () => {
    const item = notification(NotificationType.CALENDAR_INVITE, {
      metadata: { channel_id: "channel-1" },
    });

    expect(meetingChannelIdFor(item)).toBeNull();
  });
});

describe("notificationHref", () => {
  it("carries the join intent for surfaces that navigate rather than dispatch", () => {
    const item = notification(NotificationType.CALENDAR_REMINDER, {
      metadata: { channel_id: "channel-1" },
    });

    expect(notificationHref(item)).toBe("/chat/channel-1?call=join");
  });

  it("falls back to the ordinary route for an unbound reminder", () => {
    expect(notificationHref(notification(NotificationType.CALENDAR_REMINDER))).toBe(
      "/calendar/019fc01f-12b6-7f11-a7f1-a3197c6cefca",
    );
  });

  it("leaves other notification types routing normally", () => {
    const item = notification(NotificationType.CHAT_MENTION, {
      metadata: { channel_id: "channel-1", message_id: "message-1" },
    });

    expect(notificationHref(item)).toBe("/chat/channel-1#message-1");
  });
});
