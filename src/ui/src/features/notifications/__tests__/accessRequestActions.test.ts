import { describe, expect, it } from "vitest";
import { NotificationType } from "@uniffy/proto/notifications/v1/notifications_pb";
import {
  isReviewableAccessRequest,
  notificationActionFor,
} from "@/features/notifications/hooks/useNotificationAction";
import type { SerializedNotification } from "@/features/notifications/store/notificationsSlice";

function notification(
  notificationType: NotificationType,
  overrides: Partial<SerializedNotification> = {},
): SerializedNotification {
  return {
    id: "notification-1",
    organizationId: "org-1",
    userId: "user-1",
    notificationType,
    title: "Title",
    body: "",
    sourceUrn: "",
    actorId: "",
    actorName: "",
    actorAvatarUrl: "",
    isRead: false,
    readAt: null,
    createdAt: "2026-08-16T10:00:00.000Z",
    expiresAt: null,
    metadata: {},
    ...overrides,
  };
}

describe("access request notification actions", () => {
  it("opens the review workflow instead of navigating to the source", () => {
    const item = notification(NotificationType.ACCESS_REQUESTED, {
      sourceUrn: "urn:uniffy:content:NOTE:019fc01f-12b6-7f11-a7f1-a3197c6cefca",
      metadata: { request_id: "request-1" },
    });

    expect(isReviewableAccessRequest(item)).toBe(true);
    expect(notificationActionFor(item)).toEqual({
      kind: "review_access_request",
      requestId: "request-1",
    });
  });

  it("keeps stale notifications without a request id non-actionable", () => {
    const item = notification(NotificationType.ACCESS_REQUESTED, {
      sourceUrn: "urn:uniffy:content:NOTE:019fc01f-12b6-7f11-a7f1-a3197c6cefca",
    });

    expect(isReviewableAccessRequest(item)).toBe(false);
    expect(notificationActionFor(item)).toEqual({ kind: "none" });
  });

  it("does not send denial notifications into the owner review flow", () => {
    const item = notification(NotificationType.ACCESS_REQUEST_DENIED, {
      metadata: {
        request_id: "request-1",
        requested_urn: "urn:uniffy:content:NOTE:019fc01f-12b6-7f11-a7f1-a3197c6cefca",
      },
    });

    expect(isReviewableAccessRequest(item)).toBe(false);
    expect(notificationActionFor(item)).toEqual({ kind: "none" });
  });

  it("preserves ordinary notification navigation", () => {
    const item = notification(NotificationType.CONTENT_SHARED, {
      sourceUrn: "urn:uniffy:content:NOTE:019fc01f-12b6-7f11-a7f1-a3197c6cefca",
    });

    expect(notificationActionFor(item)).toEqual({
      kind: "navigate",
      path: "/notes/019fc01f-12b6-7f11-a7f1-a3197c6cefca",
    });
  });
});
