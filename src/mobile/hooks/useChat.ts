import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { useAuth } from "@/context/auth-context";
import { chatApi } from "@/api/chatApi";
import { filesApi } from "@/api/filesApi";
import { STREAM_HEALTH_KEY } from "@/hooks/useChatStream";
import {
  channelToPlain,
  messageToPlain,
  memberToPlain,
  threadInboxItemToPlain,
  categoryToPlain,
  approvalToPlain,
  type SerializedChannel,
  type SerializedMessage,
  type SerializedMember,
  type SerializedThreadInboxItem,
  type SerializedCategory,
  type SerializedPendingApproval,
} from "@/lib/chatSerializer";

const MESSAGE_POLL_MS = 3500;
const UNREAD_POLL_MS = 8000;
// While the event stream is healthy it patches these caches directly, so
// polling drops to a slow safety net instead of being the delivery mechanism.
const MESSAGE_POLL_STREAMING_MS = 20000;
const UNREAD_POLL_STREAMING_MS = 30000;

function isStreamHealthy(queryClient: QueryClient): boolean {
  return queryClient.getQueryData<boolean>(STREAM_HEALTH_KEY) === true;
}

type UnreadMap = Record<string, { unread: number; mentions: number }>;

/** The user's joined channels, merged with live unread counts. */
export function useChannels() {
  const { organizationId } = useAuth();

  const channelsQuery = useQuery({
    queryKey: ["chat", "channels", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const res = await chatApi.listChannels({
        organizationId: organizationId!,
        browsePublic: false,
      });
      return res.channels.map(channelToPlain);
    },
  });

  const unreadQuery = useUnreadCounts();

  const channels = useMemo<SerializedChannel[]>(() => {
    const list = channelsQuery.data ?? [];
    const unread = unreadQuery.data ?? {};
    return list
      .map((c) => ({
        ...c,
        unreadCount: unread[c.id]?.unread ?? 0,
        mentionCount: unread[c.id]?.mentions ?? 0,
      }))
      .sort((a, b) => b.lastMessageAtSeconds - a.lastMessageAtSeconds);
  }, [channelsQuery.data, unreadQuery.data]);

  return {
    channels,
    isLoading: channelsQuery.isLoading,
    isFetching: channelsQuery.isFetching,
    refetch: channelsQuery.refetch,
  };
}

/** Live unread/mention counts keyed by channel id. Shared cache across the chat UI. */
function useUnreadCounts() {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["chat", "unread", organizationId],
    enabled: !!organizationId,
    refetchInterval: () =>
      isStreamHealthy(queryClient) ? UNREAD_POLL_STREAMING_MS : UNREAD_POLL_MS,
    queryFn: async () => {
      const res = await chatApi.getUnreadCounts({ organizationId: organizationId! });
      const map: UnreadMap = {};
      for (const c of res.channels) {
        map[c.channelId] = { unread: c.unreadCount, mentions: c.mentionCount };
      }
      return map;
    },
  });
}

/** The user's named agent chats, merged with live unread counts. */
export function useAgentChats() {
  const { organizationId } = useAuth();
  const unreadQuery = useUnreadCounts();

  const agentChatsQuery = useQuery({
    queryKey: ["chat", "agentChats", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const res = await chatApi.listAgentChats({ organizationId: organizationId! });
      return res.channels.map(channelToPlain);
    },
  });

  const agentChats = useMemo<SerializedChannel[]>(() => {
    const list = agentChatsQuery.data ?? [];
    const unread = unreadQuery.data ?? {};
    return list
      .map((c) => ({
        ...c,
        unreadCount: unread[c.id]?.unread ?? 0,
        mentionCount: unread[c.id]?.mentions ?? 0,
      }))
      .sort((a, b) => b.lastMessageAtSeconds - a.lastMessageAtSeconds);
  }, [agentChatsQuery.data, unreadQuery.data]);

  return { agentChats, isLoading: agentChatsQuery.isLoading };
}

/** Threads the user follows or participates in, newest activity first. */
export function useThreadsInbox(enabled: boolean) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["chat", "threads", organizationId],
    enabled: enabled && !!organizationId,
    refetchInterval: () =>
      enabled
        ? isStreamHealthy(queryClient)
          ? MESSAGE_POLL_STREAMING_MS
          : MESSAGE_POLL_MS
        : false,
    queryFn: async () => {
      const res = await chatApi.getThreadsInbox({ organizationId: organizationId!, limit: 50 });
      const threads: SerializedThreadInboxItem[] = res.threads.map(threadInboxItemToPlain);
      return threads.sort((a, b) => b.lastReplyAtSeconds - a.lastReplyAtSeconds);
    },
  });
}

