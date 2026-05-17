import { createAsyncThunk } from '@reduxjs/toolkit';
import type { Dispatch, UnknownAction } from '@reduxjs/toolkit';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import { chatApi } from '@/features/chat/api/chatApi';
import { attachmentsApi } from '@/features/attachments';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';
import type { ChatChannel as ProtoChatChannel } from '@uniffy/proto/chat/v1/chat_pb';
import {
  channelToPlain,
  messageToPlain,
  memberToPlain,
  categoryToPlain,
  threadInboxItemToPlain,
} from '@/features/chat/api/chatConverters';
import { bulkUpsertTags, tagToPlain } from '@/features/tags';
import {
  setChannels,
  addChannel,
  removeChannel,
  updateChannel,
  setChannelMembers,
  setChannelPreferences,
  updateChannelPreference,
  setCategories,
  setLoading,
  updateUnreadCounts,
  setActiveChannel,
} from '@/features/chat/store/chatChannelsSlice';
import {
  setMessages,
  prependMessages,
  appendMessage,
  updateMessage,
  deleteMessage,
  setHasMore,
  setUnreadSeparator,
  setChannelLoading,
  addReactionToMessage,
  removeReactionFromMessage,
} from '@/features/chat/store/chatMessagesSlice';
import {
  setThreadMessages,
  setThreadsInbox,
  followThread as followThreadAction,
  unfollowThread as unfollowThreadAction,
  setLoadingThread,
  addReactionToThreadMessage,
  removeReactionFromThreadMessage,
} from '@/features/chat/store/chatThreadsSlice';
import { fetchAgents } from '@/features/agents/store/agentsThunks';
import { markNotificationsReadBySource } from '@/features/notifications/store/notificationsSlice';
import type { RootState } from '@/app/store';
import type { ChatMessage, ChatChannel, ChatChannelMember } from '@/features/chat/types';
import { ChannelType as ProtoChannelType, ChatNotificationLevel, AgentConfirmationDecision } from '@uniffy/proto/chat/v1/chat_pb';
import { SubjectType } from '@uniffy/proto/common/v1/common_pb';

const getOrganizationId = (state: RootState): string => {
  const orgId = state.auth.currentOrganizationId;
  if (!orgId) {
    throw new Error('No organization selected');
  }
  return orgId;
};

const hydrateChannelTags = (
  dispatch: Dispatch<UnknownAction>,
  channels: ProtoChatChannel[],
): void => {
  const tags = channels.flatMap((c) => c.tags.map(tagToPlain));
  if (tags.length) {
    dispatch(bulkUpsertTags(tags));
  }
};

export const fetchChannels = createAsyncThunk<
  void,
  void,
  { state: RootState; rejectValue: string }
>('chat/fetchChannels', async (_, { getState, dispatch, rejectWithValue }) => {
  try {
    dispatch(setLoading(true));
    const organizationId = getOrganizationId(getState());
    const collected: ChatChannel[] = [];
    let cursor: string | undefined;
    do {
      const response = await chatApi.listChannels({ organizationId, cursor });
      hydrateChannelTags(dispatch, response.channels);
      collected.push(...response.channels.map(channelToPlain));
      cursor = response.nextCursor || undefined;
    } while (cursor);
    dispatch(setChannels(collected));
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch channels');
  } finally {
    dispatch(setLoading(false));
  }
});

export const fetchPublicChannels = createAsyncThunk<
  ChatChannel[],
  void,
  { state: RootState; rejectValue: string }
>('chat/fetchPublicChannels', async (_, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const collected: ChatChannel[] = [];
    let cursor: string | undefined;
    do {
      const response = await chatApi.listChannels({
        organizationId,
        browsePublic: true,
        cursor,
      });
      hydrateChannelTags(dispatch, response.channels);
      collected.push(...response.channels.map(channelToPlain));
      cursor = response.nextCursor || undefined;
    } while (cursor);
    return collected;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch public channels');
  }
});

export const createChannel = createAsyncThunk<
  ChatChannel,
  {
    name: string;
    channelType: ProtoChannelType;
    description?: string;
    icon?: string;
    categoryId?: string;
    memberIds?: string[];
    subjects?: { type: 'USER' | 'AGENT'; id: string }[];
    tagIds?: string[];
  },
  { state: RootState; rejectValue: string }
