import { createAsyncThunk } from "@reduxjs/toolkit";
import type { Dispatch, UnknownAction } from "@reduxjs/toolkit";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { chatApi } from "@/features/chat/api/chatApi";
import { attachmentsApi } from "@/features/files/api/attachmentsApi";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import type { ChatChannel as ProtoChatChannel } from "@uniffy/proto/chat/v1/chat_pb";
import {
  ChannelRole,
  ChatBroadcastMinRole,
  ChatEditHistoryVisibility,
} from "@uniffy/proto/chat/v1/chat_pb";
import {
  channelToPlain,
  messageToPlain,
  memberToPlain,
  categoryToPlain,
  draftToPlain,
  threadInboxItemToPlain,
} from "@/features/chat/api/chatConverters";
import { draftClientSessionId } from "@/features/chat/api/draftSession";
import { bulkUpsertTags, tagToPlain } from "@/features/tags";
import {
  setChannels,
  setArchivedChannels,
  archivedLoadStarted,
  archivedLoadFailed,
  invalidateArchivedChannels,
  addChannel,
  removeChannel,
  updateChannel,
  setChannelMembers,
  setMemberRole,
  setChannelPreferences,
  updateChannelPreference,
  setCategories,
  setAgentFolders,
  upsertAgentFolder,
  removeAgentFolder,
  setChannelAgentFolder,
  setLoading,
  updateUnreadCounts,
  setActiveChannel,
  setManualUnread,
  selectIsManuallyUnread,
  selectUnreadCountsLoaded,
  markUnreadCountsLoaded,
  setOrgChatPolicy,
  clearChannelCategory,
  type OrgChatPolicy,
} from "@/features/chat/store/chatChannelsSlice";
import {
  setMessages,
  prependMessages,
  appendMessage,
  cacheMessage,
  updateMessage,
  deleteMessage,
  clearChannelMessages,
  setHasMore,
  setUnreadSeparator,
  setChannelLoading,
  setInitialChannelLoadFailed,
  addReactionToMessage,
  removeReactionFromMessage,
  restrictForwardsFromChannel,
  restrictForwardsFromMessage,
} from "@/features/chat/store/chatMessagesSlice";
import {
  setDrafts,
  draftUpserted,
  draftRemoved,
  draftKey,
} from "@/features/chat/store/chatDraftsSlice";
import {
  setThreadMessages,
  setThreadsInbox,
  followThread as followThreadAction,
  unfollowThread as unfollowThreadAction,
  setLoadingThread,
  addReactionToThreadMessage,
  removeReactionFromThreadMessage,
  restrictThreadForwardsFromChannel,
  restrictThreadForwardsFromMessage,
} from "@/features/chat/store/chatThreadsSlice";
import { jumpToMessage, clearJumpToMessage } from "@/features/chat/store/chatUiSlice";
import { fetchAgents } from "@/features/agents/store/agentsThunks";
import {
  fetchAvailableModels,
  fetchProviderKeys,
} from "@/features/agents/store/agentProvidersThunks";
import { fetchAgentTools } from "@/features/agents/store/agentToolsThunks";
import { markNotificationsReadBySource } from "@/features/notifications/store/notificationsSlice";
import type { RootState } from "@/app/store";
import type { ChatMessage, ChatChannel, ChatChannelMember } from "@/features/chat/types";
import {
  clearLastOpenedChannel,
  loadLastOpenedChannel,
} from "@/features/chat/utils/lastOpenedChannel";
import { chooseChatLanding } from "@/features/chat/utils/landing";
import { firstUnreadMessageId } from "@/features/chat/utils/readCursor";
import {
  isChatSessionCurrent,
  loadChatInitialization,
  loadLatestChannelMessages,
  type MessagePage,
} from "@/features/chat/store/chatPreload";
import {
  ChannelType as ProtoChannelType,
  ChatNotificationLevel,
  AgentConfirmationDecision,
} from "@uniffy/proto/chat/v1/chat_pb";
import { SubjectType } from "@uniffy/proto/common/v1/common_pb";

const getOrganizationId = (state: RootState): string => {
  const orgId = state.auth.currentOrganizationId;
  if (!orgId) {
    throw new Error("No organization selected");
  }
  return orgId;
};

const INITIAL_MESSAGE_RETRY_DELAY_MS = 250;

const removeChannelLocally = (
  state: RootState,
  dispatch: Dispatch<UnknownAction>,
  organizationId: string,
  channelId: string,
): void => {
  if (state.chatChannels.activeChannelId === channelId && state.auth.user?.id) {
    clearLastOpenedChannel(organizationId, state.auth.user.id);
  }
  dispatch(restrictForwardsFromChannel(channelId));
  dispatch(restrictThreadForwardsFromChannel(channelId));
  dispatch(clearChannelMessages(channelId));
  dispatch(removeChannel(channelId));
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

async function loadChannels(
  getState: () => RootState,
  dispatch: Dispatch<UnknownAction>,
): Promise<void> {
  const auth = getState().auth;
  dispatch(setLoading(true));
  try {
    const organizationId = getOrganizationId(getState());
    const collected: ChatChannel[] = [];
    let cursor: string | undefined;
    do {
      const response = await chatApi.listChannels({ organizationId, cursor });
      if (!isChatSessionCurrent(auth, getState().auth)) return;
      hydrateChannelTags(dispatch, response.channels);
      collected.push(...response.channels.map(channelToPlain));
      cursor = response.nextCursor || undefined;
    } while (cursor);
    if (isChatSessionCurrent(auth, getState().auth)) dispatch(setChannels(collected));
  } finally {
    if (isChatSessionCurrent(auth, getState().auth)) dispatch(setLoading(false));
  }
}

export const fetchChannels = createAsyncThunk<
  void,
  void,
  { state: RootState; rejectValue: string }
>("chat/fetchChannels", async (_, { getState, dispatch, rejectWithValue }) => {
  try {
    await loadChannels(getState, dispatch);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch channels");
  }
});

export const fetchPublicChannels = createAsyncThunk<
  ChatChannel[],
  void,
  { state: RootState; rejectValue: string }
>("chat/fetchPublicChannels", async (_, { getState, dispatch, rejectWithValue }) => {
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
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to fetch public channels",
    );
  }
});

export const fetchChannel = createAsyncThunk<
  ChatChannel | null,
  string,
  { state: RootState; rejectValue: string }
