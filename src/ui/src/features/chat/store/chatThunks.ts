import { createAsyncThunk } from '@reduxjs/toolkit';
import { chatApi } from '@/features/chat/api/chatApi';
import {
  channelToPlain,
  messageToPlain,
  memberToPlain,
  categoryToPlain,
  threadInboxItemToPlain,
} from '@/features/chat/api/chatConverters';
import {
  setChannels,
  addChannel,
  removeChannel,
  updateChannel,
  setChannelMembers,
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
import type { RootState } from '@/app/store';
import type { ChatMessage, ChatChannel, ChatChannelMember } from '@/features/chat/types';
import { ChannelType as ProtoChannelType } from '@uniffy/proto/chat/v1/chat_pb';

const getOrganizationId = (state: RootState): string => {
  const orgId = state.auth.currentOrganizationId;
  if (!orgId) {
    throw new Error('No organization selected');
  }
  return orgId;
};

export const fetchChannels = createAsyncThunk<
  void,
  void,
  { state: RootState; rejectValue: string }
>('chat/fetchChannels', async (_, { getState, dispatch, rejectWithValue }) => {
  try {
    dispatch(setLoading(true));
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.listChannels({ organizationId });
    dispatch(setChannels(response.channels.map(channelToPlain)));
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
>('chat/fetchPublicChannels', async (_, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.listChannels({ organizationId, browsePublic: true });
    return response.channels.map(channelToPlain);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch public channels');
  }
});

export const createChannel = createAsyncThunk<
  ChatChannel,
  { name: string; channelType: ProtoChannelType; description?: string; icon?: string; categoryId?: string; memberIds?: string[] },
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
    });
    if (!response.channel) {
      return rejectWithValue('Failed to create channel');
    }
    const plain = channelToPlain(response.channel);
    dispatch(addChannel(plain));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to create channel');
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
  void,
  string,
  { state: RootState; rejectValue: string }
>('chat/archiveChannel', async (channelId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.archiveChannel({ organizationId, channelId });
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
  { channelId: string; beforeId?: string; limit?: number },
  { state: RootState; rejectValue: string }
>('chat/fetchMessages', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    dispatch(setChannelLoading({ channelId: params.channelId, isLoading: true }));
    const response = await chatApi.getMessages({
      organizationId,
      channelId: params.channelId,
      beforeId: params.beforeId,
      limit: params.limit ?? 50,
      rootOnly: true,
    });
    const messages = response.messages.map(messageToPlain);
    if (params.beforeId) {
      dispatch(prependMessages({ channelId: params.channelId, messages }));
    } else {
      dispatch(setMessages({ channelId: params.channelId, messages }));

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
  try {
    const state = getState();
    const organizationId = getOrganizationId(state);
    const currentUserId = state.auth.user?.id ?? '';

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
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to add reaction');
  }
});

export const removeReaction = createAsyncThunk<
  void,
  { channelId: string; messageId: string; emoji: string },
  { state: RootState; rejectValue: string }
>('chat/removeReaction', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const state = getState();
    const organizationId = getOrganizationId(state);
    const currentUserId = state.auth.user?.id ?? '';

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
>('chat/markChannelRead', async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.markChannelRead({
      organizationId,
      channelId: params.channelId,
      lastReadMessageId: params.lastReadMessageId,
    });
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
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.getUnreadCounts({ organizationId });
    dispatch(updateUnreadCounts(
      response.channels.map((c) => ({
        channelId: c.channelId,
        unreadCount: c.unreadCount,
        mentionCount: c.mentionCount,
      })),
    ));
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

export const fetchMembers = createAsyncThunk<
  void,
  string,
  { state: RootState; rejectValue: string }
>('chat/fetchMembers', async (channelId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.getMembers({ organizationId, channelId });
    dispatch(setChannelMembers({
      channelId,
      members: response.members.map(memberToPlain),
    }));
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch members');
  }
});

export const updateChannelThunk = createAsyncThunk<
  ChatChannel,
  { channelId: string; name?: string; description?: string; categoryId?: string; originalCategoryId?: string },
  { state: RootState; rejectValue: string }
>('chat/updateChannelThunk', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.updateChannel({
      organizationId,
      channelId: params.channelId,
      name: params.name,
      description: params.description,
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
  { channelId: string; userIds: string[] },
  { state: RootState; rejectValue: string }
>('chat/addMembers', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.addMembers({
      organizationId,
      channelId: params.channelId,
      userIds: params.userIds,
    });
    const members = response.members.map(memberToPlain);
    // Refresh full member list
    dispatch(fetchMembers(params.channelId));
    return members;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to add members');
  }
});

export const removeMemberThunk = createAsyncThunk<
  { channelId: string; userId: string },
  { channelId: string; userId: string },
  { state: RootState; rejectValue: string }
>('chat/removeMember', async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.removeMembers({
      organizationId,
      channelId: params.channelId,
      userIds: [params.userId],
    });
    // Refresh full member list
    dispatch(fetchMembers(params.channelId));
    return { channelId: params.channelId, userId: params.userId };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to remove member');
  }
});

export const initializeChat = createAsyncThunk<
  void,
  string | undefined,
  { state: RootState; rejectValue: string }
>('chat/initialize', async (initialChannelId, { getState, dispatch, rejectWithValue }) => {
  try {
    // Load channels, categories, and unread counts in parallel
    await Promise.all([
      dispatch(fetchChannels()).unwrap(),
      dispatch(fetchCategories()).unwrap(),
      dispatch(fetchUnreadCounts()).unwrap(),
      dispatch(fetchThreadsInbox()).unwrap(),
    ]);

    // Set active channel from URL or default to first
    const state = getState();
    const channels = state.chatChannels.channels;
    const targetChannelId = initialChannelId ?? channels[0]?.id;

    if (targetChannelId) {
      dispatch(setActiveChannel(targetChannelId));
      // Fetch messages immediately so they are ready when the channel renders
      dispatch(fetchMessages({ channelId: targetChannelId }));
    }
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : 'Failed to initialize chat');
  }
});