>('chat/createChannel', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.createChannel({
      organizationId,
      name: params.name,
      channelType: params.channelType,
      description: params.description,
      icon: params.icon,
      categoryId: params.categoryId,
      memberIds: params.memberIds ?? [],
      members: (params.subjects ?? []).map((s) => ({
        type: s.type === 'AGENT' ? SubjectType.AGENT : SubjectType.USER,
        id: s.id,
      })),
      tagIds: params.tagIds ?? [],
    });
    if (!response.channel) {
      return rejectWithValue('Failed to create channel');
    }
    hydrateChannelTags(dispatch, [response.channel]);
    const plain = channelToPlain(response.channel);
    dispatch(addChannel(plain));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to create channel');
  }
});

export const createAgentChat = createAsyncThunk<
  ChatChannel,
  { agentId: string; customName?: string },
  { state: RootState; rejectValue: string }
>('chat/createAgentChat', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.createAgentChat({
      organizationId,
      agentId: params.agentId,
      customName: params.customName,
    });
    if (!response.channel) {
      return rejectWithValue('Failed to create agent chat');
    }
    hydrateChannelTags(dispatch, [response.channel]);
    const plain = channelToPlain(response.channel);
    dispatch(addChannel(plain));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to create agent chat');
  }
});

export const renameAgentChat = createAsyncThunk<
  ChatChannel,
  { channelId: string; customName: string | null },
  { state: RootState; rejectValue: string }
>('chat/renameAgentChat', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.renameAgentChat({
      organizationId,
      channelId: params.channelId,
      // Empty string clears the override on the server.
      customName: params.customName ?? '',
    });
    if (!response.channel) {
      return rejectWithValue('Failed to rename agent chat');
    }
    hydrateChannelTags(dispatch, [response.channel]);
    const plain = channelToPlain(response.channel);
    dispatch(updateChannel(plain));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to rename agent chat');
  }
});

export const joinChannel = createAsyncThunk<
  ChatChannel,
  string,
  { state: RootState; rejectValue: string }
>('chat/joinChannel', async (channelId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.joinChannel({ organizationId, channelId });
    if (!response.channel) {
      return rejectWithValue('Failed to join channel');
    }
    hydrateChannelTags(dispatch, [response.channel]);
    const plain = channelToPlain(response.channel);
    // Add to channel list (user wasn't a member before)
    const existing = getState().chatChannels.channels.find(c => c.id === channelId);
    if (existing) {
      dispatch(updateChannel(plain));
    } else {
      dispatch(addChannel(plain));
    }
    // Set active and fetch messages for the newly joined channel
    dispatch(setActiveChannel(channelId));
    dispatch(fetchMessages({ channelId }));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to join channel');
  }
});

export const leaveChannel = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string }
>('chat/leaveChannel', async (channelId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.leaveChannel({ organizationId, channelId });
    dispatch(removeChannel(channelId));
    return channelId;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to leave channel');
  }
});

export const archiveChannel = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string }
>('chat/archiveChannel', async (channelId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.archiveChannel({ organizationId, channelId });
    dispatch(removeChannel(channelId));
    return channelId;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to archive channel');
  }
});

export const deleteChannel = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string }
>('chat/deleteChannel', async (channelId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.deleteChannel({ organizationId, channelId });
    dispatch(removeChannel(channelId));
    return channelId;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to delete channel');
  }
});

export const fetchMessages = createAsyncThunk<
  { messages: ChatMessage[]; hasMore: boolean },
  { channelId: string; beforeId?: string; aroundId?: string; limit?: number },
  { state: RootState; rejectValue: string }