>("chat/fetchChannel", async (channelId, { getState, dispatch, rejectWithValue }) => {
  const { auth, chatChannels } = getState();
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.getChannel({ organizationId, channelId });
    if (
      !isChatSessionCurrent(auth, getState().auth) ||
      chatChannels.revision !== getState().chatChannels.revision ||
      chatChannels.revisionsById[channelId] !== getState().chatChannels.revisionsById[channelId]
    ) {
      return null;
    }
    if (!response.channel) return rejectWithValue("Channel not found");
    const channel = channelToPlain(response.channel);
    hydrateChannelTags(dispatch, [response.channel]);
    dispatch(addChannel(channel));
    return channel;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to load channel");
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
    subjects?: { type: "USER" | "AGENT"; id: string }[];
    tagIds?: string[];
  },
  { state: RootState; rejectValue: string }
>("chat/createChannel", async (params, { getState, dispatch, rejectWithValue }) => {
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
        type: s.type === "AGENT" ? SubjectType.AGENT : SubjectType.USER,
        id: s.id,
      })),
      tagIds: params.tagIds ?? [],
    });
    if (!response.channel) {
      return rejectWithValue("Failed to create channel");
    }
    hydrateChannelTags(dispatch, [response.channel]);
    const plain = channelToPlain(response.channel);
    dispatch(addChannel(plain));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to create channel");
  }
});

export const createAgentChat = createAsyncThunk<
  ChatChannel,
  { agentId: string; customName?: string },
  { state: RootState; rejectValue: string }
>("chat/createAgentChat", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.createAgentChat({
      organizationId,
      agentId: params.agentId,
      customName: params.customName,
    });
    if (!response.channel) {
      return rejectWithValue("Failed to create agent chat");
    }
    hydrateChannelTags(dispatch, [response.channel]);
    const plain = channelToPlain(response.channel);
    dispatch(addChannel(plain));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to create agent chat");
  }
});

export const renameAgentChat = createAsyncThunk<
  ChatChannel,
  { channelId: string; customName: string | null },
  { state: RootState; rejectValue: string }
>("chat/renameAgentChat", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.renameAgentChat({
      organizationId,
      channelId: params.channelId,
      // Empty string clears the override on the server.
      customName: params.customName ?? "",
    });
    if (!response.channel) {
      return rejectWithValue("Failed to rename agent chat");
    }
    hydrateChannelTags(dispatch, [response.channel]);
    const plain = channelToPlain(response.channel);
    dispatch(updateChannel(plain));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to rename agent chat");
  }
});

export const joinChannel = createAsyncThunk<
  ChatChannel,
  string,
  { state: RootState; rejectValue: string }
>("chat/joinChannel", async (channelId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.joinChannel({ organizationId, channelId });
    if (!response.channel) {
      return rejectWithValue("Failed to join channel");
    }
    hydrateChannelTags(dispatch, [response.channel]);
    const plain = channelToPlain(response.channel);
    const existing = getState().chatChannels.byId[channelId];
    if (existing) {
      dispatch(updateChannel(plain));
    } else {
      dispatch(addChannel(plain));
    }
    dispatch(setActiveChannel(channelId));
    dispatch(fetchMessages({ channelId }));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to join channel");
  }
});

export const leaveChannel = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string }
>("chat/leaveChannel", async (channelId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.leaveChannel({ organizationId, channelId });
    removeChannelLocally(getState(), dispatch, organizationId, channelId);
    return channelId;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to leave channel");
  }
});

export const archiveChannel = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string }
>("chat/archiveChannel", async (channelId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.archiveChannel({ organizationId, channelId });
    removeChannelLocally(getState(), dispatch, organizationId, channelId);
    return channelId;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to archive channel");
  }
});

export const fetchArchivedChannels = createAsyncThunk<
  void,
  { cursor?: string } | void,
  { state: RootState; rejectValue: string }
>(
  "chat/fetchArchivedChannels",
  async (params, { getState, dispatch, rejectWithValue, requestId }) => {
    const auth = getState().auth;
    dispatch(archivedLoadStarted(requestId));
    try {
      const organizationId = getOrganizationId(getState());
      const response = await chatApi.listChannels({
        organizationId,
        archivedOnly: true,
        cursor: params?.cursor,
      });
      if (
        !isChatSessionCurrent(auth, getState().auth) ||
        getState().chatChannels.archivedRequestId !== requestId
      )
        return;
      hydrateChannelTags(dispatch, response.channels);
      dispatch(
        setArchivedChannels({
          requestId,
          channels: response.channels.map(channelToPlain),
          nextCursor: response.nextCursor || null,
          append: !!params?.cursor,
        }),
      );
    } catch (error) {
      if (
        !isChatSessionCurrent(auth, getState().auth) ||
        getState().chatChannels.archivedRequestId !== requestId
      )
        return;
      const message = error instanceof Error ? error.message : "Failed to load archived channels";
      dispatch(archivedLoadFailed({ requestId, error: message }));
      return rejectWithValue(message);
    }
  },
  { condition: (_, { getState }) => !getState().chatChannels.archivedRequestId },
);

export const unarchiveChannel = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string }
>("chat/unarchiveChannel", async (channelId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.unarchiveChannel({ organizationId, channelId });
    dispatch(invalidateArchivedChannels({}));
    if (response.channel) {
      dispatch(addChannel(channelToPlain(response.channel)));
    }
    return channelId;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to restore channel");
  }
});

export const deleteChannel = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string }
>("chat/deleteChannel", async (channelId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.deleteChannel({ organizationId, channelId });
    removeChannelLocally(getState(), dispatch, organizationId, channelId);
    return channelId;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to delete channel");
  }
});

