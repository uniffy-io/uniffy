import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { ChatService } from '@uniffy/proto/chat/v1/chat_connect';
import { ChatStreamService } from '@uniffy/proto/chat/v1/chat_stream_connect';
import type { PartialMessage } from '@bufbuild/protobuf';
import type {
  CreateChannelRequest,
  GetChannelRequest,
  UpdateChannelRequest,
  ArchiveChannelRequest,
  DeleteChannelRequest,
  ListChannelsRequest,
  JoinChannelRequest,
  LeaveChannelRequest,
  AddMembersRequest,
  RemoveMembersRequest,
  GetMembersRequest,
  SendMessageRequest,
  GetMessagesRequest,
  GetMessageRequest,
  UpdateMessageRequest,
  DeleteMessageRequest,
  PinMessageRequest,
  UnpinMessageRequest,
  GetPinnedMessagesRequest,
  GetThreadRequest,
  GetThreadMessagesRequest,
  GetThreadsInboxRequest,
  FollowThreadRequest,
  UnfollowThreadRequest,
  AddReactionRequest,
  RemoveReactionRequest,
  SetTypingRequest,
  MarkChannelReadRequest,
  MarkThreadReadRequest,
  GetUnreadCountsRequest,
  GetChannelResourcesRequest,
  CreateCategoryRequest,
  UpdateCategoryRequest,
  DeleteCategoryRequest,
  ListCategoriesRequest,
  ReorderCategoriesRequest,
  MoveChannelToCategoryRequest,
  UpdateChannelMemberRequest,
  RespondToAgentConfirmationRequest,
  GetChannelPendingApprovalsRequest,
  GetChannelAgentContextStatsRequest,
  GetChannelAgentContextStatsBatchRequest,
  CompactChannelAgentContextRequest,
  ResetChannelAgentContextRequest,
} from '@uniffy/proto/chat/v1/chat_pb';
import type {
  StreamUserChatEventsRequest,
} from '@uniffy/proto/chat/v1/chat_stream_pb';

const chatClient = createClient(ChatService, transport);
const chatStreamClient = createClient(ChatStreamService, transport);