>('chat/fetchMessages', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    dispatch(setChannelLoading({ channelId: params.channelId, isLoading: true }));
    const response = await chatApi.getMessages({
      organizationId,
      channelId: params.channelId,
      beforeId: params.beforeId,
      aroundId: params.aroundId,
      limit: params.limit ?? 50,
      rootOnly: true,
    });
    const messages = response.messages.map(messageToPlain);

    // Single batched RPC instead of N parallel ListAttachments calls
    // (a 50-message channel used to fan out 50 round-trips on open).
    if (messages.length > 0) {
      try {
        const batch = await attachmentsApi.batchListAttachments({
          organizationId,
          contentType: ContentType.CHAT_MESSAGE,
          contentIds: messages.map((m) => m.id),
        });
        const byId = new Map<string, typeof messages[number]['attachments']>();
        for (const group of batch.groups) {
          byId.set(
            group.contentId,
            group.attachments.map((a) => ({
              id: a.id,
              fileId: a.fileId,
              filename: a.filename,
              mimeType: a.mimeType,
              sizeBytes: Number(a.sizeBytes),
            })),
          );
        }
        for (let i = 0; i < messages.length; i++) {
          const attachments = byId.get(messages[i].id);
          if (attachments && attachments.length > 0) {
            messages[i] = { ...messages[i], attachments };
          }
        }
      } catch {
        // Non-fatal: messages render without their attachment metadata.
      }
    }

    if (params.beforeId) {
      dispatch(prependMessages({ channelId: params.channelId, messages }));
    } else {
      // Compute unread separator position before marking as read
      const state = getState();
      const channel = state.chatChannels.channels.find(
        (c) => c.id === params.channelId
      );
      const unreadCount = channel?.unreadCount ?? 0;
      if (unreadCount > 0 && messages.length > 0) {
        const separatorIndex = messages.length - unreadCount;
        if (separatorIndex >= 0 && separatorIndex < messages.length) {
          dispatch(setUnreadSeparator({
            channelId: params.channelId,
            messageId: messages[separatorIndex].id,
          }));
        }
      }

      dispatch(setMessages({ channelId: params.channelId, messages }));

      // Re-hydrate any live agent approval cards that survived process
      // restart in Valkey but got dropped from Redux by the reload. Fire
      // and forget — a failure here should never block the channel open.
      dispatch(fetchChannelPendingApprovals({ channelId: params.channelId }));

      // Mark channel as read when opening it (not when paginating)
      const lastMessage = messages[messages.length - 1];
      if (lastMessage) {
        dispatch(markChannelRead({
          channelId: params.channelId,
          lastReadMessageId: lastMessage.id,
        }));
        dispatch(updateUnreadCounts([{
          channelId: params.channelId,
          unreadCount: 0,
          mentionCount: 0,
        }]));
      }
    }
    dispatch(setHasMore({ channelId: params.channelId, hasMore: response.hasMore }));
    return { messages, hasMore: response.hasMore };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch messages');
  } finally {
    dispatch(setChannelLoading({ channelId: params.channelId, isLoading: false }));
  }
});

export const sendMessage = createAsyncThunk<
  ChatMessage,
  { channelId: string; content: string; rootId?: string; replyToId?: string },
  { state: RootState; rejectValue: string }
>('chat/sendMessage', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.sendMessage({
      organizationId,
      channelId: params.channelId,
      content: params.content,
      rootId: params.rootId,
      replyToId: params.replyToId,
    });
    if (!response.message) {
      return rejectWithValue('Failed to send message');
    }
    const plain = messageToPlain(response.message);
    // Append to channel messages (streaming will also deliver it, but this ensures immediate display)
    if (!params.rootId) {
      dispatch(appendMessage({ channelId: params.channelId, message: plain }));
    }
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to send message');
  }
});

export const editMessage = createAsyncThunk<
  ChatMessage,
  { channelId: string; messageId: string; content: string },
  { state: RootState; rejectValue: string }
>('chat/editMessage', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.updateMessage({
      organizationId,
      channelId: params.channelId,
      messageId: params.messageId,
      content: params.content,
    });
    if (!response.message) {
      return rejectWithValue('Failed to edit message');
    }
    const plain = messageToPlain(response.message);
    dispatch(updateMessage({ channelId: params.channelId, message: plain }));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to edit message');
  }
});

export const removeMessage = createAsyncThunk<
  void,
  { channelId: string; messageId: string },
  { state: RootState; rejectValue: string }
>('chat/removeMessage', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.deleteMessage({
      organizationId,
      channelId: params.channelId,
      messageId: params.messageId,
    });
    dispatch(deleteMessage({ channelId: params.channelId, messageId: params.messageId }));
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to delete message');
  }
});

export const pinMessage = createAsyncThunk<
  ChatMessage,
  { channelId: string; messageId: string },
  { state: RootState; rejectValue: string }
>('chat/pinMessage', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.pinMessage({
      organizationId,
      channelId: params.channelId,
      messageId: params.messageId,
    });
    if (!response.message) {
      return rejectWithValue('Failed to pin message');
    }
    const plain = messageToPlain(response.message);
    dispatch(updateMessage({ channelId: params.channelId, message: plain }));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to pin message');
  }
});