async function loadMessagePage(
  request: Parameters<typeof chatApi.getMessages>[0],
): Promise<MessagePage> {
  const response = await chatApi.getMessages(request);
  const messages = response.messages.map(messageToPlain);

  // Attachments share one batched read for the whole message page.
  if (messages.length > 0) {
    try {
      const batch = await attachmentsApi.batchListAttachments({
        organizationId: request.organizationId,
        contentType: ContentType.CHAT_MESSAGE,
        contentIds: messages.map((m) => m.id),
      });
      const byId = new Map<string, (typeof messages)[number]["attachments"]>();
      for (const group of batch.groups) {
        byId.set(
          group.contentId,
          group.attachments.map((a) => ({
            id: a.id,
            fileId: a.fileId,
            sourceFileId: a.sourceFileId || undefined,
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

  return { messages, hasMore: response.hasMore };
}

export const fetchMessages = createAsyncThunk<
  { messages: ChatMessage[]; hasMore: boolean },
  { channelId: string; beforeId?: string; aroundId?: string; limit?: number },
  { state: RootState; rejectValue: string }
>("chat/fetchMessages", async (params, { getState, dispatch, rejectWithValue }) => {
  const currentState = getState();
  try {
    if (!currentState.chatChannels.byId[params.channelId]) {
      return { messages: [], hasMore: false };
    }
    const organizationId = getOrganizationId(currentState);
    if (!params.beforeId) {
      dispatch(setInitialChannelLoadFailed({ channelId: params.channelId, failed: false }));
    }
    dispatch(setChannelLoading({ channelId: params.channelId, isLoading: true }));
    const request = {
      organizationId,
      channelId: params.channelId,
      beforeId: params.beforeId,
      aroundId: params.aroundId,
      limit: params.limit ?? 50,
      rootOnly: true,
    };
    const load = () => loadMessagePage(request);
    const loadPage = () =>
      !params.beforeId && !params.aroundId && !params.limit
        ? loadLatestChannelMessages(getState, params.channelId, load)
        : load();
    let response: MessagePage;
    try {
      response = await loadPage();
    } catch (error) {
      if (params.beforeId) throw error;
      await new Promise((resolve) => setTimeout(resolve, INITIAL_MESSAGE_RETRY_DELAY_MS));
      if (!isChatSessionCurrent(currentState.auth, getState().auth))
        return { messages: [], hasMore: false };
      response = await loadPage();
    }
    if (
      !isChatSessionCurrent(currentState.auth, getState().auth) ||
      !getState().chatChannels.byId[params.channelId]
    ) {
      return { messages: [], hasMore: false };
    }
    const { messages } = response;

    if (params.beforeId) {
      dispatch(prependMessages({ channelId: params.channelId, messages }));
    } else if (params.aroundId) {
      // The window ends mid-history, so the last row here is not the newest message: marking
      // the channel read off it would move the read cursor backwards. An unusable target makes
      // the server serve the latest page instead, which is a live tail like any other.
      const windowed = messages.some((m) => m.id === params.aroundId);
      dispatch(setMessages({ channelId: params.channelId, messages, windowed }));
      dispatch(fetchChannelPendingApprovals({ channelId: params.channelId }));
    } else {
      // Latch the unread separator before the channel is marked read, and so
      // before the cursor it anchors on moves. On a cold load this request
      // outruns GetUnreadCounts, so wait for the cursor instead of racing it -
      // otherwise the divider is computed against empty state and never shows.
      if (!selectUnreadCountsLoaded(getState())) {
        await dispatch(fetchUnreadCounts());
      }
      const state = getState();
      const channel = state.chatChannels.byId[params.channelId];
      const unreadCount = channel?.unreadCount ?? 0;
      if (unreadCount > 0 && messages.length > 0) {
        const firstUnreadId = firstUnreadMessageId(
          messages.map((m) => m.id),
          channel?.lastReadMessageId,
        );
        if (firstUnreadId) {
          dispatch(setUnreadSeparator({ channelId: params.channelId, messageId: firstUnreadId }));
        }
      }

      dispatch(setMessages({ channelId: params.channelId, messages }));

      // Re-hydrate any pending agent approval cards still live in Valkey (24h TTL) but dropped from Redux on reload.
      dispatch(fetchChannelPendingApprovals({ channelId: params.channelId }));

      const lastMessage = messages[messages.length - 1];
      if (lastMessage && !selectIsManuallyUnread(state, params.channelId)) {
        dispatch(
          markChannelRead({
            channelId: params.channelId,
            lastReadMessageId: lastMessage.id,
          }),
        );
        dispatch(
          updateUnreadCounts([
            {
              channelId: params.channelId,
              unreadCount: 0,
              mentionCount: 0,
              lastReadMessageId: lastMessage.id,
            },
          ]),
        );
      }
    }
    dispatch(setHasMore({ channelId: params.channelId, hasMore: response.hasMore }));
    return { messages, hasMore: response.hasMore };
  } catch (error) {
    if (!isChatSessionCurrent(currentState.auth, getState().auth))
      return { messages: [], hasMore: false };
    if (getState().chatMessages.idsByChannel[params.channelId] === undefined) {
      dispatch(setInitialChannelLoadFailed({ channelId: params.channelId, failed: true }));
    }
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch messages");
  } finally {
    if (isChatSessionCurrent(currentState.auth, getState().auth)) {
      dispatch(setChannelLoading({ channelId: params.channelId, isLoading: false }));
    }
  }
});

export const sendMessage = createAsyncThunk<
  ChatMessage,
  {
    channelId: string;
    content: string;
    rootId?: string;
    replyToId?: string;
    attachmentFileIds?: string[];
    metadata?: Record<string, string>;
    alsoSendToChannel?: boolean;
  },
  { state: RootState; rejectValue: string }
>("chat/sendMessage", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.sendMessage({
      organizationId,
      channelId: params.channelId,
      content: params.content,
      rootId: params.rootId,
      replyToId: params.replyToId,
      attachmentFileIds: params.attachmentFileIds ?? [],
      metadata: params.metadata ?? {},
      alsoSendToChannel: params.alsoSendToChannel ?? false,
    });
    if (!response.message) {
      return rejectWithValue("Failed to send message");
    }
    const plain = messageToPlain(response.message);
    // Instant local clear; the server also clears the draft and fans out to other devices.
    dispatch(draftRemoved(draftKey(params.channelId, params.rootId)));
    // Append eagerly for immediate display; the stream will also deliver it.
    if (!params.rootId) {
      dispatch(appendMessage({ channelId: params.channelId, message: plain }));
    }
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to send message");
  }
});

export const forwardMessage = createAsyncThunk<
  ChatMessage,
  { sourceMessageId: string; targetChannelId: string; comment?: string },
  { state: RootState; rejectValue: string }
>("chat/forwardMessage", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.forwardMessage({
      organizationId,
      sourceMessageId: params.sourceMessageId,
      targetChannelId: params.targetChannelId,
      comment: params.comment ?? "",
    });
    if (!response.message) {
      return rejectWithValue("Failed to forward message");
    }
    const plain = messageToPlain(response.message);
    // Append eagerly for immediate display; the stream will also deliver it.
    dispatch(appendMessage({ channelId: params.targetChannelId, message: plain }));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to forward message");
  }
});

export const editMessage = createAsyncThunk<
  ChatMessage,
  { channelId: string; messageId: string; content: string },
  { state: RootState; rejectValue: string }
>("chat/editMessage", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.updateMessage({
      organizationId,
      channelId: params.channelId,
      messageId: params.messageId,
      content: params.content,
    });
    if (!response.message) {
      return rejectWithValue("Failed to edit message");
    }
    const plain = messageToPlain(response.message);
    dispatch(updateMessage({ channelId: params.channelId, message: plain }));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to edit message");
  }
});

export const removeMessage = createAsyncThunk<
  void,
  { channelId: string; messageId: string },
  { state: RootState; rejectValue: string }
>("chat/removeMessage", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.deleteMessage({
      organizationId,
      channelId: params.channelId,
      messageId: params.messageId,
    });
    dispatch(restrictForwardsFromMessage(params.messageId));
    dispatch(restrictThreadForwardsFromMessage(params.messageId));
    dispatch(deleteMessage({ channelId: params.channelId, messageId: params.messageId }));
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to delete message");
  }
});

export const pinMessage = createAsyncThunk<
  ChatMessage,
  { channelId: string; messageId: string },
  { state: RootState; rejectValue: string }
>("chat/pinMessage", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.pinMessage({
      organizationId,
      channelId: params.channelId,
      messageId: params.messageId,
    });
    if (!response.message) {
      return rejectWithValue("Failed to pin message");
    }
    const plain = messageToPlain(response.message);
    dispatch(updateMessage({ channelId: params.channelId, message: plain }));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to pin message");
  }
});