export const chatApi = {
  // Channels
  createChannel: (req: PartialMessage<CreateChannelRequest>) =>
    chatClient.createChannel(req),
  getChannel: (req: PartialMessage<GetChannelRequest>) =>
    chatClient.getChannel(req),
  updateChannel: (req: PartialMessage<UpdateChannelRequest>) =>
    chatClient.updateChannel(req),
  archiveChannel: (req: PartialMessage<ArchiveChannelRequest>) =>
    chatClient.archiveChannel(req),
  deleteChannel: (req: PartialMessage<DeleteChannelRequest>) =>
    chatClient.deleteChannel(req),
  listChannels: (req: PartialMessage<ListChannelsRequest>) =>
    chatClient.listChannels(req),

  // Membership
  joinChannel: (req: PartialMessage<JoinChannelRequest>) =>
    chatClient.joinChannel(req),
  leaveChannel: (req: PartialMessage<LeaveChannelRequest>) =>
    chatClient.leaveChannel(req),
  addMembers: (req: PartialMessage<AddMembersRequest>) =>
    chatClient.addMembers(req),
  removeMembers: (req: PartialMessage<RemoveMembersRequest>) =>
    chatClient.removeMembers(req),
  getMembers: (req: PartialMessage<GetMembersRequest>) =>
    chatClient.getMembers(req),
  updateChannelMember: (req: PartialMessage<UpdateChannelMemberRequest>) =>
    chatClient.updateChannelMember(req),

  // Messages
  sendMessage: (req: PartialMessage<SendMessageRequest>) =>
    chatClient.sendMessage(req),
  getMessages: (req: PartialMessage<GetMessagesRequest>) =>
    chatClient.getMessages(req),
  getMessage: (req: PartialMessage<GetMessageRequest>) =>
    chatClient.getMessage(req),
  updateMessage: (req: PartialMessage<UpdateMessageRequest>) =>
    chatClient.updateMessage(req),
  deleteMessage: (req: PartialMessage<DeleteMessageRequest>) =>
    chatClient.deleteMessage(req),

  // Pins
  pinMessage: (req: PartialMessage<PinMessageRequest>) =>
    chatClient.pinMessage(req),
  unpinMessage: (req: PartialMessage<UnpinMessageRequest>) =>
    chatClient.unpinMessage(req),
  getPinnedMessages: (req: PartialMessage<GetPinnedMessagesRequest>) =>
    chatClient.getPinnedMessages(req),

  // Threads
  getThread: (req: PartialMessage<GetThreadRequest>) =>
    chatClient.getThread(req),
  getThreadMessages: (req: PartialMessage<GetThreadMessagesRequest>) =>
    chatClient.getThreadMessages(req),
  getThreadsInbox: (req: PartialMessage<GetThreadsInboxRequest>) =>
    chatClient.getThreadsInbox(req),
  followThread: (req: PartialMessage<FollowThreadRequest>) =>
    chatClient.followThread(req),
  unfollowThread: (req: PartialMessage<UnfollowThreadRequest>) =>
    chatClient.unfollowThread(req),

  // Reactions
  addReaction: (req: PartialMessage<AddReactionRequest>) =>
    chatClient.addReaction(req),
  removeReaction: (req: PartialMessage<RemoveReactionRequest>) =>
    chatClient.removeReaction(req),

  // Typing and read state
  setTyping: (req: PartialMessage<SetTypingRequest>) =>
    chatClient.setTyping(req),
  markChannelRead: (req: PartialMessage<MarkChannelReadRequest>) =>
    chatClient.markChannelRead(req),
  markThreadRead: (req: PartialMessage<MarkThreadReadRequest>) =>
    chatClient.markThreadRead(req),
  getUnreadCounts: (req: PartialMessage<GetUnreadCountsRequest>) =>
    chatClient.getUnreadCounts(req),

  // Resources
  getChannelResources: (req: PartialMessage<GetChannelResourcesRequest>) =>
    chatClient.getChannelResources(req),

  // Categories
  createCategory: (req: PartialMessage<CreateCategoryRequest>) =>
    chatClient.createCategory(req),
  updateCategory: (req: PartialMessage<UpdateCategoryRequest>) =>
    chatClient.updateCategory(req),
  deleteCategory: (req: PartialMessage<DeleteCategoryRequest>) =>
    chatClient.deleteCategory(req),
  listCategories: (req: PartialMessage<ListCategoriesRequest>) =>
    chatClient.listCategories(req),
  reorderCategories: (req: PartialMessage<ReorderCategoriesRequest>) =>
    chatClient.reorderCategories(req),
  moveChannelToCategory: (req: PartialMessage<MoveChannelToCategoryRequest>) =>
    chatClient.moveChannelToCategory(req),

  // Agent confirmations
  respondToAgentConfirmation: (req: PartialMessage<RespondToAgentConfirmationRequest>) =>
    chatClient.respondToAgentConfirmation(req),
  getChannelPendingApprovals: (req: PartialMessage<GetChannelPendingApprovalsRequest>) =>
    chatClient.getChannelPendingApprovals(req),

  // Per-(channel, agent) context management
  getChannelAgentContextStats: (req: PartialMessage<GetChannelAgentContextStatsRequest>) =>
    chatClient.getChannelAgentContextStats(req),
  getChannelAgentContextStatsBatch: (
    req: PartialMessage<GetChannelAgentContextStatsBatchRequest>,
  ) => chatClient.getChannelAgentContextStatsBatch(req),
  compactChannelAgentContext: (req: PartialMessage<CompactChannelAgentContextRequest>) =>
    chatClient.compactChannelAgentContext(req),
  resetChannelAgentContext: (req: PartialMessage<ResetChannelAgentContextRequest>) =>
    chatClient.resetChannelAgentContext(req),
};

export const chatStreamApi = {
  streamUserChatEvents: (req: PartialMessage<StreamUserChatEventsRequest>, signal?: AbortSignal) =>
    chatStreamClient.streamUserChatEvents(req, { signal }),
};