export const unpinMessage = createAsyncThunk<
  ChatMessage,
  { channelId: string; messageId: string },
  { state: RootState; rejectValue: string }
>('chat/unpinMessage', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.unpinMessage({
      organizationId,
      channelId: params.channelId,
      messageId: params.messageId,
    });
    if (!response.message) {
      return rejectWithValue('Failed to unpin message');
    }
    const plain = messageToPlain(response.message);
    dispatch(updateMessage({ channelId: params.channelId, message: plain }));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to unpin message');
  }
});

export const fetchPinnedMessages = createAsyncThunk<
  ChatMessage[],
  string,
  { state: RootState; rejectValue: string }
>('chat/fetchPinnedMessages', async (channelId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.getPinnedMessages({ organizationId, channelId });
    return response.messages.map(messageToPlain);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch pinned messages');
  }
});

export const addReaction = createAsyncThunk<
  void,
  { channelId: string; messageId: string; emoji: string },
  { state: RootState; rejectValue: string }
>('chat/addReaction', async (params, { getState, dispatch, rejectWithValue }) => {
  const state = getState();
  const organizationId = getOrganizationId(state);
  const currentUserId = state.auth.user?.id ?? '';

  try {
    // Optimistic update - channel messages
    dispatch(addReactionToMessage({
      channelId: params.channelId,
      messageId: params.messageId,
      emoji: params.emoji,
      userId: currentUserId,
      currentUserId,
    }));

    // Optimistic update - thread messages
    dispatch(addReactionToThreadMessage({
      messageId: params.messageId,
      emoji: params.emoji,
      userId: currentUserId,
      currentUserId,
    }));

    await chatApi.addReaction({
      organizationId,
      channelId: params.channelId,
      messageId: params.messageId,
      emoji: params.emoji,
    });
  } catch (error) {
    // Rollback optimistic updates
    dispatch(removeReactionFromMessage({
      channelId: params.channelId,
      messageId: params.messageId,
      emoji: params.emoji,
      userId: currentUserId,
      currentUserId,
    }));
    dispatch(removeReactionFromThreadMessage({
      messageId: params.messageId,
      emoji: params.emoji,
      userId: currentUserId,
      currentUserId,
    }));
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to add reaction');
  }
});

export const removeReaction = createAsyncThunk<
  void,
  { channelId: string; messageId: string; emoji: string },
  { state: RootState; rejectValue: string }
>('chat/removeReaction', async (params, { getState, dispatch, rejectWithValue }) => {
  const state = getState();
  const organizationId = getOrganizationId(state);
  const currentUserId = state.auth.user?.id ?? '';

  try {
    // Optimistic update - channel messages
    dispatch(removeReactionFromMessage({
      channelId: params.channelId,
      messageId: params.messageId,
      emoji: params.emoji,
      userId: currentUserId,
      currentUserId,
    }));

    // Optimistic update - thread messages
    dispatch(removeReactionFromThreadMessage({
      messageId: params.messageId,
      emoji: params.emoji,
      userId: currentUserId,
      currentUserId,
    }));

    await chatApi.removeReaction({
      organizationId,
      channelId: params.channelId,
      messageId: params.messageId,
      emoji: params.emoji,
    });
  } catch (error) {
    // Rollback optimistic updates
    dispatch(addReactionToMessage({
      channelId: params.channelId,
      messageId: params.messageId,
      emoji: params.emoji,
      userId: currentUserId,
      currentUserId,
    }));
    dispatch(addReactionToThreadMessage({
      messageId: params.messageId,
      emoji: params.emoji,
      userId: currentUserId,
      currentUserId,
    }));
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to remove reaction');
  }
});

export const fetchThread = createAsyncThunk<
  { rootMessage: ChatMessage; replyCount: number; isFollowing: boolean },
  { channelId: string; rootMessageId: string },
  { state: RootState; rejectValue: string }
>('chat/fetchThread', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    dispatch(setLoadingThread(true));
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.getThread({
      organizationId,
      channelId: params.channelId,
      rootMessageId: params.rootMessageId,
    });
    if (!response.rootMessage) {
      return rejectWithValue('Thread not found');
    }
    const rootMessage = messageToPlain(response.rootMessage);
    return { rootMessage, replyCount: response.replyCount, isFollowing: response.isFollowing };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch thread');
  } finally {
    dispatch(setLoadingThread(false));
  }
});