export const unpinMessage = createAsyncThunk<
  ChatMessage,
  { channelId: string; messageId: string },
  { state: RootState; rejectValue: string }
>("chat/unpinMessage", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.unpinMessage({
      organizationId,
      channelId: params.channelId,
      messageId: params.messageId,
    });
    if (!response.message) {
      return rejectWithValue("Failed to unpin message");
    }
    const plain = messageToPlain(response.message);
    dispatch(updateMessage({ channelId: params.channelId, message: plain }));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to unpin message");
  }
});

export const fetchPinnedMessages = createAsyncThunk<
  ChatMessage[],
  string,
  { state: RootState; rejectValue: string }
>("chat/fetchPinnedMessages", async (channelId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.getPinnedMessages({ organizationId, channelId });
    return response.messages.map(messageToPlain);
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to fetch pinned messages",
    );
  }
});

export const addReaction = createAsyncThunk<
  void,
  { channelId: string; messageId: string; emoji: string },
  { state: RootState; rejectValue: string }
>("chat/addReaction", async (params, { getState, dispatch, rejectWithValue }) => {
  const state = getState();
  const organizationId = getOrganizationId(state);
  const currentUserId = state.auth.user?.id ?? "";

  try {
    dispatch(
      addReactionToMessage({
        channelId: params.channelId,
        messageId: params.messageId,
        emoji: params.emoji,
        userId: currentUserId,
        currentUserId,
      }),
    );

    dispatch(
      addReactionToThreadMessage({
        messageId: params.messageId,
        emoji: params.emoji,
        userId: currentUserId,
        currentUserId,
      }),
    );

    await chatApi.addReaction({
      organizationId,
      channelId: params.channelId,
      messageId: params.messageId,
      emoji: params.emoji,
    });
  } catch (error) {
    dispatch(
      removeReactionFromMessage({
        channelId: params.channelId,
        messageId: params.messageId,
        emoji: params.emoji,
        userId: currentUserId,
        currentUserId,
      }),
    );
    dispatch(
      removeReactionFromThreadMessage({
        messageId: params.messageId,
        emoji: params.emoji,
        userId: currentUserId,
        currentUserId,
      }),
    );
    return rejectWithValue(error instanceof Error ? error.message : "Failed to add reaction");
  }
});

export const removeReaction = createAsyncThunk<
  void,
  { channelId: string; messageId: string; emoji: string },
  { state: RootState; rejectValue: string }
>("chat/removeReaction", async (params, { getState, dispatch, rejectWithValue }) => {
  const state = getState();
  const organizationId = getOrganizationId(state);
  const currentUserId = state.auth.user?.id ?? "";

  try {
    dispatch(
      removeReactionFromMessage({
        channelId: params.channelId,
        messageId: params.messageId,
        emoji: params.emoji,
        userId: currentUserId,
        currentUserId,
      }),
    );

    dispatch(
      removeReactionFromThreadMessage({
        messageId: params.messageId,
        emoji: params.emoji,
        userId: currentUserId,
        currentUserId,
      }),
    );

    await chatApi.removeReaction({
      organizationId,
      channelId: params.channelId,
      messageId: params.messageId,
      emoji: params.emoji,
    });
  } catch (error) {
    dispatch(
      addReactionToMessage({
        channelId: params.channelId,
        messageId: params.messageId,
        emoji: params.emoji,
        userId: currentUserId,
        currentUserId,
      }),
    );
    dispatch(
      addReactionToThreadMessage({
        messageId: params.messageId,
        emoji: params.emoji,
        userId: currentUserId,
        currentUserId,
      }),
    );
    return rejectWithValue(error instanceof Error ? error.message : "Failed to remove reaction");
  }
});

export const fetchThread = createAsyncThunk<
  { rootMessage: ChatMessage; replyCount: number; isFollowing: boolean },
  { channelId: string; rootMessageId: string },
  { state: RootState; rejectValue: string }
>("chat/fetchThread", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    dispatch(setLoadingThread(true));
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.getThread({
      organizationId,
      channelId: params.channelId,
      rootMessageId: params.rootMessageId,
    });
    if (!response.rootMessage) {
      return rejectWithValue("Thread not found");
    }
    const rootMessage = messageToPlain(response.rootMessage);
    return { rootMessage, replyCount: response.replyCount, isFollowing: response.isFollowing };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch thread");
  } finally {
    dispatch(setLoadingThread(false));
  }
});

export const fetchDraftRoot = createAsyncThunk<
  void,
  { channelId: string; rootMessageId: string },
  { state: RootState; rejectValue: string }
>("chat/fetchDraftRoot", async (params, { getState, dispatch, rejectWithValue, signal }) => {
  const { auth, chatChannels } = getState();
  try {
    const response = await chatApi.getThread({
      organizationId: getOrganizationId(getState()),
      channelId: params.channelId,
      rootMessageId: params.rootMessageId,
    });
    if (
      signal.aborted ||
      !isChatSessionCurrent(auth, getState().auth) ||
      chatChannels.revision !== getState().chatChannels.revision ||
      chatChannels.revisionsById[params.channelId] !==
        getState().chatChannels.revisionsById[params.channelId]
    )
      return rejectWithValue("Conversation changed. Open draft again.");
    if (!response.rootMessage || response.rootMessage.isDeleted) {
      return rejectWithValue("Message not found");
    }
    dispatch(cacheMessage(messageToPlain(response.rootMessage)));
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to load draft message");
  }
});

export const fetchThreadMessages = createAsyncThunk<
  ChatMessage[],
  { channelId: string; rootMessageId: string; beforeId?: string; limit?: number },
  { state: RootState; rejectValue: string }
>("chat/fetchThreadMessages", async (params, { getState, dispatch, rejectWithValue }) => {
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
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to fetch thread messages",
    );
  }
});

/** Resolve the thread root for a message; ensures the root is loaded so ThreadPanel can render it. */
export const resolveThreadForMessage = createAsyncThunk<
  { rootMessageId: string; targetMessageId: string } | null,
  { channelId: string; messageId: string },
  { state: RootState; rejectValue: string }
>("chat/resolveThreadForMessage", async (params, { getState, dispatch }) => {
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
        dispatch(
          appendMessage({
            channelId: params.channelId,
            message: messageToPlain(resp.message),
          }),
        );
      }
    } catch {
      return null;
    }
  }

  return { rootMessageId: rootId, targetMessageId: params.messageId };
});

/** Scroll a channel to a message, loading the page it sits on when it is outside the current window. */
export const jumpToChannelMessage = createAsyncThunk<
  void,
  { channelId: string; messageId: string },
  { state: RootState; rejectValue: string }
