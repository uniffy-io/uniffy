import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  ChatService,
  ListChannelsRequestSchema,
  GetChannelRequestSchema,
  CreateChannelRequestSchema,
  ArchiveChannelRequestSchema,
  DeleteChannelRequestSchema,
  JoinChannelRequestSchema,
  LeaveChannelRequestSchema,
  GetMembersRequestSchema,
  SendMessageRequestSchema,
  GetMessagesRequestSchema,
  UpdateMessageRequestSchema,
  DeleteMessageRequestSchema,
  PinMessageRequestSchema,
  UnpinMessageRequestSchema,
  GetPinnedMessagesRequestSchema,
  GetThreadsInboxRequestSchema,
  AddReactionRequestSchema,
  RemoveReactionRequestSchema,
  SetTypingRequestSchema,
  MarkChannelReadRequestSchema,
  GetUnreadCountsRequestSchema,
  CreateAgentChatRequestSchema,
  ListAgentChatsRequestSchema,
  StopAgentRunRequestSchema,
  ListCategoriesRequestSchema,
  CreateCategoryRequestSchema,
  UpdateCategoryRequestSchema,
  DeleteCategoryRequestSchema,
  MoveChannelToCategoryRequestSchema,
} from "@uniffy/proto/chat/v1/chat_pb";
import { transport } from "@/lib/transport";

const client = createClient(ChatService, transport);

export const chatApi = {
  listChannels: (req: MessageInitShape<typeof ListChannelsRequestSchema>) =>
    client.listChannels(req),
  getChannel: (req: MessageInitShape<typeof GetChannelRequestSchema>) => client.getChannel(req),
  createChannel: (req: MessageInitShape<typeof CreateChannelRequestSchema>) =>
    client.createChannel(req),
  archiveChannel: (req: MessageInitShape<typeof ArchiveChannelRequestSchema>) =>
    client.archiveChannel(req),
  deleteChannel: (req: MessageInitShape<typeof DeleteChannelRequestSchema>) =>
    client.deleteChannel(req),

  joinChannel: (req: MessageInitShape<typeof JoinChannelRequestSchema>) => client.joinChannel(req),
  leaveChannel: (req: MessageInitShape<typeof LeaveChannelRequestSchema>) =>
    client.leaveChannel(req),
  getMembers: (req: MessageInitShape<typeof GetMembersRequestSchema>) => client.getMembers(req),

  sendMessage: (req: MessageInitShape<typeof SendMessageRequestSchema>) => client.sendMessage(req),
  getMessages: (req: MessageInitShape<typeof GetMessagesRequestSchema>) => client.getMessages(req),
  updateMessage: (req: MessageInitShape<typeof UpdateMessageRequestSchema>) =>
    client.updateMessage(req),
  deleteMessage: (req: MessageInitShape<typeof DeleteMessageRequestSchema>) =>
    client.deleteMessage(req),
  pinMessage: (req: MessageInitShape<typeof PinMessageRequestSchema>) => client.pinMessage(req),
  unpinMessage: (req: MessageInitShape<typeof UnpinMessageRequestSchema>) =>
    client.unpinMessage(req),
  getPinnedMessages: (req: MessageInitShape<typeof GetPinnedMessagesRequestSchema>) =>
    client.getPinnedMessages(req),
  getThreadsInbox: (req: MessageInitShape<typeof GetThreadsInboxRequestSchema>) =>
    client.getThreadsInbox(req),

  addReaction: (req: MessageInitShape<typeof AddReactionRequestSchema>) => client.addReaction(req),
  removeReaction: (req: MessageInitShape<typeof RemoveReactionRequestSchema>) =>
    client.removeReaction(req),

  setTyping: (req: MessageInitShape<typeof SetTypingRequestSchema>) => client.setTyping(req),
  markChannelRead: (req: MessageInitShape<typeof MarkChannelReadRequestSchema>) =>
    client.markChannelRead(req),
  getUnreadCounts: (req: MessageInitShape<typeof GetUnreadCountsRequestSchema>) =>
    client.getUnreadCounts(req),

  createAgentChat: (req: MessageInitShape<typeof CreateAgentChatRequestSchema>) =>
    client.createAgentChat(req),
  listAgentChats: (req: MessageInitShape<typeof ListAgentChatsRequestSchema>) =>
    client.listAgentChats(req),
  stopAgentRun: (req: MessageInitShape<typeof StopAgentRunRequestSchema>) =>
    client.stopAgentRun(req),

  listCategories: (req: MessageInitShape<typeof ListCategoriesRequestSchema>) =>
    client.listCategories(req),
  createCategory: (req: MessageInitShape<typeof CreateCategoryRequestSchema>) =>
    client.createCategory(req),
  updateCategory: (req: MessageInitShape<typeof UpdateCategoryRequestSchema>) =>
    client.updateCategory(req),
  deleteCategory: (req: MessageInitShape<typeof DeleteCategoryRequestSchema>) =>
    client.deleteCategory(req),
  moveChannelToCategory: (req: MessageInitShape<typeof MoveChannelToCategoryRequestSchema>) =>
    client.moveChannelToCategory(req),
};
