import { createClient } from '@connectrpc/connect';
import { transport, unaryTransport } from '@/config/api';
import {
  ChatService,
  CreateChannelRequestSchema,
  GetChannelRequestSchema,
  UpdateChannelRequestSchema,
  ArchiveChannelRequestSchema,
  DeleteChannelRequestSchema,
  ListChannelsRequestSchema,
  CreateAgentChatRequestSchema,
  RenameAgentChatRequestSchema,
  ListAgentChatsRequestSchema,
  JoinChannelRequestSchema,
  LeaveChannelRequestSchema,
  AddMembersRequestSchema,
  RemoveMembersRequestSchema,
  GetMembersRequestSchema,
  SendMessageRequestSchema,
  GetMessagesRequestSchema,
  GetMessageRequestSchema,
  UpdateMessageRequestSchema,
  DeleteMessageRequestSchema,
  PinMessageRequestSchema,
  UnpinMessageRequestSchema,
  GetPinnedMessagesRequestSchema,
  GetThreadRequestSchema,
  GetThreadMessagesRequestSchema,
  GetThreadsInboxRequestSchema,
  FollowThreadRequestSchema,
  UnfollowThreadRequestSchema,
  AddReactionRequestSchema,
  RemoveReactionRequestSchema,
  SetTypingRequestSchema,
  MarkChannelReadRequestSchema,
  MarkThreadReadRequestSchema,
  GetUnreadCountsRequestSchema,
  SaveDraftRequestSchema,
  DeleteDraftRequestSchema,
  ListDraftsRequestSchema,
  GetChannelResourcesRequestSchema,
  CreateCategoryRequestSchema,
  UpdateCategoryRequestSchema,
  DeleteCategoryRequestSchema,
  ListCategoriesRequestSchema,
  ReorderCategoriesRequestSchema,
  MoveChannelToCategoryRequestSchema,
  UpdateChannelMemberRequestSchema,
  RespondToAgentConfirmationRequestSchema,
  GetChannelPendingApprovalsRequestSchema,
  GetChannelAgentContextStatsRequestSchema,
  GetChannelAgentContextStatsBatchRequestSchema,
  CompactChannelAgentContextRequestSchema,
  ResetChannelAgentContextRequestSchema,
  StopAgentRunRequestSchema,
} from '@uniffy/proto/chat/v1/chat_pb';
import {
  ChatStreamService,
  StreamUserChatEventsRequestSchema,
} from '@uniffy/proto/chat/v1/chat_stream_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const chatClient = createClient(ChatService, unaryTransport);
const chatStreamClient = createClient(ChatStreamService, transport);