export const fetchThreadMessages = createAsyncThunk<
  ChatMessage[],
  { channelId: string; rootMessageId: string; beforeId?: string; limit?: number },
  { state: RootState; rejectValue: string }
>('chat/fetchThreadMessages', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.getThreadMessages({
      organizationId,
      channelId: params.channelId,
      rootMessageId: params.rootMessageId,
      beforeId: params.beforeId,
      limit: params.limit ?? 50,
    });
    const messages = response.messages.map(messageToPlain);
    dispatch(setThreadMessages({ rootMessageId: params.rootMessageId, messages }));
    return messages;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch thread messages');
  }
});

/**
 * Resolve the thread root for a given message. Handles three cases:
 * - Message is already loaded in the channel as a reply → returns its rootId.
 * - Message is a thread root with replies → returns its own id.
 * - Message is not loaded → fetches from server to determine rootId.
 * Also ensures the root message is in the channel messages store so ThreadPanel can render it.
 */
export const resolveThreadForMessage = createAsyncThunk<
  { rootMessageId: string; targetMessageId: string } | null,
  { channelId: string; messageId: string },
  { state: RootState; rejectValue: string }
>('chat/resolveThreadForMessage', async (params, { getState, dispatch }) => {
  const state = getState();
  const organizationId = getOrganizationId(state);
  const existing = state.chatMessages.byId[params.messageId];

  let rootId: string | null = null;
  if (existing && state.chatMessages.idSetByChannel[params.channelId]?.[params.messageId]) {
    if (existing.rootId) {
      rootId = existing.rootId;
    } else if (existing.thread && existing.thread.replyCount > 0) {
      rootId = existing.id;
    }
  } else {
    try {
      const resp = await chatApi.getMessage({
        organizationId,
        channelId: params.channelId,
        messageId: params.messageId,
      });
      if (!resp.message) return null;
      const plain = messageToPlain(resp.message);
      rootId = plain.rootId ?? (plain.thread && plain.thread.replyCount > 0 ? plain.id : null);
    } catch {
      return null;
    }
  }

  if (!rootId) return null;

  const rootInChannel = state.chatMessages.idSetByChannel[params.channelId]?.[rootId] === true;
  if (!rootInChannel) {
    try {
      const resp = await chatApi.getMessage({
        organizationId,
        channelId: params.channelId,
        messageId: rootId,
      });
      if (resp.message) {
        dispatch(appendMessage({ channelId: params.channelId, message: messageToPlain(resp.message) }));
      }
    } catch {
      return null;
    }
  }

  return { rootMessageId: rootId, targetMessageId: params.messageId };
});

export const fetchThreadsInbox = createAsyncThunk<
  void,
  { unreadOnly?: boolean } | void,
  { state: RootState; rejectValue: string }
>('chat/fetchThreadsInbox', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.getThreadsInbox({
      organizationId,
      unreadOnly: params?.unreadOnly ?? false,
      limit: 50,
    });
    dispatch(setThreadsInbox(response.threads.map(threadInboxItemToPlain)));
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch threads inbox');
  }
});

export const followThreadThunk = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string }
>('chat/followThread', async (rootMessageId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.followThread({ organizationId, rootMessageId });
    dispatch(followThreadAction(rootMessageId));
    return rootMessageId;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to follow thread');
  }
});

export const unfollowThreadThunk = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string }
>('chat/unfollowThread', async (rootMessageId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.unfollowThread({ organizationId, rootMessageId });
    dispatch(unfollowThreadAction(rootMessageId));
    return rootMessageId;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to unfollow thread');
  }
});

export const markChannelRead = createAsyncThunk<
  void,
  { channelId: string; lastReadMessageId: string },
  { state: RootState; rejectValue: string }
>('chat/markChannelRead', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.markChannelRead({
      organizationId,
      channelId: params.channelId,
      lastReadMessageId: params.lastReadMessageId,
    });
    // Backend cascades chat-sourced notifications to read in the same
    // request. Mirror that locally so the bell panel updates without
    // waiting for a refetch or stream tick.
    dispatch(
      markNotificationsReadBySource(
        `urn:uniffy:content:CHAT:${params.channelId}`,
      ),
    );
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to mark channel read');
  }
});

export const markThreadRead = createAsyncThunk<
  void,
  string,
  { state: RootState; rejectValue: string }
>('chat/markThreadRead', async (rootMessageId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.markThreadRead({
      organizationId,
      rootMessageId,
    });
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to mark thread read');
  }
});

