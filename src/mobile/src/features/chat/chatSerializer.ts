import type { Timestamp } from "@bufbuild/protobuf/wkt";
import { formatCompactAge } from "@shared/lib/dateFormatting";
import {
  ChannelType as ProtoChannelType,
  ChannelRole as ProtoChannelRole,
  SenderType as ProtoSenderType,
  ChatNotificationLevel as ProtoNotificationLevel,
  ChatBroadcastMinRole as ProtoChatBroadcastMinRole,
  ChatEditHistoryVisibility as ProtoChatEditHistoryVisibility,
} from "@uniffy/proto/chat/v1/chat_pb";
import { SubjectType as ProtoSubjectType } from "@uniffy/proto/common/v1/common_pb";
import type {
  ChatChannel as ProtoChatChannel,
  ChatMessage as ProtoChatMessage,
  ChatChannelMember as ProtoChatChannelMember,
  ReactionGroup as ProtoReactionGroup,
  ThreadInboxItem as ProtoThreadInboxItem,
  ChatChannelCategory as ProtoChatChannelCategory,
  AgentChatFolder as ProtoAgentChatFolder,
  PendingAgentApproval as ProtoPendingAgentApproval,
  ChatDraft as ProtoChatDraft,
} from "@uniffy/proto/chat/v1/chat_pb";

export type ChannelType = "PUBLIC" | "PRIVATE" | "DIRECT" | "GROUP_DM";
export type ChannelRole = "OWNER" | "ADMIN" | "MEMBER";
export type SenderType = "USER" | "AGENT" | "SYSTEM" | "GUEST";
export type NotificationLevel = "ALL" | "MENTIONS" | "NONE";

export interface SerializedReaction {
  emoji: string;
  count: number;
  userIds: string[];
  currentUserReacted: boolean;
}

export interface SerializedReplyContext {
  id: string;
  senderName: string;
  contentPreview: string;
}

export interface SerializedAttachment {
  id: string;
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface SerializedChannel {
  id: string;
  organizationId: string;
  ownerId: string;
  name: string;
  slug: string;
  description: string;
  channelType: ChannelType;
  icon: string | null;
  isArchived: boolean;
  isDefault: boolean;
  isAgentDm: boolean;
  customName: string | null;
  agentId: string | null;
  categoryId: string | null;
  /** Per-user agent-chat folder holding this channel; null = unfiled. */
  agentFolderId: string | null;
  messageCount: number;
  memberCount: number;
  lastMessageAtSeconds: number;
  createdAtIso: string;
  dmMemberIds: string[];
  currentUserRole: ChannelRole | null;
  isMember: boolean;
  /** custom_name when set, otherwise name. DM display is resolved at render. */
  displayName: string;
  unreadCount: number;
  mentionCount: number;
  hasDraft?: boolean;
}

export interface SerializedMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderType: SenderType;
  content: string;
  rootId: string | null;
  replyToId: string | null;
  replyContext: SerializedReplyContext | null;
  editedAtSeconds: number | null;
  isDeleted: boolean;
  isPinned: boolean;
  metadata: Record<string, string>;
  createdAtSeconds: number;
  createdAtIso: string;
  timeLabel: string;
  replyCount: number;
  reactions: SerializedReaction[];
  senderName: string;
  senderAvatarUrl: string | null;
  /** Populated by a separate BatchListAttachments fetch, not the message proto. */
  attachments: SerializedAttachment[];
}

export interface SerializedMember {
  channelId: string;
  userId: string;
  subjectType: "USER" | "AGENT";
  subjectId: string;
  displayName: string;
  avatarUrl: string | null;
  role: ChannelRole;
  notificationLevel: NotificationLevel;
  isMuted: boolean;
  joinedAtSeconds: number;
}

export interface SerializedThreadInboxItem {
  rootMessageId: string;
  channelId: string;
  channelName: string;
  rootSenderName: string;
  rootPreview: string;
  latestReplyPreview: string | null;
  replyCount: number;
  lastReplyAtSeconds: number;
  activityLabel: string;
  hasUnread: boolean;
}

