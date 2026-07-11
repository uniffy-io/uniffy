import { useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChannelAgentContextStats } from "@uniffy/proto/chat/v1/chat_pb";
import { useAuth } from "@/context/auth-context";
import { chatApi } from "@/api/chatApi";
import { useRunningAgents } from "@/hooks/useChatStream";
import { messagesKey } from "@/hooks/useChatMutations";

export interface SerializedContextStats {
  totalMessages: number;
  activeMessages: number;
  compactedMessages: number;
  summaryCount: number;
  activeTokens: number;
  tokenBudget: number;
  tokensUntilCompaction: number;
  contextWindowTokens: number;
  wasReset: boolean;
  lastInputTokens: number;
  lastOutputTokens: number;
  lastCacheReadTokens: number;
  /** 0-100 share of the chat-history token budget currently in use. */
  usedPercent: number;
}

function statsToPlain(proto: ChannelAgentContextStats): SerializedContextStats {
  const usedPercent =
    proto.tokenBudget > 0
      ? Math.min(100, Math.round((proto.activeTokens / proto.tokenBudget) * 100))
      : 0;
  return {
    totalMessages: proto.totalMessages,
    activeMessages: proto.activeMessages,
    compactedMessages: proto.compactedMessages,
    summaryCount: proto.summaryCount,
    activeTokens: proto.activeTokens,
    tokenBudget: proto.tokenBudget,
    tokensUntilCompaction: proto.tokensUntilCompaction,
    contextWindowTokens: proto.contextWindowTokens,
    wasReset: proto.wasReset,
    lastInputTokens: proto.lastInputTokens,
    lastOutputTokens: proto.lastOutputTokens,
    lastCacheReadTokens: proto.lastCacheReadTokens,
    usedPercent,
  };
}

export function contextStatsKey(orgId: string | null, channelId: string, agentId: string) {
  return ["chat", "agentContext", orgId, channelId, agentId];
}

/**
 * Token/context stats for one agent in one channel. Refetches when an agent
 * run in the channel ends, since every turn moves the token counters.
 */
export function useChannelAgentContext(channelId: string, agentId: string, enabled: boolean) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();
  const runningAgents = useRunningAgents(channelId);
  const isRunning = (runningAgents ?? []).includes(agentId);
  const wasRunningRef = useRef(isRunning);

  useEffect(() => {
    if (wasRunningRef.current && !isRunning) {
      void queryClient.invalidateQueries({
        queryKey: contextStatsKey(organizationId, channelId, agentId),
      });
    }
    wasRunningRef.current = isRunning;
  }, [isRunning, queryClient, organizationId, channelId, agentId]);

  return useQuery({
    queryKey: contextStatsKey(organizationId, channelId, agentId),
    enabled: enabled && !!organizationId && !!channelId && !!agentId,
    refetchOnMount: "always",
    queryFn: async () => {
      const res = await chatApi.getChannelAgentContextStats({
        organizationId: organizationId!,
        channelId,
        agentId,
      });
      return res.stats ? statsToPlain(res.stats) : null;
    },
  });
}

export function useCompactAgentContext(channelId: string, agentId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      chatApi.compactChannelAgentContext({
        organizationId: organizationId!,
        channelId,
        agentId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contextStatsKey(organizationId, channelId, agentId),
      });
      // Compaction writes a kind="summary" row into the channel.
      queryClient.invalidateQueries({ queryKey: messagesKey(organizationId, channelId) });
    },
  });
}

export function useResetAgentContext(channelId: string, agentId: string) {
  const { organizationId } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      chatApi.resetChannelAgentContext({
        organizationId: organizationId!,
        channelId,
        agentId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: contextStatsKey(organizationId, channelId, agentId),
      });
      // Reset writes a kind="context_reset" divider into the channel.
      queryClient.invalidateQueries({ queryKey: messagesKey(organizationId, channelId) });
    },
  });
}
