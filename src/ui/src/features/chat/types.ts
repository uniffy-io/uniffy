export type ChannelType = "PUBLIC" | "PRIVATE" | "DIRECT" | "GROUP_DM";
export type ChannelRole = "OWNER" | "ADMIN" | "MEMBER";
export type SenderType = "USER" | "AGENT" | "SYSTEM" | "GUEST";
export type NotificationLevel = "ALL" | "MENTIONS" | "NONE";
export type MessageDensity = "comfortable" | "compact";

export interface MessageAttachment {
  id: string;
  fileId: string;
  /** File the attachment was copied from; the message text mentions THIS id. */
  sourceFileId?: string;
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
  categoryId: string | null;
  isArchived: boolean;
  isDefault: boolean;
  isDeleted: boolean;
  icon: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  rootMessageCount: number;
  lastMessageAt: string | null;
  lastRootMessageAt: string | null;
  memberCount: number;
  dmMemberIds: string[];
  isAgentDm: boolean;
  customName?: string;
  agentId?: string;
  /** The bound agent was deleted: history reads, the composer is closed. */
  agentIsRetired?: boolean;
  agentFolderId: string | null;
  tagIds: string[];
  /** The viewer's own channel role, carried on the channel payload so role
   *  checks never depend on the members roster having been fetched. */
  currentUserRole?: ChannelRole;
  unreadCount?: number;
  mentionCount?: number;
  /** Server read cursor. The unread divider anchors on the message after this
   *  one; deriving it from unreadCount breaks past the loaded page and the
   *  100 cap. Absent until GetUnreadCounts has answered for this channel. */
  lastReadMessageId?: string;
  /** Newest root message, so a surface that never loaded the channel can still
   *  mark it read. Absent until GetUnreadCounts has answered. */
  latestMessageId?: string;
}

export interface ChatAgentFolder {
  id: string;
  name: string;
  position: number;
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

export interface ForwardedAttachment {
  fileId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface ForwardContext {
  sourceMessageId: string;
  sourceChannelId: string;
  sourceChannelName: string;
  senderId: string;
  senderType: SenderType;
  senderName: string;
  content: string;
  createdAt: string;
  attachments: ForwardedAttachment[];
}

export interface ChatMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderType: SenderType;
  content: string;
  rootId: string | null;
  replyToId: string | null;
  replyContext?: ReplyContext;
  isForwarded: boolean;
  forwardContext?: ForwardContext;
  editedAt: string | null;
  isDeleted: boolean;
  isPinned: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  thread?: {
    replyCount: number;
    lastReplyAt: string;
    participantIds: string[];
    hasUnread: boolean;
  };
  reactions?: ReactionGroupData[];
  senderName?: string;
  senderAvatarUrl?: string;
  attachments?: MessageAttachment[];
}

export interface ChatChannelMember {
  channelId: string;
  userId: string;
  subjectType: "USER" | "AGENT";
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
  contentType: string;
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