const CHANNEL_TYPE_MAP: Record<number, ChannelType> = {
  [ProtoChannelType.PUBLIC]: "PUBLIC",
  [ProtoChannelType.PRIVATE]: "PRIVATE",
  [ProtoChannelType.DIRECT]: "DIRECT",
  [ProtoChannelType.GROUP_DM]: "GROUP_DM",
};

const CHANNEL_ROLE_MAP: Record<number, ChannelRole> = {
  [ProtoChannelRole.OWNER]: "OWNER",
  [ProtoChannelRole.ADMIN]: "ADMIN",
  [ProtoChannelRole.MEMBER]: "MEMBER",
};

const SENDER_TYPE_MAP: Record<number, SenderType> = {
  [ProtoSenderType.USER]: "USER",
  [ProtoSenderType.AGENT]: "AGENT",
  [ProtoSenderType.SYSTEM]: "SYSTEM",
  [ProtoSenderType.GUEST]: "GUEST",
};

const NOTIFICATION_LEVEL_MAP: Record<number, NotificationLevel> = {
  [ProtoNotificationLevel.ALL]: "ALL",
  [ProtoNotificationLevel.MENTIONS]: "MENTIONS",
  [ProtoNotificationLevel.NONE]: "NONE",
};

function tsToSeconds(ts: Timestamp | undefined): number {
  if (!ts) return 0;
  return typeof ts.seconds === "bigint" ? Number(ts.seconds) : ts.seconds;
}

export function tsToIso(ts: Timestamp | undefined): string {
  const seconds = tsToSeconds(ts);
  return seconds ? new Date(seconds * 1000).toISOString() : "";
}

/** Discord/Slack-style time label: time of day for today, "Yesterday", else date. */
export function formatMessageTime(seconds: number): string {
  if (!seconds) return "";
  const date = new Date(seconds * 1000);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`;

  const sameYear = date.getFullYear() === now.getFullYear();
  const day = date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${day} ${time}`;
}

export function channelToPlain(proto: ProtoChatChannel): SerializedChannel {
  const customName = proto.customName || null;
  return {
    id: proto.id,
    organizationId: proto.organizationId,
    ownerId: proto.ownerId,
    name: proto.name,
    slug: proto.slug,
    description: proto.description,
    channelType: CHANNEL_TYPE_MAP[proto.channelType] ?? "PUBLIC",
    icon: proto.icon || null,
    isArchived: proto.isArchived,
    isDefault: proto.isDefault,
    isAgentDm: proto.isAgentDm,
    customName,
    agentId: proto.agentId || null,
    categoryId: proto.categoryId || null,
    agentFolderId: proto.agentFolderId || null,
    messageCount: proto.messageCount,
    memberCount: proto.memberCount,
    lastMessageAtSeconds: tsToSeconds(proto.lastMessageAt) || tsToSeconds(proto.lastRootMessageAt),
    createdAtIso: tsToIso(proto.createdAt),
    dmMemberIds: [...proto.dmMemberIds],
    currentUserRole:
      proto.currentUserRole !== undefined
        ? (CHANNEL_ROLE_MAP[proto.currentUserRole] ?? null)
        : null,
    isMember: proto.isMember ?? false,
    displayName: customName || proto.name,
    unreadCount: 0,
    mentionCount: 0,
  };
}

function reactionToPlain(rg: ProtoReactionGroup): SerializedReaction {
  return {
    emoji: rg.emoji,
    count: rg.count,
    userIds: [...rg.userIds],
    currentUserReacted: rg.currentUserReacted,
  };
}