>("chat/jumpToChannelMessage", async ({ channelId, messageId }, { getState, dispatch }) => {
  const state = getState();
  if (state.chatChannels.activeChannelId !== channelId) {
    dispatch(setActiveChannel(channelId));
  }

  // Claim the target before loading: the list reads the pending jump to decide where a freshly
  // loaded window opens, which beats mounting at the tail and scrolling back against it.
  dispatch(jumpToMessage(messageId));

  // Without the around-fetch an older target is simply absent from the list and the scroll is a silent no-op.
  if (state.chatMessages.idSetByChannel[channelId]?.[messageId] !== true) {
    const { messages } = await dispatch(fetchMessages({ channelId, aroundId: messageId })).unwrap();
    // A deleted or purged target leaves the channel on its latest page with nothing to scroll to.
    if (!messages.some((m) => m.id === messageId)) {
      dispatch(clearJumpToMessage());
    }
  }
});

/** Scroll a channel to where the viewer left off, loading the cursor's page when it is out of window. */
export const jumpToFirstUnread = createAsyncThunk<
  void,
  { channelId: string },
  { state: RootState; rejectValue: string }
>("chat/jumpToFirstUnread", async ({ channelId }, { getState, dispatch }) => {
  const state = getState();
  const cursor = state.chatChannels.byId[channelId]?.lastReadMessageId;
  const loadedIds = state.chatMessages.idsByChannel[channelId] ?? [];

  // Cursor is in the window: the message right after it is the target.
  if (cursor && state.chatMessages.idSetByChannel[channelId]?.[cursor] === true) {
    const target = firstUnreadMessageId(loadedIds, cursor);
    if (target) await dispatch(jumpToChannelMessage({ channelId, messageId: target }));
    return;
  }

  // Unread runs past the loaded page or the 100 cap, so the first unread is not
  // in the window. The cursor is, by definition, the row before it - load that
  // page and step forward one.
  if (cursor) {
    const { messages } = await dispatch(fetchMessages({ channelId, aroundId: cursor })).unwrap();
    const target = firstUnreadMessageId(
      messages.map((m) => m.id),
      cursor,
    );
    if (target) dispatch(jumpToMessage(target));
    return;
  }

  // Never read: the oldest row we hold is the closest thing to the start.
  if (loadedIds[0]) dispatch(jumpToMessage(loadedIds[0]));
});

export const fetchThreadsInbox = createAsyncThunk<
  void,
  { unreadOnly?: boolean } | void,
  { state: RootState; rejectValue: string }
>("chat/fetchThreadsInbox", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.getThreadsInbox({
      organizationId,
      unreadOnly: params?.unreadOnly ?? false,
      limit: 50,
    });
    dispatch(setThreadsInbox(response.threads.map(threadInboxItemToPlain)));
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to fetch threads inbox",
    );
  }
});

export const followThreadThunk = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string }
>("chat/followThread", async (rootMessageId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.followThread({ organizationId, rootMessageId });
    dispatch(followThreadAction(rootMessageId));
    return rootMessageId;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to follow thread");
  }
});

export const unfollowThreadThunk = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string }
>("chat/unfollowThread", async (rootMessageId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.unfollowThread({ organizationId, rootMessageId });
    dispatch(unfollowThreadAction(rootMessageId));
    return rootMessageId;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to unfollow thread");
  }
});

// Messages arriving for the ACTIVE channel while the tab is hidden accrue a
// badge (the stream handlers skip mark-read when not visible). Reopening the
// same channel never refetches, so this is the only path that clears it.
export const clearActiveChannelUnread = createAsyncThunk<
  void,
  void,
  { state: RootState; rejectValue: string }
>("chat/clearActiveChannelUnread", async (_, { getState, dispatch }) => {
  const state = getState();
  const channelId = state.chatChannels.activeChannelId;
  if (!channelId) return;
  if (selectIsManuallyUnread(state, channelId)) return;
  const channel = state.chatChannels.byId[channelId];
  if (!channel || ((channel.unreadCount ?? 0) === 0 && (channel.mentionCount ?? 0) === 0)) return;
  const ids = state.chatMessages.idsByChannel[channelId];
  const lastId = ids?.[ids.length - 1];
  if (!lastId) return;
  dispatch(updateUnreadCounts([{ channelId, unreadCount: 0, mentionCount: 0 }]));
  dispatch(markChannelRead({ channelId, lastReadMessageId: lastId }));
});

export const markChannelRead = createAsyncThunk<
  void,
  { channelId: string; lastReadMessageId: string },
  { state: RootState; rejectValue: string }
>("chat/markChannelRead", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.markChannelRead({
      organizationId,
      channelId: params.channelId,
      lastReadMessageId: params.lastReadMessageId,
    });
    // Backend cascades chat-sourced notifications; mirror locally so the bell updates without a refetch.
    dispatch(markNotificationsReadBySource(`urn:uniffy:content:CHAT:${params.channelId}`));
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to mark channel read");
  }
});

export const markChannelUnread = createAsyncThunk<
  void,
  { channelId: string; messageId: string },
  { state: RootState; rejectValue: string }
>("chat/markChannelUnread", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    // Set before the call so the auto-mark-read paths cannot race the response
    // and clear the badge the user just asked for.
    dispatch(setManualUnread(params.channelId));
    const response = await chatApi.markChannelUnread({
      organizationId,
      channelId: params.channelId,
      messageId: params.messageId,
    });
    dispatch(
      updateUnreadCounts([
        {
          channelId: params.channelId,
          unreadCount: response.unreadCount,
          mentionCount: response.mentionCount,
          lastReadMessageId: response.lastReadMessageId,
        },
      ]),
    );
    dispatch(setUnreadSeparator({ channelId: params.channelId, messageId: params.messageId }));
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to mark channel unread",
    );
  }
});

export const markThreadRead = createAsyncThunk<
  void,
  string,
  { state: RootState; rejectValue: string }
>("chat/markThreadRead", async (rootMessageId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.markThreadRead({
      organizationId,
      rootMessageId,
    });
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to mark thread read");
  }
});

export const fetchUnreadCounts = createAsyncThunk<
  void,
  void,
  { state: RootState; rejectValue: string }
>("chat/fetchUnreadCounts", async (_, { getState, dispatch, rejectWithValue }) => {
  try {
    const nlMap: Record<number, "ALL" | "MENTIONS" | "NONE"> = {
      [ChatNotificationLevel.ALL]: "ALL",
      [ChatNotificationLevel.MENTIONS]: "MENTIONS",
      [ChatNotificationLevel.NONE]: "NONE",
    };

    const organizationId = getOrganizationId(getState());
    const response = await chatApi.getUnreadCounts({ organizationId });
    dispatch(
      updateUnreadCounts(
        response.channels.map((c) => ({
          channelId: c.channelId,
          unreadCount: c.unreadCount,
          mentionCount: c.mentionCount,
          lastReadMessageId: c.lastReadMessageId,
          latestMessageId: c.latestMessageId,
        })),
      ),
    );
    dispatch(markUnreadCountsLoaded());

    const prefs: Record<
      string,
      {
        isMuted: boolean;
        notificationLevel: "ALL" | "MENTIONS" | "NONE";
        mutedUntil: string | null;
      }
    > = {};
    for (const c of response.channels) {
      prefs[c.channelId] = {
        isMuted: c.isMuted,
        notificationLevel: nlMap[c.notificationLevel] ?? "ALL",
        mutedUntil: c.mutedUntil
          ? new Date(Number(c.mutedUntil.seconds) * 1000).toISOString()
          : null,
      };
    }
    dispatch(setChannelPreferences(prefs));
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to fetch unread counts",
    );
  }
});

