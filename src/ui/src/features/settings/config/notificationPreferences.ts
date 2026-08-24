export type NotificationDeliveryChannel = "in_app" | "browser" | "email";

interface NotificationPreferenceDefaults {
  in_app: boolean;
  browser: boolean;
  email: boolean;
}

export interface NotificationPreferenceRow {
  type: string;
  label: string;
  defaults: NotificationPreferenceDefaults;
  emailManaged?: boolean;
}

export interface NotificationPreferenceGroup {
  label: string;
  rows: NotificationPreferenceRow[];
}

export const NOTIFICATION_PREFERENCE_GROUPS: NotificationPreferenceGroup[] = [
  {
    label: "Workspace",
    rows: [
      {
        type: "CONTENT_SHARED",
        label: "Content shared with you",
        defaults: { in_app: true, browser: true, email: true },
      },
      {
        type: "CONTENT_MENTIONED",
        label: "Mentioned in content",
        defaults: { in_app: true, browser: true, email: true },
      },
      {
        type: "CONTENT_EDITED",
        label: "Shared content edited",
        defaults: { in_app: true, browser: false, email: false },
      },
    ],
  },
  {
    label: "Comments",
    rows: [
      {
        type: "COMMENT_ADDED",
        label: "Comment added",
        defaults: { in_app: true, browser: true, email: false },
      },
      {
        type: "COMMENT_REPLY",
        label: "Reply to your comment",
        defaults: { in_app: true, browser: true, email: true },
      },
      {
        type: "COMMENT_MENTIONED",
        label: "Mentioned in a comment",
        defaults: { in_app: true, browser: true, email: true },
      },
      {
        type: "COMMENT_RESOLVED",
        label: "Comment resolved",
        defaults: { in_app: true, browser: false, email: false },
      },
    ],
  },
  {
    label: "Tasks",
    rows: [
      {
        type: "TASK_ASSIGNED",
        label: "Task assigned to you",
        defaults: { in_app: true, browser: true, email: true },
      },
      {
        type: "TASK_DUE_SOON",
        label: "Task due soon",
        defaults: { in_app: true, browser: true, email: true },
      },
      {
        type: "TASK_OVERDUE",
        label: "Task overdue",
        defaults: { in_app: true, browser: true, email: true },
      },
    ],
  },
  {
    label: "Calendar",
    rows: [
      {
        type: "CALENDAR_REMINDER",
        label: "Event reminder",
        defaults: { in_app: true, browser: true, email: false },
      },
      {
        type: "CALENDAR_INVITE",
        label: "Calendar invitation",
        defaults: { in_app: true, browser: true, email: true },
      },
      {
        type: "CALENDAR_RESPONSE",
        label: "Invitation response",
        defaults: { in_app: true, browser: false, email: false },
      },
      {
        type: "CALENDAR_CANCELLED",
        label: "Event cancelled",
        defaults: { in_app: true, browser: true, email: true },
      },
    ],
  },
  {
    label: "Chat",
    rows: [
      {
        type: "CHAT_MENTION",
        label: "Mentioned in chat",
        defaults: { in_app: true, browser: true, email: true },
      },
      {
        type: "CHAT_DM",
        label: "Direct message",
        defaults: { in_app: true, browser: true, email: true },
      },
      {
        type: "CHAT_CHANNEL_INVITE",
        label: "Added to a channel",
        defaults: { in_app: true, browser: false, email: false },
      },
      {
        type: "CHAT_CHANNEL_REMOVED",
        label: "Removed from a channel",
        defaults: { in_app: true, browser: false, email: false },
      },
      {
        type: "CHAT_THREAD_REPLY",
        label: "Thread reply",
        defaults: { in_app: true, browser: false, email: false },
      },
    ],
  },
  {
    label: "Access",
    rows: [
      {
        type: "PERMISSION_GRANTED",
        label: "Access granted",
        defaults: { in_app: true, browser: false, email: true },
      },
      {
        type: "PERMISSION_REVOKED",
        label: "Access revoked",
        defaults: { in_app: true, browser: false, email: true },
      },
      {
        type: "ACCESS_REQUESTED",
        label: "Access requested",
        defaults: { in_app: true, browser: true, email: true },
      },
      {
        type: "ACCESS_REQUEST_DENIED",
        label: "Access request denied",
        defaults: { in_app: true, browser: true, email: false },
      },
    ],
  },
  {
    label: "Agents",
    rows: [
      {
        type: "AGENTS_BUDGET_ALERT",
        label: "Agent budget alert",
        defaults: { in_app: true, browser: true, email: true },
      },
    ],
  },
  {
    label: "System and security",
    rows: [
      {
        type: "SYSTEM_ANNOUNCEMENT",
        label: "System announcement",
        defaults: { in_app: true, browser: true, email: true },
      },
      {
        type: "SUPPORT_SESSION_REQUESTED",
        label: "Support session requested",
        defaults: { in_app: true, browser: true, email: false },
        emailManaged: true,
      },
      {
        type: "SUPPORT_SESSION_STARTED",
        label: "Support session started",
        defaults: { in_app: true, browser: true, email: false },
        emailManaged: true,
      },
      {
        type: "SUPPORT_SESSION_REVOKED",
        label: "Support session revoked",
        defaults: { in_app: true, browser: true, email: false },
        emailManaged: true,
      },
      {
        type: "SUPPORT_SESSION_EXPIRED",
        label: "Support session expired",
        defaults: { in_app: true, browser: true, email: false },
      },
    ],
  },
];