export const fetchUnreadCounts = createAsyncThunk<
  void,
  void,
  { state: RootState; rejectValue: string }
>('chat/fetchUnreadCounts', async (_, { getState, dispatch, rejectWithValue }) => {
  try {
    const nlMap: Record<number, 'ALL' | 'MENTIONS' | 'NONE'> = {
      [ChatNotificationLevel.ALL]: 'ALL',
      [ChatNotificationLevel.MENTIONS]: 'MENTIONS',
      [ChatNotificationLevel.NONE]: 'NONE',
    };

    const organizationId = getOrganizationId(getState());
    const response = await chatApi.getUnreadCounts({ organizationId });
    dispatch(updateUnreadCounts(
      response.channels.map((c) => ({
        channelId: c.channelId,
        unreadCount: c.unreadCount,
        mentionCount: c.mentionCount,
      })),
    ));

    const prefs: Record<string, { isMuted: boolean; notificationLevel: 'ALL' | 'MENTIONS' | 'NONE'; mutedUntil: string | null }> = {};
    for (const c of response.channels) {
      prefs[c.channelId] = {
        isMuted: c.isMuted,
        notificationLevel: nlMap[c.notificationLevel] ?? 'ALL',
        mutedUntil: c.mutedUntil ? new Date(Number(c.mutedUntil.seconds) * 1000).toISOString() : null,
      };
    }
    dispatch(setChannelPreferences(prefs));
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch unread counts');
  }
});

export const sendTyping = createAsyncThunk<
  void,
  string,
  { state: RootState; rejectValue: string }
>('chat/sendTyping', async (channelId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.setTyping({ organizationId, channelId });
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to send typing');
  }
});

export const fetchCategories = createAsyncThunk<
  void,
  void,
  { state: RootState; rejectValue: string }
>('chat/fetchCategories', async (_, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.listCategories({ organizationId });
    dispatch(setCategories(response.categories.map(categoryToPlain)));
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch categories');
  }
});

export const reorderCategoriesThunk = createAsyncThunk<
  void,
  string[],
  { state: RootState; rejectValue: string }
>('chat/reorderCategories', async (categoryIds, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.reorderCategories({ organizationId, categoryIds });
    // Refresh to get updated positions
    dispatch(fetchCategories());
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to reorder categories');
  }
});

export const createCategoryThunk = createAsyncThunk<
  void,
  string,
  { state: RootState; rejectValue: string }
>('chat/createCategory', async (name, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.createCategory({ organizationId, name });
    // Refresh the full category list to get the new one with proper position
    dispatch(fetchCategories());
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to create category');
  }
});

export const updateCategoryThunk = createAsyncThunk<
  void,
  { categoryId: string; name: string },
  { state: RootState; rejectValue: string }
>('chat/updateCategory', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.updateCategory({
      organizationId,
      categoryId: params.categoryId,
      name: params.name,
    });
    dispatch(fetchCategories());
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to update category');
  }
});

export const deleteCategoryThunk = createAsyncThunk<
  void,
  string,
  { state: RootState; rejectValue: string }
>('chat/deleteCategory', async (categoryId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.deleteCategory({ organizationId, categoryId });
    dispatch(fetchCategories());
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to delete category');
  }
});

export const fetchMembers = createAsyncThunk<
  void,
  string,
  { state: RootState; rejectValue: string }
>('chat/fetchMembers', async (channelId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const collected: ReturnType<typeof memberToPlain>[] = [];
    let cursor: string | undefined;
    do {
      const response = await chatApi.getMembers({ organizationId, channelId, cursor });
      collected.push(...response.members.map(memberToPlain));
      cursor = response.nextCursor || undefined;
    } while (cursor);
    dispatch(setChannelMembers({
      channelId,
      members: collected,
    }));
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch members');
  }
});

export const updateChannelThunk = createAsyncThunk<
  ChatChannel,
  {
    channelId: string;
    name?: string;
    description?: string;
    categoryId?: string;
    originalCategoryId?: string;
    // When set, replaces the channel's manual tag set on the server.
    // Empty array clears all manual tags. Omit to leave tags untouched.
    tagIds?: string[];
  },
  { state: RootState; rejectValue: string }