/** Sidebar categories for grouping channels. */
export function useCategories() {
  const { organizationId } = useAuth();
  return useQuery({
    queryKey: ["chat", "categories", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const res = await chatApi.listCategories({ organizationId: organizationId! });
      const categories: SerializedCategory[] = res.categories.map(categoryToPlain);
      return categories.sort((a, b) => a.position - b.position);
    },
  });
}

/** Public channels available to browse and join. */
export function useBrowseChannels(enabled: boolean) {
  const { organizationId } = useAuth();
  return useQuery({
    queryKey: ["chat", "browse", organizationId],
    enabled: enabled && !!organizationId,
    queryFn: async () => {
      const res = await chatApi.listChannels({
        organizationId: organizationId!,
        browsePublic: true,
      });
      return res.channels.map(channelToPlain);
    },
  });
}

export function useChannel(channelId: string | undefined) {
  const { organizationId } = useAuth();
  return useQuery({
    queryKey: ["chat", "channel", organizationId, channelId],
    enabled: !!organizationId && !!channelId,
    queryFn: async () => {
      const res = await chatApi.getChannel({
        organizationId: organizationId!,
        channelId: channelId!,
      });
      return res.channel ? channelToPlain(res.channel) : null;
    },
  });
}

const MESSAGE_PAGE_SIZE = 50;

/**
 * Channel root messages, newest-first for an inverted list. The newest page
 * polls on an interval (React Native's fetch cannot consume the ConnectRPC
 * server stream the web client uses); older pages accumulate separately via
 * loadOlder so the poll never re-fetches history.
 */