export const fetchDrafts = createAsyncThunk<void, void, { state: RootState }>(
  "chat/fetchDrafts",
  async (_, { getState, dispatch }) => {
    // Swallow failures: this runs on every stream reconnect and must not toast during outages.
    try {
      const organizationId = getOrganizationId(getState());
      const response = await chatApi.listDrafts({ organizationId });
      dispatch(setDrafts(response.drafts.map(draftToPlain)));
    } catch {
      // Drafts reload on the next reconnect or chat mount.
    }
  },
);

export const saveDraftToServer = createAsyncThunk<
  void,
  { channelId: string; rootMessageId?: string; content: string },
  { state: RootState }
>("chat/saveDraftToServer", async (params, { getState, dispatch }) => {
  dispatch(
    draftUpserted({
      channelId: params.channelId,
      rootMessageId: params.rootMessageId ?? null,
      content: params.content,
      updatedAt: new Date().toISOString(),
    }),
  );
  // Swallow failures: a rejected thunk would toast via errorToastMiddleware, and
  // autosave must stay silent. The optimistic local copy keeps the text safe.
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.saveDraft({
      organizationId,
      channelId: params.channelId,
      rootMessageId: params.rootMessageId,
      content: params.content,
      clientSessionId: draftClientSessionId,
    });
  } catch {
    // Server catches up on the next content change.
  }
});

export const deleteDraftOnServer = createAsyncThunk<
  void,
  { channelId: string; rootMessageId?: string },
  { state: RootState }
>("chat/deleteDraftOnServer", async (params, { getState, dispatch }) => {
  dispatch(draftRemoved(draftKey(params.channelId, params.rootMessageId)));
  // Same silence contract as saveDraftToServer.
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.deleteDraft({
      organizationId,
      channelId: params.channelId,
      rootMessageId: params.rootMessageId,
      clientSessionId: draftClientSessionId,
    });
  } catch {
    // A stale server row resurfaces on refetch and clears on the next delete.
  }
});

export const sendTyping = createAsyncThunk<void, string, { state: RootState; rejectValue: string }>(
  "chat/sendTyping",
  async (channelId, { getState, rejectWithValue }) => {
    try {
      const organizationId = getOrganizationId(getState());
      await chatApi.setTyping({ organizationId, channelId });
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to send typing");
    }
  },
);

async function loadCategories(
  getState: () => RootState,
  dispatch: Dispatch<UnknownAction>,
): Promise<void> {
  const scope = getState().auth;
  const organizationId = getOrganizationId(getState());
  const response = await chatApi.listCategories({ organizationId });
  if (!isChatSessionCurrent(scope, getState().auth)) return;
  dispatch(setCategories(response.categories.map(categoryToPlain)));
}

export const fetchCategories = createAsyncThunk<
  void,
  void,
  { state: RootState; rejectValue: string }
>("chat/fetchCategories", async (_, { getState, dispatch, rejectWithValue }) => {
  try {
    await loadCategories(getState, dispatch);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch categories");
  }
});

export const convertGroupDmToChannel = createAsyncThunk<
  ChatChannel,
  { channelId: string; name: string; channelType: ProtoChannelType },
  { state: RootState; rejectValue: string }
>("chat/convertGroupDmToChannel", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.convertGroupDmToChannel({
      organizationId,
      channelId: params.channelId,
      name: params.name,
      channelType: params.channelType,
    });
    if (!response.channel) {
      return rejectWithValue("Failed to convert conversation");
    }
    hydrateChannelTags(dispatch, [response.channel]);
    const plain = channelToPlain(response.channel);
    dispatch(updateChannel(plain));
    return plain;
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to convert conversation",
    );
  }
});

async function loadAgentFolders(
  getState: () => RootState,
  dispatch: Dispatch<UnknownAction>,
): Promise<void> {
  const scope = getState().auth;
  const organizationId = getOrganizationId(getState());
  const response = await chatApi.listAgentFolders({ organizationId });
  if (!isChatSessionCurrent(scope, getState().auth)) return;
  dispatch(
    setAgentFolders(
      response.folders.map((f) => ({ id: f.id, name: f.name, position: f.position })),
    ),
  );
}

export const fetchAgentFolders = createAsyncThunk<
  void,
  void,
  { state: RootState; rejectValue: string }
>("chat/fetchAgentFolders", async (_, { getState, dispatch, rejectWithValue }) => {
  try {
    await loadAgentFolders(getState, dispatch);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch folders");
  }
});

export const createAgentFolder = createAsyncThunk<
  { id: string; name: string; position: number } | null,
  string,
  { state: RootState; rejectValue: string }
>("chat/createAgentFolder", async (name, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.createAgentFolder({ organizationId, name });
    if (!response.folder) return null;
    const plain = {
      id: response.folder.id,
      name: response.folder.name,
      position: response.folder.position,
    };
    dispatch(upsertAgentFolder(plain));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to create folder");
  }
});

export const renameAgentFolder = createAsyncThunk<
  void,
  { folderId: string; name: string },
  { state: RootState; rejectValue: string }
>("chat/renameAgentFolder", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.renameAgentFolder({
      organizationId,
      folderId: params.folderId,
      name: params.name,
    });
    if (response.folder) {
      dispatch(
        upsertAgentFolder({
          id: response.folder.id,
          name: response.folder.name,
          position: response.folder.position,
        }),
      );
    }
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to rename folder");
  }
});

export const deleteAgentFolder = createAsyncThunk<
  void,
  string,
  { state: RootState; rejectValue: string }
>("chat/deleteAgentFolder", async (folderId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.deleteAgentFolder({ organizationId, folderId });
    dispatch(removeAgentFolder(folderId));
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to delete folder");
  }
});

export const setAgentChatFolder = createAsyncThunk<
  void,
  { channelId: string; folderId: string | null },
  { state: RootState; rejectValue: string }
>("chat/setAgentChatFolder", async (params, { getState, dispatch, rejectWithValue }) => {
  const previous = getState().chatChannels.byId[params.channelId]?.agentFolderId ?? null;
  dispatch(setChannelAgentFolder(params));
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.setAgentChatFolder({
      organizationId,
      channelId: params.channelId,
      folderId: params.folderId ?? undefined,
    });
  } catch (error) {
    dispatch(setChannelAgentFolder({ channelId: params.channelId, folderId: previous }));
    return rejectWithValue(error instanceof Error ? error.message : "Failed to move chat");
  }
});

export const reorderCategoriesThunk = createAsyncThunk<
  void,
  string[],
  { state: RootState; rejectValue: string }
>("chat/reorderCategories", async (categoryIds, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.reorderCategories({ organizationId, categoryIds });
    dispatch(fetchCategories());
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to reorder categories");
  }
});