>('chat/updateChannelThunk', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.updateChannel({
      organizationId,
      channelId: params.channelId,
      name: params.name,
      description: params.description,
      tagIds: params.tagIds !== undefined ? { ids: params.tagIds } : undefined,
    });
    if (!response.channel) {
      return rejectWithValue('Failed to update channel');
    }
    // Move category if changed
    if (params.categoryId !== params.originalCategoryId) {
      await chatApi.moveChannelToCategory({
        organizationId,
        channelId: params.channelId,
        categoryId: params.categoryId ?? '',
      });
    }
    hydrateChannelTags(dispatch, [response.channel]);
    const plain = channelToPlain(response.channel);
    // Apply categoryId from our params since the updateChannel response may not reflect the move
    if (params.categoryId !== params.originalCategoryId) {
      plain.categoryId = params.categoryId ?? null;
    }
    dispatch(updateChannel(plain));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to update channel');
  }
});

export const addMembersThunk = createAsyncThunk<
  ChatChannelMember[],
  {
    channelId: string;
    userIds?: string[];
    subjects?: { type: 'USER' | 'AGENT'; id: string }[];
  },
  { state: RootState; rejectValue: string }
>('chat/addMembers', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.addMembers({
      organizationId,
      channelId: params.channelId,
      userIds: params.userIds ?? [],
      subjects: (params.subjects ?? []).map((s) => ({
        type: s.type === 'AGENT' ? SubjectType.AGENT : SubjectType.USER,
        id: s.id,
      })),
    });
    const members = response.members.map(memberToPlain);
    dispatch(fetchMembers(params.channelId));
    return members;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to add members');
  }
});

export const removeMemberThunk = createAsyncThunk<
  { channelId: string; subjectId: string },
  { channelId: string; userId?: string; subject?: { type: 'USER' | 'AGENT'; id: string } },
  { state: RootState; rejectValue: string }
>('chat/removeMember', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const subject = params.subject;
    await chatApi.removeMembers({
      organizationId,
      channelId: params.channelId,
      userIds: subject ? [] : (params.userId ? [params.userId] : []),
      subjects: subject
        ? [{
            type: subject.type === 'AGENT' ? SubjectType.AGENT : SubjectType.USER,
            id: subject.id,
          }]
        : [],
    });
    dispatch(fetchMembers(params.channelId));
    return {
      channelId: params.channelId,
      subjectId: subject?.id ?? params.userId ?? '',
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to remove member');
  }
});

export const fetchChannelResources = createAsyncThunk<
  { resources: import('@/features/chat/types').ChatResource[]; totalCount: number },
  { channelId: string; contentTypeFilter?: string; limit?: number; offset?: number },
  { state: RootState; rejectValue: string }
>('chat/fetchChannelResources', async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.getChannelResources({
      organizationId,
      channelId: params.channelId,
      contentTypeFilter: params.contentTypeFilter,
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
    });
    return {
      resources: response.resources.map((r) => ({
        id: r.id,
        channelId: r.channelId,
        urn: r.urn,
        contentType: r.contentType,
        firstMentionedAt: r.firstMentionedAt ? timestampDate(r.firstMentionedAt).toISOString() : '',
        lastMentionedAt: r.lastMentionedAt ? timestampDate(r.lastMentionedAt).toISOString() : '',
        mentionCount: r.mentionCount,
        firstMentionedBy: r.firstMentionedBy,
        title: r.title || undefined,
      })),
      totalCount: response.totalCount,
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch resources');
  }
});

export const updateChannelMember = createAsyncThunk<
  ChatChannelMember,
  {
    channelId: string;
    userId: string;
    isMuted?: boolean;
    notificationLevel?: number;
    mutedUntil?: string;
    followAllThreads?: boolean;
    badgeAllMessages?: boolean;
  },
  { state: RootState; rejectValue: string }
>('chat/updateChannelMember', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const reqPayload: Record<string, unknown> = {
      organizationId,
      channelId: params.channelId,
      userId: params.userId,
      isMuted: params.isMuted,
      notificationLevel: params.notificationLevel,
      followAllThreads: params.followAllThreads,
      badgeAllMessages: params.badgeAllMessages,
    };
    if (params.mutedUntil) {
      const seconds = BigInt(Math.floor(new Date(params.mutedUntil).getTime() / 1000));
      reqPayload.mutedUntil = { seconds, nanos: 0 };
    }
    const response = await chatApi.updateChannelMember(reqPayload);
    if (!response.member) {
      return rejectWithValue('Failed to update member');
    }
    const plain = memberToPlain(response.member);

    dispatch(updateChannelPreference({
      channelId: params.channelId,
      prefs: {
        isMuted: plain.isMuted,
        notificationLevel: plain.notificationLevel,
        mutedUntil: plain.mutedUntil,
      },
    }));

    dispatch(fetchMembers(params.channelId));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to update member');
  }
});

