// Chat domain types - mirrors proto definitions for mock/UI usage

export type ChannelType = 'PUBLIC' | 'PRIVATE' | 'DIRECT' | 'GROUP_DM';
export type ChannelRole = 'OWNER' | 'ADMIN' | 'MEMBER';
export type SenderType = 'USER' | 'AGENT' | 'SYSTEM' | 'GUEST';
export type NotificationLevel = 'ALL' | 'MENTIONS' | 'NONE';
export type MessageDensity = 'comfortable' | 'compact';

export interface MessageAttachment {
  id: string;
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ChatChannelCategory {
  id: string;
  organizationId: string;
  name: string;
  position: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatChannel {
  id: string;
  organizationId: string;
  ownerId: string;
  name: string;
  slug: string;
  description: string;
  channelType: ChannelType;
  categoryId: string | null; // FK to ChatChannelCategory, null = uncategorized
  isEncrypted: boolean;
  isArchived: boolean;
  isDefault: boolean;
  isDeleted: boolean;
  icon: string | null;
  createdAt: string;
  updatedAt: string;
  // Stats (from ChatChannelStats)
  messageCount: number;
  rootMessageCount: number;
  lastMessageAt: string | null;
  lastRootMessageAt: string | null;
  memberCount: number;
  // DM participant user IDs (populated for DIRECT and GROUP_DM)
  dmMemberIds: string[];
  // Unread tracking (populated from GetUnreadCounts)
  unreadCount?: number;
  mentionCount?: number;
}

export interface ReactionGroupData {
  emoji: string;
  count: number;
  userIds: string[];
  currentUserReacted: boolean;
}

export interface ReplyContext {
  id: string;
  senderName: string;
  contentPreview: string;
}

export interface ChatMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderType: SenderType;
  content: string; // markdown with [[[label|urn]]] mentions
  rootId: string | null; // null = root message, set = thread reply
  replyToId: string | null; // inline quote reply reference
  replyContext?: ReplyContext; // snapshot of the quoted message
  editedAt: string | null;
  isDeleted: boolean;
  isPinned: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  // Denormalized thread info (only on root messages that have replies)
  thread?: {
    replyCount: number;
    lastReplyAt: string;
    participantIds: string[];
    hasUnread: boolean;
  };
  // Reaction groups from API
  reactions?: ReactionGroupData[];
  // Denormalized sender info
  senderName?: string;
  senderAvatarUrl?: string;
  // File attachments linked to this message
  attachments?: MessageAttachment[];
}

export interface ChatChannelMember {
  channelId: string;
  userId: string;
  subjectType: 'USER' | 'AGENT';
  subjectId: string;
  displayName?: string;
  avatarUrl?: string;
  role: ChannelRole;
  notificationLevel: NotificationLevel;
  isMuted: boolean;
  mutedUntil: string | null;
  followAllThreads: boolean;
  joinedAt: string;
}

export interface ChannelPreferences {
  isMuted: boolean;
  notificationLevel: NotificationLevel;
  mutedUntil: string | null;
}

export interface ChatReaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
  createdAt: string;
}

export interface ChatReadCursor {
  channelId: string;
  userId: string;
  lastReadMessageId: string;
  lastReadAt: string;
}

export interface ChatThreadFollow {
  rootMessageId: string;
  userId: string;
  createdAt: string;
}

export interface ChatResource {
  id: string;
  channelId: string;
  urn: string;
  contentType: string; // NOTE, FILE, TASK, CALENDAR_EVENT, PROJECT
  firstMentionedAt: string;
  lastMentionedAt: string;
  mentionCount: number;
  firstMentionedBy: string;
  title?: string;
}

export interface ThreadInboxItem {
  rootMessageId: string;
  channelId: string;
  channelName: string;
  rootMessageContent: string;
  rootMessageSenderId: string;
  rootMessageSenderName?: string;
  replyCount: number;
  lastReplyAt: string;
  participantIds: string[];
  hasUnread: boolean;
}

export interface TypingUser {
  userId: string;
  displayName: string;
  startedAt: number;
}