export const createCategoryThunk = createAsyncThunk<
  void,
  string,
  { state: RootState; rejectValue: string }
>("chat/createCategory", async (name, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.createCategory({ organizationId, name });
    dispatch(fetchCategories());
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to create category");
  }
});

export const updateCategoryThunk = createAsyncThunk<
  void,
  { categoryId: string; name: string },
  { state: RootState; rejectValue: string }
>("chat/updateCategory", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.updateCategory({
      organizationId,
      categoryId: params.categoryId,
      name: params.name,
    });
    dispatch(fetchCategories());
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to update category");
  }
});

export const deleteCategoryThunk = createAsyncThunk<
  void,
  string,
  { state: RootState; rejectValue: string }
>("chat/deleteCategory", async (categoryId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.deleteCategory({ organizationId, categoryId });
    dispatch(clearChannelCategory(categoryId));
    dispatch(fetchCategories());
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to delete category");
  }
});

export function chatPolicyToPlain(policy: {
  broadcastMinRole: ChatBroadcastMinRole;
  broadcastConfirmThreshold: number;
  editWindowMinutes?: number;
  editHistoryVisibleTo: ChatEditHistoryVisibility;
  agentsEnabled: boolean;
}): OrgChatPolicy {
  return {
    broadcastMinRole: policy.broadcastMinRole === ChatBroadcastMinRole.ADMIN ? "admin" : "member",
    broadcastConfirmThreshold: policy.broadcastConfirmThreshold,
    editWindowMinutes: policy.editWindowMinutes ?? null,
    editHistoryVisibleTo:
      policy.editHistoryVisibleTo === ChatEditHistoryVisibility.EVERYONE ? "everyone" : "admins",
    agentsEnabled: policy.agentsEnabled,
  };
}

export const fetchChatPolicy = createAsyncThunk<
  void,
  void,
  { state: RootState; rejectValue: string }
>("chat/fetchChatPolicy", async (_, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.getChatPolicy({ organizationId });
    if (response.policy) {
      dispatch(setOrgChatPolicy(chatPolicyToPlain(response.policy)));
    }
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch chat policy");
  }
});

export const updateChatPolicyThunk = createAsyncThunk<
  void,
  OrgChatPolicy,
  { state: RootState; rejectValue: string }
>("chat/updateChatPolicy", async (policy, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.updateChatPolicy({
      organizationId,
      broadcastMinRole:
        policy.broadcastMinRole === "admin"
          ? ChatBroadcastMinRole.ADMIN
          : ChatBroadcastMinRole.MEMBER,
      broadcastConfirmThreshold: policy.broadcastConfirmThreshold,
      editWindowMinutes: policy.editWindowMinutes ?? undefined,
      editHistoryVisibleTo:
        policy.editHistoryVisibleTo === "everyone"
          ? ChatEditHistoryVisibility.EVERYONE
          : ChatEditHistoryVisibility.ADMINS,
      agentsEnabled: policy.agentsEnabled,
    });
    if (response.policy) {
      dispatch(setOrgChatPolicy(chatPolicyToPlain(response.policy)));
    }
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to update chat policy");
  }
});

export const fetchMembers = createAsyncThunk<
  void,
  string,
  { state: RootState; rejectValue: string }
>("chat/fetchMembers", async (channelId, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const collected: ReturnType<typeof memberToPlain>[] = [];
    let cursor: string | undefined;
    do {
      const response = await chatApi.getMembers({ organizationId, channelId, cursor });
      collected.push(...response.members.map(memberToPlain));
      cursor = response.nextCursor || undefined;
    } while (cursor);
    dispatch(
      setChannelMembers({
        channelId,
        members: collected,
      }),
    );
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch members");
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
    /** When set, replaces the channel's manual tag set; empty array clears, omit to leave alone. */
    tagIds?: string[];
  },
  { state: RootState; rejectValue: string }
>("chat/updateChannelThunk", async (params, { getState, dispatch, rejectWithValue }) => {
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
      return rejectWithValue("Failed to update channel");
    }
    if (params.categoryId !== params.originalCategoryId) {
      await chatApi.moveChannelToCategory({
        organizationId,
        channelId: params.channelId,
        categoryId: params.categoryId ?? "",
      });
    }
    hydrateChannelTags(dispatch, [response.channel]);
    const plain = channelToPlain(response.channel);
    // updateChannel response may not reflect the category move; carry it through from params.
    if (params.categoryId !== params.originalCategoryId) {
      plain.categoryId = params.categoryId ?? null;
    }
    dispatch(updateChannel(plain));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to update channel");
  }
});

export const addMembersThunk = createAsyncThunk<
  ChatChannelMember[],
  {
    channelId: string;
    userIds?: string[];
    subjects?: { type: "USER" | "AGENT"; id: string }[];
  },
  { state: RootState; rejectValue: string }
>("chat/addMembers", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.addMembers({
      organizationId,
      channelId: params.channelId,
      userIds: params.userIds ?? [],
      subjects: (params.subjects ?? []).map((s) => ({
        type: s.type === "AGENT" ? SubjectType.AGENT : SubjectType.USER,
        id: s.id,
      })),
    });
    const members = response.members.map(memberToPlain);
    dispatch(fetchMembers(params.channelId));
    return members;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to add members");
  }
});

export const removeMemberThunk = createAsyncThunk<
  { channelId: string; subjectId: string },
  { channelId: string; userId?: string; subject?: { type: "USER" | "AGENT"; id: string } },
  { state: RootState; rejectValue: string }
>("chat/removeMember", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const subject = params.subject;
    await chatApi.removeMembers({
      organizationId,
      channelId: params.channelId,
      userIds: subject ? [] : params.userId ? [params.userId] : [],
      subjects: subject
        ? [
            {
              type: subject.type === "AGENT" ? SubjectType.AGENT : SubjectType.USER,
              id: subject.id,
            },
          ]
        : [],
    });
    dispatch(fetchMembers(params.channelId));
    return {
      channelId: params.channelId,
      subjectId: subject?.id ?? params.userId ?? "",
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to remove member");
  }
});

export const fetchChannelResources = createAsyncThunk<
  { resources: import("@/features/chat/types").ChatResource[]; totalCount: number },
  { channelId: string; contentTypeFilter?: string; limit?: number; offset?: number },
  { state: RootState; rejectValue: string }
>("chat/fetchChannelResources", async (params, { getState, rejectWithValue }) => {
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
        firstMentionedAt: r.firstMentionedAt ? timestampDate(r.firstMentionedAt).toISOString() : "",
        lastMentionedAt: r.lastMentionedAt ? timestampDate(r.lastMentionedAt).toISOString() : "",
        mentionCount: r.mentionCount,
        firstMentionedBy: r.firstMentionedBy,
        title: r.title || undefined,
      })),
      totalCount: response.totalCount,
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch resources");
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
>("chat/updateChannelMember", async (params, { getState, dispatch, rejectWithValue }) => {
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
      return rejectWithValue("Failed to update member");
    }
    const plain = memberToPlain(response.member);

    dispatch(
      updateChannelPreference({
        channelId: params.channelId,
        prefs: {
          isMuted: plain.isMuted,
          notificationLevel: plain.notificationLevel,
          mutedUntil: plain.mutedUntil,
        },
      }),
    );

    dispatch(fetchMembers(params.channelId));
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to update member");
  }
});

