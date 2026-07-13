import type { Timestamp } from "@bufbuild/protobuf/wkt";
import type { Notification as ProtoNotification } from "@uniffy/proto/notifications/v1/notifications_pb";
import { NotificationType } from "@uniffy/proto/notifications/v1/notifications_pb";
import type { DomainKey } from "@theme/theme";

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
  domain: DomainKey;
  tone: "danger" | "warning" | null;
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

type TypeMeta = { kind: NotificationIconKind; domain: DomainKey; tone?: "danger" | "warning" };

const TYPE_META: Record<number, TypeMeta> = {
  [NotificationType.CONTENT_SHARED]: { kind: "share", domain: "files" },
  [NotificationType.CONTENT_MENTIONED]: { kind: "mention", domain: "notes" },
  [NotificationType.CONTENT_EDITED]: { kind: "edit", domain: "notes" },
  [NotificationType.CALENDAR_REMINDER]: { kind: "calendar", domain: "calendar" },
  [NotificationType.CALENDAR_INVITE]: { kind: "calendar", domain: "calendar" },
  [NotificationType.CALENDAR_RESPONSE]: { kind: "calendar", domain: "calendar" },
  [NotificationType.PERMISSION_GRANTED]: { kind: "permission", domain: "projects" },
  [NotificationType.PERMISSION_REVOKED]: { kind: "permission", domain: "projects", tone: "danger" },
  [NotificationType.SYSTEM_ANNOUNCEMENT]: { kind: "system", domain: "calendar", tone: "warning" },
  [NotificationType.TASK_ASSIGNED]: { kind: "task", domain: "projects" },
  [NotificationType.TASK_DUE_SOON]: { kind: "task", domain: "projects", tone: "warning" },
  [NotificationType.TASK_OVERDUE]: { kind: "task", domain: "projects", tone: "danger" },
  [NotificationType.CHAT_MENTION]: { kind: "chat", domain: "chat" },
  [NotificationType.CHAT_DM]: { kind: "chat", domain: "chat" },
  [NotificationType.CHAT_CHANNEL_INVITE]: { kind: "chat", domain: "chat" },
  [NotificationType.CHAT_CHANNEL_REMOVED]: { kind: "chat", domain: "chat", tone: "danger" },
  [NotificationType.CHAT_THREAD_REPLY]: { kind: "chat", domain: "chat" },
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
  const meta = TYPE_META[proto.notificationType] ?? {
    kind: "system" as const,
    domain: "chat" as const,
  };
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
    domain: meta.domain,
    tone: meta.tone ?? null,
  };
}