export function useMessages(channelId: string | undefined) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const key = ["chat", "messages", organizationId, channelId];

  const headHasMoreRef = useRef(false);
  const [olderMessages, setOlderMessages] = useState<SerializedMessage[]>([]);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [olderExhausted, setOlderExhausted] = useState(false);

  const headQuery = useQuery({
    queryKey: key,
    enabled: !!organizationId && !!channelId,
    refetchInterval: () =>
      isStreamHealthy(queryClient) ? MESSAGE_POLL_STREAMING_MS : MESSAGE_POLL_MS,
    queryFn: async () => {
      const res = await chatApi.getMessages({
        organizationId: organizationId!,
        channelId: channelId!,
        limit: MESSAGE_PAGE_SIZE,
        rootOnly: true,
      });
      headHasMoreRef.current = res.hasMore;
      const messages: SerializedMessage[] = res.messages.map(messageToPlain);
      await attachAttachments(organizationId!, messages);
      // Carry optimistic rows (in-flight and failed sends) across refetches;
      // the send mutation removes or flags them when it settles.
      const local = (queryClient.getQueryData<SerializedMessage[]>(key) ?? []).filter(
        (m) => m.metadata.optimistic === "1",
      );
      return [...local, ...messages].sort((a, b) => b.createdAtSeconds - a.createdAtSeconds);
    },
  });

  const data = useMemo(() => {
    const head = headQuery.data ?? [];
    if (olderMessages.length === 0) return head;
    const headIds = new Set(head.map((m) => m.id));
    return [...head, ...olderMessages.filter((m) => !headIds.has(m.id))];
  }, [headQuery.data, olderMessages]);

  const dataRef = useRef(data);
  dataRef.current = data;

  const loadOlder = useCallback(async () => {
    if (isLoadingOlder || olderExhausted || !organizationId || !channelId) return;
    const current = dataRef.current;
    const oldest = [...current].reverse().find((m) => m.metadata.optimistic !== "1");
    if (!oldest) return;
    if (current.length <= MESSAGE_PAGE_SIZE && !headHasMoreRef.current) return;
    setIsLoadingOlder(true);
    try {
      const res = await chatApi.getMessages({
        organizationId,
        channelId,
        limit: MESSAGE_PAGE_SIZE,
        rootOnly: true,
        beforeId: oldest.id,
      });
      const older: SerializedMessage[] = res.messages
        .map(messageToPlain)
        .sort((a, b) => b.createdAtSeconds - a.createdAtSeconds);
      await attachAttachments(organizationId, older);
      setOlderMessages((prev) => [...prev, ...older]);
      if (!res.hasMore) setOlderExhausted(true);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [isLoadingOlder, olderExhausted, organizationId, channelId]);

  return {
    data,
    isLoading: headQuery.isLoading,
    loadOlder,
    isLoadingOlder,
  };
}

/** Populate message.attachments in place with one batched RPC. Non-fatal on error. */
async function attachAttachments(organizationId: string, messages: SerializedMessage[]) {
  if (messages.length === 0) return;
  try {
    const batch = await filesApi.batchListAttachments({
      organizationId,
      contentType: ContentType.CHAT_MESSAGE,
      contentIds: messages.map((m) => m.id),
    });
    const byId = new Map<string, SerializedMessage["attachments"]>();
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
    for (const m of messages) {
      const attachments = byId.get(m.id);
      if (attachments) m.attachments = attachments;
    }
  } catch {
    // Messages render without attachment metadata.
  }
}

export function useChannelMembers(channelId: string | undefined) {
  const { organizationId } = useAuth();
  return useQuery({
    queryKey: ["chat", "members", organizationId, channelId],
    enabled: !!organizationId && !!channelId,
    queryFn: async () => {
      const res = await chatApi.getMembers({
        organizationId: organizationId!,
        channelId: channelId!,
      });
      const members: SerializedMember[] = res.members.map(memberToPlain);
      return members;
    },
  });
}

/** Thread root + reply metadata. */
export function useThread(channelId: string | undefined, rootMessageId: string | undefined) {
  const { organizationId } = useAuth();
  return useQuery({
    queryKey: ["chat", "thread", organizationId, channelId, rootMessageId],
    enabled: !!organizationId && !!channelId && !!rootMessageId,
    queryFn: async () => {
      const res = await chatApi.getThread({
        organizationId: organizationId!,
        channelId: channelId!,
        rootMessageId: rootMessageId!,
      });
      return {
        rootMessage: res.rootMessage ? messageToPlain(res.rootMessage) : null,
        replyCount: res.replyCount,
        totalParticipants: res.totalParticipants,
      };
    },
  });
}

/** Thread replies, newest-first for an inverted list. Polls like the channel. */
export function useThreadMessages(
  channelId: string | undefined,
  rootMessageId: string | undefined,
) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["chat", "threadMessages", organizationId, channelId, rootMessageId],
    enabled: !!organizationId && !!channelId && !!rootMessageId,
    refetchInterval: () =>
      isStreamHealthy(queryClient) ? MESSAGE_POLL_STREAMING_MS : MESSAGE_POLL_MS,
    queryFn: async () => {
      const res = await chatApi.getThreadMessages({
        organizationId: organizationId!,
        channelId: channelId!,
        rootMessageId: rootMessageId!,
        limit: 100,
      });
      const messages: SerializedMessage[] = res.messages.map(messageToPlain);
      await attachAttachments(organizationId!, messages);
      return messages.sort((a, b) => b.createdAtSeconds - a.createdAtSeconds);
    },
  });
}

/** Pinned messages for a channel, newest pin first. */
export function usePinnedMessages(channelId: string | undefined, enabled: boolean) {
  const { organizationId } = useAuth();
  return useQuery({
    queryKey: ["chat", "pinned", organizationId, channelId],
    enabled: enabled && !!organizationId && !!channelId,
    queryFn: async () => {
      const res = await chatApi.getPinnedMessages({
        organizationId: organizationId!,
        channelId: channelId!,
      });
      const messages: SerializedMessage[] = res.messages.map(messageToPlain);
      return messages.sort((a, b) => b.createdAtSeconds - a.createdAtSeconds);
    },
  });
}

/**
 * Destructive-tool approvals still awaiting a decision in this channel.
 * Approval requests live in Valkey (not the message history), so this poll is
 * the fallback delivery path; the stream invalidates the key for instant
 * updates when connected.
 */
export function useChannelPendingApprovals(channelId: string | undefined, enabled: boolean) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: ["chat", "approvals", organizationId, channelId],
    enabled: enabled && !!organizationId && !!channelId,
    refetchInterval: () => (isStreamHealthy(queryClient) ? false : UNREAD_POLL_MS),
    queryFn: async () => {
      const res = await chatApi.getChannelPendingApprovals({
        organizationId: organizationId!,
        channelId: channelId!,
      });
      const approvals: SerializedPendingApproval[] = res.approvals.map(approvalToPlain);
      return approvals.sort((a, b) => a.requestedAtSeconds - b.requestedAtSeconds);
    },
  });
}