export const chatApi = {
  createChannel: (req: MessageInitShape<typeof CreateChannelRequestSchema>) =>
    chatClient.createChannel(req),
  getChannel: (req: MessageInitShape<typeof GetChannelRequestSchema>) =>
    chatClient.getChannel(req),
  updateChannel: (req: MessageInitShape<typeof UpdateChannelRequestSchema>) =>
    chatClient.updateChannel(req),
  archiveChannel: (req: MessageInitShape<typeof ArchiveChannelRequestSchema>) =>
    chatClient.archiveChannel(req),
  deleteChannel: (req: MessageInitShape<typeof DeleteChannelRequestSchema>) =>
    chatClient.deleteChannel(req),
  listChannels: (req: MessageInitShape<typeof ListChannelsRequestSchema>) =>
    chatClient.listChannels(req),

  createAgentChat: (req: MessageInitShape<typeof CreateAgentChatRequestSchema>) =>
    chatClient.createAgentChat(req),
  renameAgentChat: (req: MessageInitShape<typeof RenameAgentChatRequestSchema>) =>
    chatClient.renameAgentChat(req),
  listAgentChats: (req: MessageInitShape<typeof ListAgentChatsRequestSchema>) =>
    chatClient.listAgentChats(req),

  joinChannel: (req: MessageInitShape<typeof JoinChannelRequestSchema>) =>
    chatClient.joinChannel(req),
  leaveChannel: (req: MessageInitShape<typeof LeaveChannelRequestSchema>) =>
    chatClient.leaveChannel(req),
  addMembers: (req: MessageInitShape<typeof AddMembersRequestSchema>) =>
    chatClient.addMembers(req),
  removeMembers: (req: MessageInitShape<typeof RemoveMembersRequestSchema>) =>
    chatClient.removeMembers(req),
  getMembers: (req: MessageInitShape<typeof GetMembersRequestSchema>) =>
    chatClient.getMembers(req),
  updateChannelMember: (req: MessageInitShape<typeof UpdateChannelMemberRequestSchema>) =>
    chatClient.updateChannelMember(req),

  sendMessage: (req: MessageInitShape<typeof SendMessageRequestSchema>) =>
    chatClient.sendMessage(req),
  getMessages: (req: MessageInitShape<typeof GetMessagesRequestSchema>) =>
    chatClient.getMessages(req),
  getMessage: (req: MessageInitShape<typeof GetMessageRequestSchema>) =>
    chatClient.getMessage(req),
  updateMessage: (req: MessageInitShape<typeof UpdateMessageRequestSchema>) =>
    chatClient.updateMessage(req),
  deleteMessage: (req: MessageInitShape<typeof DeleteMessageRequestSchema>) =>
    chatClient.deleteMessage(req),

  pinMessage: (req: MessageInitShape<typeof PinMessageRequestSchema>) =>
    chatClient.pinMessage(req),
  unpinMessage: (req: MessageInitShape<typeof UnpinMessageRequestSchema>) =>
    chatClient.unpinMessage(req),
  getPinnedMessages: (req: MessageInitShape<typeof GetPinnedMessagesRequestSchema>) =>
    chatClient.getPinnedMessages(req),

  getThread: (req: MessageInitShape<typeof GetThreadRequestSchema>) =>
    chatClient.getThread(req),
  getThreadMessages: (req: MessageInitShape<typeof GetThreadMessagesRequestSchema>) =>
    chatClient.getThreadMessages(req),
  getThreadsInbox: (req: MessageInitShape<typeof GetThreadsInboxRequestSchema>) =>
    chatClient.getThreadsInbox(req),
  followThread: (req: MessageInitShape<typeof FollowThreadRequestSchema>) =>
    chatClient.followThread(req),
  unfollowThread: (req: MessageInitShape<typeof UnfollowThreadRequestSchema>) =>
    chatClient.unfollowThread(req),

  addReaction: (req: MessageInitShape<typeof AddReactionRequestSchema>) =>
    chatClient.addReaction(req),
  removeReaction: (req: MessageInitShape<typeof RemoveReactionRequestSchema>) =>
    chatClient.removeReaction(req),

  setTyping: (req: MessageInitShape<typeof SetTypingRequestSchema>) =>
    chatClient.setTyping(req),
  markChannelRead: (req: MessageInitShape<typeof MarkChannelReadRequestSchema>) =>
    chatClient.markChannelRead(req),
  markThreadRead: (req: MessageInitShape<typeof MarkThreadReadRequestSchema>) =>
    chatClient.markThreadRead(req),
  getUnreadCounts: (req: MessageInitShape<typeof GetUnreadCountsRequestSchema>) =>
    chatClient.getUnreadCounts(req),

  saveDraft: (req: MessageInitShape<typeof SaveDraftRequestSchema>) =>
    chatClient.saveDraft(req),
  deleteDraft: (req: MessageInitShape<typeof DeleteDraftRequestSchema>) =>
    chatClient.deleteDraft(req),
  listDrafts: (req: MessageInitShape<typeof ListDraftsRequestSchema>) =>
    chatClient.listDrafts(req),

  getChannelResources: (req: MessageInitShape<typeof GetChannelResourcesRequestSchema>) =>
    chatClient.getChannelResources(req),

  createCategory: (req: MessageInitShape<typeof CreateCategoryRequestSchema>) =>
    chatClient.createCategory(req),
  updateCategory: (req: MessageInitShape<typeof UpdateCategoryRequestSchema>) =>
    chatClient.updateCategory(req),
  deleteCategory: (req: MessageInitShape<typeof DeleteCategoryRequestSchema>) =>
    chatClient.deleteCategory(req),
  listCategories: (req: MessageInitShape<typeof ListCategoriesRequestSchema>) =>
    chatClient.listCategories(req),
  reorderCategories: (req: MessageInitShape<typeof ReorderCategoriesRequestSchema>) =>
    chatClient.reorderCategories(req),
  moveChannelToCategory: (req: MessageInitShape<typeof MoveChannelToCategoryRequestSchema>) =>
    chatClient.moveChannelToCategory(req),

  respondToAgentConfirmation: (req: MessageInitShape<typeof RespondToAgentConfirmationRequestSchema>) =>
    chatClient.respondToAgentConfirmation(req),
  getChannelPendingApprovals: (req: MessageInitShape<typeof GetChannelPendingApprovalsRequestSchema>) =>
    chatClient.getChannelPendingApprovals(req),

  getChannelAgentContextStats: (req: MessageInitShape<typeof GetChannelAgentContextStatsRequestSchema>) =>
    chatClient.getChannelAgentContextStats(req),
  getChannelAgentContextStatsBatch: (
    req: MessageInitShape<typeof GetChannelAgentContextStatsBatchRequestSchema>,
  ) => chatClient.getChannelAgentContextStatsBatch(req),
  compactChannelAgentContext: (req: MessageInitShape<typeof CompactChannelAgentContextRequestSchema>) =>
    chatClient.compactChannelAgentContext(req),
  resetChannelAgentContext: (req: MessageInitShape<typeof ResetChannelAgentContextRequestSchema>) =>
    chatClient.resetChannelAgentContext(req),
  stopAgentRun: (req: MessageInitShape<typeof StopAgentRunRequestSchema>) =>
    chatClient.stopAgentRun(req),
};

export const chatStreamApi = {
  streamUserChatEvents: (req: MessageInitShape<typeof StreamUserChatEventsRequestSchema>, signal?: AbortSignal) =>
    chatStreamClient.streamUserChatEvents(req, { signal }),
};
