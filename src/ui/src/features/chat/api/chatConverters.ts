import type { Timestamp } from "@bufbuild/protobuf/wkt";
import {
  ChannelType as ProtoChannelType,
  ChannelRole as ProtoChannelRole,
  SenderType as ProtoSenderType,
  ChatNotificationLevel as ProtoNotificationLevel,
} from "@uniffy/proto/chat/v1/chat_pb";
import { SubjectType as ProtoSubjectType } from "@uniffy/proto/common/v1/common_pb";
import type {
  ChatChannel as ProtoChatChannel,
  ChatMessage as ProtoChatMessage,
  ChatChannelMember as ProtoChatChannelMember,
  ChatChannelCategory as ProtoChatChannelCategory,
  ChatDraft as ProtoChatDraft,
  ThreadInboxItem as ProtoThreadInboxItem,
  ReactionGroup as ProtoReactionGroup,
} from "@uniffy/proto/chat/v1/chat_pb";
import type {
  ChatChannel,
  ChatMessage,
  ChatChannelMember,
  ChatChannelCategory,
  ThreadInboxItem,
  ChannelType,
  ChannelRole,
  SenderType,
  NotificationLevel,
} from "@/features/chat/types";

export function timestampToIso(ts: Timestamp | undefined): string | null {
  if (!ts) return null;
  const ms = (typeof ts.seconds === "bigint" ? Number(ts.seconds) : ts.seconds) * 1000;
  return new Date(ms).toISOString();
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

export function channelToPlain(proto: ProtoChatChannel): ChatChannel {
  return {
    id: proto.id,
    organizationId: proto.organizationId,
    ownerId: proto.ownerId,
    name: proto.name,
    slug: proto.slug,
    description: proto.description,
    channelType: CHANNEL_TYPE_MAP[proto.channelType] ?? "PUBLIC",
    categoryId: proto.categoryId ?? null,
    isArchived: proto.isArchived,
    isDefault: proto.isDefault,
    isDeleted: false,
    icon: proto.icon || null,
    createdAt: timestampToIso(proto.createdAt) ?? new Date().toISOString(),
    updatedAt: timestampToIso(proto.updatedAt) ?? new Date().toISOString(),
    messageCount: proto.messageCount,
    rootMessageCount: proto.rootMessageCount,
    lastMessageAt: timestampToIso(proto.lastMessageAt),
    lastRootMessageAt: timestampToIso(proto.lastRootMessageAt),
    memberCount: proto.memberCount,
    dmMemberIds: Array.from(proto.dmMemberIds),
    isAgentDm: proto.isAgentDm,
    customName: proto.customName ?? undefined,
    agentId: proto.agentId ?? undefined,
    agentIsRetired: proto.agentIsRetired,
    agentFolderId: proto.agentFolderId ?? null,
    tagIds: proto.tags.map((t) => t.id),
    currentUserRole:
      proto.currentUserRole !== undefined ? CHANNEL_ROLE_MAP[proto.currentUserRole] : undefined,
  };
}

export function reactionGroupToPlain(rg: ProtoReactionGroup) {
  return {
    emoji: rg.emoji,
    count: rg.count,
    userIds: [...rg.userIds],
    currentUserReacted: rg.currentUserReacted,
  };
}

export function messageToPlain(proto: ProtoChatMessage): ChatMessage {
  return {
    id: proto.id,
    channelId: proto.channelId,
    senderId: proto.senderId,
    senderType: SENDER_TYPE_MAP[proto.senderType] ?? "USER",
    content: proto.content,
    rootId: proto.rootId ?? null,
    replyToId: proto.replyToId ?? null,
    replyContext: proto.replyContext
      ? {
          id: proto.replyContext.id,
          senderName: proto.replyContext.senderName,
          contentPreview: proto.replyContext.contentPreview,
        }
      : undefined,
    editedAt: timestampToIso(proto.editedAt),
    isDeleted: proto.isDeleted,
    isPinned: proto.isPinned,
    metadata: { ...proto.metadata },
    createdAt: timestampToIso(proto.createdAt) ?? new Date().toISOString(),
    updatedAt:
      timestampToIso(proto.editedAt) ?? timestampToIso(proto.createdAt) ?? new Date().toISOString(),
    thread: proto.thread
      ? {
          replyCount: proto.thread.replyCount,
          lastReplyAt: timestampToIso(proto.thread.lastReplyAt) ?? new Date().toISOString(),
          participantIds: [...proto.thread.participantIds],
          hasUnread: proto.thread.hasUnread,
        }
      : undefined,
    reactions: proto.reactions.map(reactionGroupToPlain),
    senderName: proto.senderName || undefined,
    senderAvatarUrl: proto.senderAvatarUrl || undefined,
    feedbackRating: proto.feedbackRating || undefined,
  };
}

export function memberToPlain(proto: ProtoChatChannelMember): ChatChannelMember {
  const subjectType: "USER" | "AGENT" =
    proto.subject?.type === ProtoSubjectType.AGENT ? "AGENT" : "USER";
  const subjectId = proto.subject?.id || proto.userId;
  return {
    channelId: proto.channelId,
    userId: proto.userId,
    subjectType,
    subjectId,
    displayName: proto.displayName || undefined,
    avatarUrl: proto.avatarUrl || undefined,
    role: CHANNEL_ROLE_MAP[proto.role] ?? "MEMBER",
    notificationLevel: NOTIFICATION_LEVEL_MAP[proto.notificationLevel] ?? "ALL",
    isMuted: proto.isMuted,
    mutedUntil: timestampToIso(proto.mutedUntil),
    followAllThreads: proto.followAllThreads,
    joinedAt: timestampToIso(proto.joinedAt) ?? new Date().toISOString(),
  };
}

export function categoryToPlain(proto: ProtoChatChannelCategory): ChatChannelCategory {
  return {
    id: proto.id,
    organizationId: proto.organizationId,
    name: proto.name,
    position: proto.position,
    createdBy: "",
    createdAt: timestampToIso(proto.createdAt) ?? new Date().toISOString(),
    updatedAt: timestampToIso(proto.updatedAt) ?? new Date().toISOString(),
  };
}

export interface PlainDraft {
  channelId: string;
  rootMessageId: string | null;
  content: string;
  updatedAt: string;
}

export function draftToPlain(proto: ProtoChatDraft): PlainDraft {
  return {
    channelId: proto.channelId,
    rootMessageId: proto.rootMessageId ?? null,
    content: proto.content,
    updatedAt: timestampToIso(proto.updatedAt) ?? new Date().toISOString(),
  };
}

export function threadInboxItemToPlain(proto: ProtoThreadInboxItem): ThreadInboxItem {
  return {
    rootMessageId: proto.rootMessageId,
    channelId: proto.channelId,
    channelName: proto.channelName,
    rootMessageContent: proto.rootMessage?.content ?? "",
    rootMessageSenderId: proto.rootMessage?.senderId ?? "",
    rootMessageSenderName: proto.rootMessage?.senderName ?? undefined,
    replyCount: proto.replyCount,
    lastReplyAt: timestampToIso(proto.lastReplyAt) ?? new Date().toISOString(),
    participantIds: [...proto.participantIds],
    hasUnread: proto.hasUnread,
  };
}
