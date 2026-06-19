import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/auth-context";
import { chatApi } from "@/api/chatApi";
import {
  channelToPlain,
  messageToPlain,
  memberToPlain,
  threadInboxItemToPlain,
  categoryToPlain,
  type SerializedChannel,
  type SerializedMessage,
  type SerializedMember,
  type SerializedThreadInboxItem,
  type SerializedCategory,
} from "@/lib/chatSerializer";

const MESSAGE_POLL_MS = 3500;
const UNREAD_POLL_MS = 8000;

type UnreadMap = Record<string, { unread: number; mentions: number }>;

/** The user's joined channels, merged with live unread counts. */
export function useChannels() {
  const { organizationId } = useAuth();

  const channelsQuery = useQuery({
    queryKey: ["chat", "channels", organizationId],
    enabled: !!organizationId,
    queryFn: async () => {
      const res = await chatApi.listChannels({ organizationId: organizationId!, browsePublic: false });
      return res.channels.map(channelToPlain);
    },
  });

  const unreadQuery = useQuery({
    queryKey: ["chat", "unread", organizationId],
    enabled: !!organizationId,
    refetchInterval: UNREAD_POLL_MS,
    queryFn: async () => {
      const res = await chatApi.getUnreadCounts({ organizationId: organizationId! });
      const map: Record<string, { unread: number; mentions: number }> = {};
      for (const c of res.channels) {
        map[c.channelId] = { unread: c.unreadCount, mentions: c.mentionCount };
      }
      return map;
    },
  });

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
  return useQuery({
    queryKey: ["chat", "unread", organizationId],
    enabled: !!organizationId,
    refetchInterval: UNREAD_POLL_MS,
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
  return useQuery({
    queryKey: ["chat", "threads", organizationId],
    enabled: enabled && !!organizationId,
    refetchInterval: enabled ? MESSAGE_POLL_MS : false,
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
      const res = await chatApi.listChannels({ organizationId: organizationId!, browsePublic: true });
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
      const res = await chatApi.getChannel({ organizationId: organizationId!, channelId: channelId! });
      return res.channel ? channelToPlain(res.channel) : null;
    },
  });
}

/**
 * Channel root messages, newest-first for an inverted list. Polled on an
 * interval since React Native's fetch cannot consume the ConnectRPC server
 * stream the web client uses.
 */
export function useMessages(channelId: string | undefined) {
  const { organizationId } = useAuth();
  return useQuery({
    queryKey: ["chat", "messages", organizationId, channelId],
    enabled: !!organizationId && !!channelId,
    refetchInterval: MESSAGE_POLL_MS,
    queryFn: async () => {
      const res = await chatApi.getMessages({
        organizationId: organizationId!,
        channelId: channelId!,
        limit: 50,
        rootOnly: true,
      });
      const messages: SerializedMessage[] = res.messages.map(messageToPlain);
      return messages.sort((a, b) => b.createdAtSeconds - a.createdAtSeconds);
    },
  });
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