export const updateMemberRoleThunk = createAsyncThunk<
  ChatChannelMember,
  { channelId: string; userId: string; role: "MEMBER" | "ADMIN" | "OWNER" },
  { state: RootState; rejectValue: string }
>("chat/updateMemberRole", async (params, { getState, dispatch, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.updateMemberRole({
      organizationId,
      channelId: params.channelId,
      userId: params.userId,
      role: ChannelRole[params.role],
    });
    if (!response.member) {
      return rejectWithValue("Failed to update role");
    }
    const plain = memberToPlain(response.member);
    dispatch(
      setMemberRole({
        channelId: params.channelId,
        userId: params.userId,
        role: plain.role,
      }),
    );
    return plain;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to update role");
  }
});

function loadChatSidebar(
  getState: () => RootState,
  dispatch: Dispatch<UnknownAction>,
): Promise<void> {
  const scope = getState().auth;
  return loadChatInitialization(scope, async () => {
    const index = async () => {
      try {
        await loadChannels(getState, dispatch);
      } catch (error) {
        if (!isChatSessionCurrent(scope, getState().auth)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (!isChatSessionCurrent(scope, getState().auth)) throw error;
        await loadChannels(getState, dispatch);
      }
    };
    await Promise.all([
      index(),
      loadCategories(getState, dispatch).catch(() => {}),
      loadAgentFolders(getState, dispatch).catch(() => {}),
    ]);
  });
}

export const initializeChat = createAsyncThunk<
  void,
  void,
  { state: RootState; rejectValue: string }
>("chat/initialize", async (_, { getState, dispatch, rejectWithValue }) => {
  try {
    await loadChatSidebar(getState, dispatch);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to initialize chat");
  }
});

export const prefetchChannelMessages = createAsyncThunk<void, string, { state: RootState }>(
  "chat/prefetchChannelMessages",
  async (channelId, { getState }) => {
    const state = getState();
    const organizationId = state.auth.currentOrganizationId;
    if (!state.auth.isAuthenticated || !organizationId || !state.chatChannels.byId[channelId])
      return;
    try {
      await loadLatestChannelMessages(
        getState,
        channelId,
        () => loadMessagePage({ organizationId, channelId, limit: 50, rootOnly: true }),
        true,
      );
    } catch {
      // Opening the channel owns visible errors and retries.
    }
  },
);

export const prefetchChat = createAsyncThunk<void, void, { state: RootState }>(
  "chat/prefetch",
  async (_, { getState, dispatch }) => {
    const scope = getState().auth;
    if (!scope.isAuthenticated || !scope.currentOrganizationId || !scope.user) return;
    try {
      await loadChatSidebar(getState, dispatch);
      if (!isChatSessionCurrent(scope, getState().auth)) return;
      const state = getState();
      const channelId = chooseChatLanding(
        state.chatChannels.ids.map((id) => state.chatChannels.byId[id]),
        loadLastOpenedChannel(scope.currentOrganizationId, scope.user.id),
      );
      if (!channelId) return;
      await dispatch(prefetchChannelMessages(channelId));
    } catch {
      // Speculation is optional; opening Chat owns visible errors and retries.
    }
  },
);

// Start auxiliary reads after the visible conversation has loaded: on HTTP/1.1 they
// otherwise occupy the browser's connections ahead of GetMessages.
export const hydrateChat = createAsyncThunk<void, void, { state: RootState }>(
  "chat/hydrate",
  async (_, { dispatch }) => {
    await Promise.all([
      dispatch(fetchUnreadCounts())
        .unwrap()
        .catch(() => {}),
      dispatch(fetchThreadsInbox())
        .unwrap()
        .catch(() => {}),
      dispatch(fetchDrafts())
        .unwrap()
        .catch(() => {}),
      dispatch(fetchAgents())
        .unwrap()
        .catch(() => {}),
      dispatch(fetchProviderKeys())
        .unwrap()
        .catch(() => {}),
      dispatch(fetchAvailableModels())
        .unwrap()
        .catch(() => {}),
      // Labels the tool-activity pane shows while an agent run streams.
      dispatch(fetchAgentTools())
        .unwrap()
        .catch(() => {}),
    ]);
  },
);

export const respondToAgentConfirmation = createAsyncThunk<
  { requestId: string; approved: boolean },
  {
    channelId: string;
    messageId: string;
    requestId: string;
    approved: boolean;
    rationale?: string;
  },
  { state: RootState; rejectValue: string }
>("chat/respondToAgentConfirmation", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await chatApi.respondToAgentConfirmation({
      organizationId,
      channelId: params.channelId,
      messageId: params.messageId,
      requestId: params.requestId,
      decision: params.approved
        ? AgentConfirmationDecision.APPROVE
        : AgentConfirmationDecision.DENY,
      rationale: params.rationale,
    });
    return { requestId: params.requestId, approved: params.approved };
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to respond to agent confirmation",
    );
  }
});

/** Cancel the in-flight agent run (tool call / image gen / text) for a channel agent. */
export const stopAgentRun = createAsyncThunk<
  { stopped: boolean },
  { channelId: string; agentId: string },
  { state: RootState; rejectValue: string }
>("chat/stopAgentRun", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await chatApi.stopAgentRun({
      organizationId,
      channelId: params.channelId,
      agentId: params.agentId,
    });
    return { stopped: response.stopped };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to stop the agent");
  }
});

/** Re-inject synthetic approval cards on channel mount; live in Valkey but Redux drops on reload. */
export const fetchChannelPendingApprovals = createAsyncThunk<
  void,
  { channelId: string },
  { state: RootState; rejectValue: string }
>("chat/fetchChannelPendingApprovals", async (params, { getState, dispatch, rejectWithValue }) => {
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
        ? new Date(
            Number(a.requestedAt.seconds) * 1000 + Math.floor(a.requestedAt.nanos / 1e6),
          ).toISOString()
        : new Date().toISOString();
      const expiresIso = a.expiresAt
        ? new Date(
            Number(a.expiresAt.seconds) * 1000 + Math.floor(a.expiresAt.nanos / 1e6),
          ).toISOString()
        : null;
      const synthetic: ChatMessage = {
        id: a.requestId,
        channelId: params.channelId,
        senderId: a.agentId,
        senderType: "AGENT",
        content: "",
        rootId: null,
        replyToId: null,
        editedAt: null,
        isDeleted: false,
        isPinned: false,
        isForwarded: false,
        metadata: {
          kind: "confirmation_request",
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
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to fetch pending approvals",
    );
  }
});