export const initializeChat = createAsyncThunk<
  void,
  { channelId?: string; messageId?: string },
  { state: RootState; rejectValue: string }
>('chat/initialize', async ({ channelId: initialChannelId, messageId }, { getState, dispatch, rejectWithValue }) => {
  try {
    // Load channels, categories, unread counts, and agents in parallel.
    // Agents power DM sidebar avatars, typing indicators, and the @-mention
    // / new-DM pickers — fetched here so chat-only users never see empty
    // agent state.
    await Promise.all([
      dispatch(fetchChannels()).unwrap(),
      dispatch(fetchCategories()).unwrap(),
      dispatch(fetchUnreadCounts()).unwrap(),
      dispatch(fetchThreadsInbox()).unwrap(),
      dispatch(fetchAgents()).unwrap().catch(() => {}),
    ]);

    // Set active channel from URL or default to first
    const state = getState();
    const channels = state.chatChannels.channels;
    const targetChannelId = initialChannelId ?? channels[0]?.id;

    if (targetChannelId) {
      dispatch(setActiveChannel(targetChannelId));
      // If a specific message is targeted, fetch around it; otherwise fetch latest
      dispatch(fetchMessages({
        channelId: targetChannelId,
        aroundId: messageId,
      }));
    }
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to initialize chat');
  }
});

export const respondToAgentConfirmation = createAsyncThunk<
  { requestId: string; approved: boolean },
  { channelId: string; messageId: string; requestId: string; approved: boolean; rationale?: string },
  { state: RootState; rejectValue: string }
>('chat/respondToAgentConfirmation', async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.respondToAgentConfirmation({
      organizationId,
      channelId: params.channelId,
      messageId: params.messageId,
      requestId: params.requestId,
      decision: params.approved ? AgentConfirmationDecision.APPROVE : AgentConfirmationDecision.DENY,
      rationale: params.rationale,
    });
    return { requestId: params.requestId, approved: params.approved };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to respond to agent confirmation');
  }
});

/**
 * Restore synthetic confirmation-request cards after a page reload.
 *
 * The approval state itself lives in Valkey (ApprovalStore, TTL 24h). The
 * synthetic message rows that render the card live only in Redux, so a
 * reload mid-flight drops them. We call this on channel mount and append
 * one synthetic row per pending approval, mirroring the shape the
 * AGENT_CONFIRMATION_REQUESTED stream event would have injected.
 */
export const fetchChannelPendingApprovals = createAsyncThunk<
  void,
  { channelId: string },
  { state: RootState; rejectValue: string }
>('chat/fetchChannelPendingApprovals', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.getChannelPendingApprovals({
      organizationId,
      channelId: params.channelId,
    });
    const existingIds = getState().chatMessages.idSetByChannel[params.channelId] ?? {};

    for (const a of response.approvals) {
      if (existingIds[a.requestId]) continue;
      const requestedIso = a.requestedAt
        ? new Date(Number(a.requestedAt.seconds) * 1000 + Math.floor(a.requestedAt.nanos / 1e6)).toISOString()
        : new Date().toISOString();
      const expiresIso = a.expiresAt
        ? new Date(Number(a.expiresAt.seconds) * 1000 + Math.floor(a.expiresAt.nanos / 1e6)).toISOString()
        : null;
      const synthetic: ChatMessage = {
        id: a.requestId,
        channelId: params.channelId,
        senderId: a.agentId,
        senderType: 'AGENT',
        content: '',
        rootId: null,
        replyToId: null,
        editedAt: null,
        isDeleted: false,
        isPinned: false,
        metadata: {
          kind: 'confirmation_request',
          agent_id: a.agentId,
          request_id: a.requestId,
          message_id: a.messageId,
          tool_name: a.toolName,
          args_preview: a.argsPreview,
          actor_user_id: a.actorUserId,
          ...(expiresIso ? { expires_at: expiresIso } : {}),
        },
        createdAt: requestedIso,
        updatedAt: requestedIso,
        reactions: [],
      };
      dispatch(appendMessage({ channelId: params.channelId, message: synthetic }));
    }
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch pending approvals');
  }
});