export function messageToPlain(proto: ProtoChatMessage): SerializedMessage {
  const createdAtSeconds = tsToSeconds(proto.createdAt);
  const senderType = SENDER_TYPE_MAP[proto.senderType] ?? "USER";
  return {
    id: proto.id,
    channelId: proto.channelId,
    senderId: proto.senderId,
    senderType,
    content: proto.content,
    rootId: proto.rootId || null,
    replyToId: proto.replyToId || null,
    replyContext: proto.replyContext
      ? {
          id: proto.replyContext.id,
          senderName: proto.replyContext.senderName,
          contentPreview: proto.replyContext.contentPreview,
        }
      : null,
    editedAtSeconds: proto.editedAt ? tsToSeconds(proto.editedAt) : null,
    isDeleted: proto.isDeleted,
    isPinned: proto.isPinned,
    metadata: { ...proto.metadata },
    createdAtSeconds,
    createdAtIso: createdAtSeconds ? new Date(createdAtSeconds * 1000).toISOString() : "",
    timeLabel: formatMessageTime(createdAtSeconds),
    replyCount: proto.thread?.replyCount ?? 0,
    reactions: proto.reactions.map(reactionToPlain),
    // Agent messages carry no senderName; screens resolve the live agent
    // name by senderId and this fallback only covers the pre-load gap.
    senderName: proto.senderName || (senderType === "AGENT" ? "Agent" : "Unknown"),
    senderAvatarUrl: proto.senderAvatarUrl || null,
    attachments: [],
  };
}

export function memberToPlain(proto: ProtoChatChannelMember): SerializedMember {
  const subjectType: "USER" | "AGENT" =
    proto.subject?.type === ProtoSubjectType.AGENT ? "AGENT" : "USER";
  return {
    channelId: proto.channelId,
    userId: proto.userId,
    subjectType,
    subjectId: proto.subject?.id || proto.userId,
    displayName: proto.displayName || "Unknown",
    avatarUrl: proto.avatarUrl || null,
    role: CHANNEL_ROLE_MAP[proto.role] ?? "MEMBER",
    notificationLevel: NOTIFICATION_LEVEL_MAP[proto.notificationLevel] ?? "ALL",
    isMuted: proto.isMuted,
    joinedAtSeconds: tsToSeconds(proto.joinedAt),
  };
}

export interface SerializedCategory {
  id: string;
  name: string;
  position: number;
}

export function categoryToPlain(proto: ProtoChatChannelCategory): SerializedCategory {
  return { id: proto.id, name: proto.name, position: proto.position };
}

/** Per-user grouping for agent chats. Unlike categories these are not org-wide. */
export interface SerializedAgentFolder {
  id: string;
  name: string;
  position: number;
}

export function agentFolderToPlain(proto: ProtoAgentChatFolder): SerializedAgentFolder {
  return { id: proto.id, name: proto.name, position: proto.position };
}

export function threadInboxItemToPlain(proto: ProtoThreadInboxItem): SerializedThreadInboxItem {
  const lastReplyAtSeconds = tsToSeconds(proto.lastReplyAt);
  return {
    rootMessageId: proto.rootMessageId,
    channelId: proto.channelId,
    channelName: proto.channelName,
    rootSenderName: proto.rootMessage?.senderName || "Unknown",
    rootPreview: proto.rootMessage?.content || "",
    latestReplyPreview: proto.latestReply?.content || null,
    replyCount: proto.replyCount,
    lastReplyAtSeconds,
    activityLabel: formatCompactAge(lastReplyAtSeconds),
    hasUnread: proto.hasUnread,
  };
}

export interface SerializedDraft {
  channelId: string;
  rootMessageId: string | null;
  content: string;
  updatedAt: string;
}

/** Cache key for a draft: "channelId" for the channel composer, "channelId:rootId" for a thread. */
export function draftKey(channelId: string, rootMessageId?: string | null): string {
  return rootMessageId ? `${channelId}:${rootMessageId}` : channelId;
}

export function draftToPlain(proto: ProtoChatDraft): SerializedDraft {
  return {
    channelId: proto.channelId,
    rootMessageId: proto.rootMessageId || null,
    content: proto.content,
    updatedAt: tsToIso(proto.updatedAt),
  };
}

