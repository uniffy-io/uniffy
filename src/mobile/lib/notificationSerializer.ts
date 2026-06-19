import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Notification as ProtoNotification } from "@uniffy/proto/notifications/v1/notifications_pb";
import { NotificationType } from "@uniffy/proto/notifications/v1/notifications_pb";
import { DOMAIN_COLORS } from "@/constants/theme";

export type NotificationIconKind =
  | "share"
  | "mention"
  | "edit"
  | "calendar"
  | "task"
  | "chat"
  | "permission"
  | "system";

export interface SerializedNotification {
  id: string;
  title: string;
  body: string;
  actorName: string;
  actorAvatarUrl: string | null;
  isRead: boolean;
  createdAtSeconds: number;
  timeLabel: string;
  sourceUrn: string;
  route: string | null;
  iconKind: NotificationIconKind;
  accentColor: string;
}

function tsToSeconds(ts: Timestamp | undefined): number {
  if (!ts) return 0;
  return typeof ts.seconds === "bigint" ? Number(ts.seconds) : ts.seconds;
}

function relativeTime(seconds: number): string {
  if (!seconds) return "";
  const diffMs = Date.now() - seconds * 1000;
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(seconds * 1000).toLocaleDateString([], { month: "short", day: "numeric" });
}

const MENTION_RE = /\[\[\[([^|]+)\|[^\]]+\]\]\]/g;

function stripMentions(text: string): string {
  return text.replace(MENTION_RE, (_, label) => `@${label}`);
}

const TYPE_META: Record<number, { kind: NotificationIconKind; color: string }> = {
  [NotificationType.CONTENT_SHARED]: { kind: "share", color: DOMAIN_COLORS.files },
  [NotificationType.CONTENT_MENTIONED]: { kind: "mention", color: DOMAIN_COLORS.notes },
  [NotificationType.CONTENT_EDITED]: { kind: "edit", color: DOMAIN_COLORS.notes },
  [NotificationType.CALENDAR_REMINDER]: { kind: "calendar", color: DOMAIN_COLORS.calendar },
  [NotificationType.CALENDAR_INVITE]: { kind: "calendar", color: DOMAIN_COLORS.calendar },
  [NotificationType.CALENDAR_RESPONSE]: { kind: "calendar", color: DOMAIN_COLORS.calendar },
  [NotificationType.PERMISSION_GRANTED]: { kind: "permission", color: "#10b981" },
  [NotificationType.PERMISSION_REVOKED]: { kind: "permission", color: "#FA5252" },
  [NotificationType.SYSTEM_ANNOUNCEMENT]: { kind: "system", color: "#f59e0b" },
  [NotificationType.TASK_ASSIGNED]: { kind: "task", color: DOMAIN_COLORS.projects },
  [NotificationType.TASK_DUE_SOON]: { kind: "task", color: DOMAIN_COLORS.projects },
  [NotificationType.TASK_OVERDUE]: { kind: "task", color: "#FA5252" },
  [NotificationType.CHAT_MENTION]: { kind: "chat", color: DOMAIN_COLORS.chat },
  [NotificationType.CHAT_DM]: { kind: "chat", color: DOMAIN_COLORS.chat },
  [NotificationType.CHAT_CHANNEL_INVITE]: { kind: "chat", color: DOMAIN_COLORS.chat },
  [NotificationType.CHAT_CHANNEL_REMOVED]: { kind: "chat", color: DOMAIN_COLORS.chat },
  [NotificationType.CHAT_THREAD_REPLY]: { kind: "chat", color: DOMAIN_COLORS.chat },
};

const CONTENT_TYPE_ROUTE: Record<string, (id: string) => string> = {
  NOTE: (id) => `/notes/${id}`,
  FILE: (id) => `/files/${id}`,
  CHAT: (id) => `/chat/${id}`,
  CALENDAR_EVENT: (id) => `/calendar/${id}`,
  PROJECT: (id) => `/projects/${id}`,
  TASK: (id) => `/projects/task/${id}`,
};

/** Build a mobile route from a content URN (`urn:uniffy:content:TYPE:id`). */
export function routeFromUrn(urn: string): string | null {
  if (!urn) return null;
  const parts = urn.split(":");
  const type = parts[3];
  const id = parts[parts.length - 1];
  const builder = type ? CONTENT_TYPE_ROUTE[type] : undefined;
  return builder && id ? builder(id) : null;
}

export function notificationToPlain(proto: ProtoNotification): SerializedNotification {
  const meta = TYPE_META[proto.notificationType] ?? { kind: "system" as const, color: "#909296" };
  const createdAtSeconds = tsToSeconds(proto.createdAt);
  return {
    id: proto.id,
    title: stripMentions(proto.title),
    body: stripMentions(proto.body),
    actorName: proto.actorName || "",
    actorAvatarUrl: proto.actorAvatarUrl || null,
    isRead: proto.isRead,
    createdAtSeconds,
    timeLabel: relativeTime(createdAtSeconds),
    sourceUrn: proto.sourceUrn,
    route: routeFromUrn(proto.sourceUrn),
    iconKind: meta.kind,
    accentColor: meta.color,
  };
}