export interface SerializedPendingApproval {
  requestId: string;
  agentId: string;
  messageId: string;
  toolName: string;
  argsPreview: string;
  actorUserId: string;
  requestedAtSeconds: number;
  expiresAtSeconds: number | null;
}

export function approvalToPlain(proto: ProtoPendingAgentApproval): SerializedPendingApproval {
  return {
    requestId: proto.requestId,
    agentId: proto.agentId,
    messageId: proto.messageId,
    toolName: proto.toolName,
    argsPreview: proto.argsPreview,
    actorUserId: proto.actorUserId,
    requestedAtSeconds: tsToSeconds(proto.requestedAt),
    expiresAtSeconds: proto.expiresAt ? tsToSeconds(proto.expiresAt) : null,
  };
}

export function channelTypeToProto(type: ChannelType): ProtoChannelType {
  switch (type) {
    case "PRIVATE":
      return ProtoChannelType.PRIVATE;
    case "DIRECT":
      return ProtoChannelType.DIRECT;
    case "GROUP_DM":
      return ProtoChannelType.GROUP_DM;
    default:
      return ProtoChannelType.PUBLIC;
  }
}

export function notificationLevelToProto(level: NotificationLevel): ProtoNotificationLevel {
  switch (level) {
    case "MENTIONS":
      return ProtoNotificationLevel.MENTIONS;
    case "NONE":
      return ProtoNotificationLevel.NONE;
    default:
      return ProtoNotificationLevel.ALL;
  }
}

export interface SerializedChatPolicy {
  minRole: "member" | "admin";
  confirmThreshold: number;
  /** null = unlimited editing; 0 = editing disabled. */
  editWindowMinutes: number | null;
  editHistoryVisibleTo: "admins" | "everyone";
  agentsEnabled: boolean;
}

export function chatPolicyToPlain(proto: {
  broadcastMinRole: ProtoChatBroadcastMinRole;
  broadcastConfirmThreshold: number;
  editWindowMinutes?: number;
  editHistoryVisibleTo: ProtoChatEditHistoryVisibility;
  agentsEnabled: boolean;
}): SerializedChatPolicy {
  return {
    minRole: proto.broadcastMinRole === ProtoChatBroadcastMinRole.ADMIN ? "admin" : "member",
    confirmThreshold: proto.broadcastConfirmThreshold,
    editWindowMinutes: proto.editWindowMinutes ?? null,
    editHistoryVisibleTo:
      proto.editHistoryVisibleTo === ProtoChatEditHistoryVisibility.EVERYONE
        ? "everyone"
        : "admins",
    agentsEnabled: proto.agentsEnabled,
  };
}

/** Whether the org edit-window policy still allows editing this message now. */
export function editWindowAllows(
  message: SerializedMessage,
  policy: SerializedChatPolicy | null | undefined,
): boolean {
  const windowMinutes = policy?.editWindowMinutes;
  if (windowMinutes === 0) return false;
  // Unlimited window, or policy not loaded yet; the server is the boundary.
  if (windowMinutes == null) return true;
  return Date.now() / 1000 - message.createdAtSeconds < windowMinutes * 60;
}

export interface SerializedMessageRevision {
  revisionNo: number;
  content: string;
  editedAtSeconds: number;
}

export function revisionToPlain(proto: {
  revisionNo: number;
  content: string;
  editedAt?: Timestamp;
}): SerializedMessageRevision {
  return {
    revisionNo: proto.revisionNo,
    content: proto.content,
    editedAtSeconds: tsToSeconds(proto.editedAt),
  };
}

/** Resolve the human-facing title for a channel given the viewer + members. */
export function resolveChannelTitle(
  channel: SerializedChannel,
  members: SerializedMember[] | undefined,
  currentUserId: string,
): string {
  if (channel.customName) return channel.customName;
  if (channel.channelType === "DIRECT" || channel.channelType === "GROUP_DM") {
    const others = (members ?? []).filter((m) => m.subjectId !== currentUserId);
    if (others.length > 0) {
      return others.map((m) => m.displayName).join(", ");
    }
  }
  return channel.name;
}
