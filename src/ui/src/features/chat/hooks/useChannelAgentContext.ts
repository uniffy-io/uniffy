/**
 * useChannelAgentContext - polled stats + actions for one (channel, agent).
 *
 * Mirrors the agents-builder ChatView meter (`features/agents/components/views/
 * ChatView.tsx::945-1029`) but talks to `chat.v1.ChatService.GetChannelAgentContextStats`
 * instead of the sessions surface. Auto-refreshes when the agent stops
 * typing (the typing entry transitions from present -> absent in
 * `chatMessages.typingByChannel`), which lines up with the
 * `AGENT_TYPING started=false` event the bridge emits at end-of-turn.
 *
 * Two siblings:
 *   - `useChannelAgentContextBatch(channelId, agentIds)` fans N agents into
 *     ONE `GetChannelAgentContextStatsBatch` call for the channel-agents
 *     popover. Coalesces typing-stop refreshes across the whole agent list
 *     into a single debounced batch fetch.
 *   - `useChannelAgentContextActions(channelId, agentId)` exposes only
 *     `compact` / `reset` (no auto-fetch) for callers that already own the
 *     stats source - i.e. the popover bar fed from the batch hook.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppSelector } from '@/app/hooks';
import { chatApi } from '@/features/chat/api/chatApi';
import { friendlyErrorMessage } from '@/config';
import { toast } from 'sonner';

export interface ChannelAgentContextStats {
    totalMessages: number;
    activeMessages: number;
    compactedMessages: number;
    summaryCount: number;
    activeTokens: number;
    tokenBudget: number;
    tokensUntilCompaction: number;
    contextWindowTokens: number;
    wasReset: boolean;
    manualResetAtMs: number | null;
}

export interface CompactResult {
    compacted: boolean;
    messagesCompacted: number;
    tokensSaved: number;
    stats: ChannelAgentContextStats;
}

export interface ResetResult {
    dividerMessageId: string;
    resetAtMs: number;
    stats: ChannelAgentContextStats;
}

interface UseChannelAgentContextResult {
    stats: ChannelAgentContextStats | null;
    isLoading: boolean;
    isCompacting: boolean;
    isResetting: boolean;
    refresh: () => Promise<void>;
    compact: () => Promise<CompactResult | null>;
    reset: () => Promise<ResetResult | null>;
}

interface UseChannelAgentContextBatchResult {
    statsByAgentId: Record<string, ChannelAgentContextStats | null>;
    isLoading: boolean;
    refresh: () => Promise<void>;
}

interface UseChannelAgentContextActionsResult {
    isCompacting: boolean;
    isResetting: boolean;
    compact: () => Promise<CompactResult | null>;
    reset: () => Promise<ResetResult | null>;
}

const TYPING_STOP_REFRESH_DEBOUNCE_MS = 300;
const SORTED_IDS_SEP = '\u0000';

function statsFromProto(proto: {
    totalMessages: number;
    activeMessages: number;
    compactedMessages: number;
    summaryCount: number;
    activeTokens: number;
    tokenBudget: number;
    tokensUntilCompaction: number;
    contextWindowTokens: number;
    wasReset: boolean;
    manualResetAt?: { seconds: bigint; nanos: number };
}): ChannelAgentContextStats {
    const ts = proto.manualResetAt;
    return {
        totalMessages: proto.totalMessages,
        activeMessages: proto.activeMessages,
        compactedMessages: proto.compactedMessages,
        summaryCount: proto.summaryCount,
        activeTokens: proto.activeTokens,
        tokenBudget: proto.tokenBudget,
        tokensUntilCompaction: proto.tokensUntilCompaction,
        contextWindowTokens: proto.contextWindowTokens || 200_000,
        wasReset: proto.wasReset,
        manualResetAtMs: ts ? Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000) : null,
    };
}

export function useChannelAgentContext(
    channelId: string | undefined,
    agentId: string | undefined,
): UseChannelAgentContextResult {
    const organizationId = useAppSelector((s) => s.auth.currentOrganizationId ?? '');
    const typingByChannel = useAppSelector((s) => s.chatMessages.typingByChannel);
    const [stats, setStats] = useState<ChannelAgentContextStats | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isCompacting, setIsCompacting] = useState(false);
    const [isResetting, setIsResetting] = useState(false);
    const wasAgentTypingRef = useRef(false);

    const refresh = useCallback(async (): Promise<void> => {
        if (!channelId || !agentId || !organizationId) return;
        setIsLoading(true);
        try {
            const response = await chatApi.getChannelAgentContextStats({
                organizationId,
                channelId,
                agentId,
            });
            if (response.stats) {
                setStats(statsFromProto(response.stats));
            }
        } catch (error) {
            const friendly = friendlyErrorMessage(
                error instanceof Error ? error.message : String(error),
            );
            if (friendly) toast.error(friendly);
        } finally {
            setIsLoading(false);
        }
    }, [channelId, agentId, organizationId]);

    const compact = useCallback(async (): Promise<CompactResult | null> => {
        if (!channelId || !agentId || !organizationId) return null;
        setIsCompacting(true);
        try {
            const response = await chatApi.compactChannelAgentContext({
                organizationId,
                channelId,
                agentId,
            });
            const fresh = response.stats ? statsFromProto(response.stats) : null;
            if (fresh) setStats(fresh);
            return {
                compacted: response.compacted,
                messagesCompacted: response.messagesCompacted,
                tokensSaved: response.tokensSaved,
                stats: fresh ?? stats!,
            };
        } catch (error) {
            const friendly = friendlyErrorMessage(
                error instanceof Error ? error.message : String(error),
            );
            if (friendly) toast.error(friendly);
            return null;
        } finally {
            setIsCompacting(false);
        }
    }, [channelId, agentId, organizationId, stats]);

    const reset = useCallback(async (): Promise<ResetResult | null> => {
        if (!channelId || !agentId || !organizationId) return null;
        setIsResetting(true);
        try {
            const response = await chatApi.resetChannelAgentContext({
                organizationId,
                channelId,
                agentId,
            });
            const fresh = response.stats ? statsFromProto(response.stats) : null;
            if (fresh) setStats(fresh);
            const ts = response.resetAt;
            const resetAtMs = ts
                ? Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000)
                : Date.now();
            return {
                dividerMessageId: response.dividerMessageId,
                resetAtMs,
                stats: fresh ?? stats!,
            };
        } catch (error) {
            const friendly = friendlyErrorMessage(
                error instanceof Error ? error.message : String(error),
            );
            if (friendly) toast.error(friendly);
            return null;
        } finally {
            setIsResetting(false);
        }
    }, [channelId, agentId, organizationId, stats]);

    useEffect(() => {
        // Reset transient state when scope changes; refresh kicks in below.
        setStats(null);
        wasAgentTypingRef.current = false;
        if (!channelId || !agentId) return;
        void refresh();
    }, [channelId, agentId, refresh]);

    useEffect(() => {
        if (!channelId || !agentId) return;
        const entries = typingByChannel[channelId] ?? [];
        const isAgentTyping = entries.some((e) => e.isAgent && e.userId === agentId);
        if (wasAgentTypingRef.current && !isAgentTyping) {
            void refresh();
        }
        wasAgentTypingRef.current = isAgentTyping;
    }, [channelId, agentId, typingByChannel, refresh]);

    return {
        stats,
        isLoading,
        isCompacting,
        isResetting,
        refresh,
        compact,
        reset,
    };
}

/**
 * Batched per-agent context stats for one channel.
 *
 * Coalesces N parallel single-agent fetches into ONE
 * `GetChannelAgentContextStatsBatch` call. Membership is keyed on the sorted
 * agent-id list so a stable list re-using the hook does not re-fire fetches
 * across renders. Typing-stop refresh is debounced across ALL agents in
 * `agentIds`, so a flurry of end-of-turn `AGENT_TYPING started=false`
 * events collapses into a single batch round-trip.
 *
 * Returns `null` for any agent the batch endpoint omits (not bound to the
 * channel, soft-deleted, unreadable). The batch endpoint intentionally does
 * not auto-create bindings - callers that need first-call binding creation
 * (e.g. the single-agent DM bar) keep using `useChannelAgentContext`.
 */
export function useChannelAgentContextBatch(
    channelId: string | undefined,
    agentIds: string[],
): UseChannelAgentContextBatchResult {
    const organizationId = useAppSelector((s) => s.auth.currentOrganizationId ?? '');
    const typingByChannel = useAppSelector((s) => s.chatMessages.typingByChannel);

    const sortedIdsKey = useMemo(
        () => [...agentIds].sort().join(SORTED_IDS_SEP),
        [agentIds],
    );

    const [statsByAgentId, setStatsByAgentId] = useState<
        Record<string, ChannelAgentContextStats | null>
    >({});
    const [isLoading, setIsLoading] = useState(false);

    const refresh = useCallback(async (): Promise<void> => {
        if (!channelId || !organizationId || !sortedIdsKey) {
            setStatsByAgentId({});
            return;
        }
        const ids = sortedIdsKey.split(SORTED_IDS_SEP);
        setIsLoading(true);
        try {
            const response = await chatApi.getChannelAgentContextStatsBatch({
                organizationId,
                channelId,
                agentIds: ids,
            });
            const next: Record<string, ChannelAgentContextStats | null> = {};
            for (const id of ids) {
                const proto = response.stats[id];
                next[id] = proto ? statsFromProto(proto) : null;
            }
            setStatsByAgentId(next);
        } catch (error) {
            console.error('useChannelAgentContextBatch refresh failed', error);
            const next: Record<string, ChannelAgentContextStats | null> = {};
            for (const id of sortedIdsKey.split(SORTED_IDS_SEP)) next[id] = null;
            setStatsByAgentId(next);
        } finally {
            setIsLoading(false);
        }
    }, [channelId, organizationId, sortedIdsKey]);

    useEffect(() => {
        setStatsByAgentId({});
        if (!channelId || !sortedIdsKey) return;
        void refresh();
    }, [channelId, sortedIdsKey, refresh]);

    const prevTypingAgentsRef = useRef<Set<string>>(new Set());
    const debounceTimerRef = useRef<number | null>(null);

    useEffect(() => {
        if (!channelId || !sortedIdsKey) {
            prevTypingAgentsRef.current = new Set();
            return;
        }
        const tracked = new Set(sortedIdsKey.split(SORTED_IDS_SEP));
        const entries = typingByChannel[channelId] ?? [];
        const currentlyTyping = new Set(
            entries.filter((e) => e.isAgent && tracked.has(e.userId)).map((e) => e.userId),
        );
        let anyStopped = false;
        for (const id of prevTypingAgentsRef.current) {
            if (!currentlyTyping.has(id)) {
                anyStopped = true;
                break;
            }
        }
        prevTypingAgentsRef.current = currentlyTyping;
        if (!anyStopped) return;
        if (debounceTimerRef.current !== null) {
            window.clearTimeout(debounceTimerRef.current);
        }
        debounceTimerRef.current = window.setTimeout(() => {
            debounceTimerRef.current = null;
            void refresh();
        }, TYPING_STOP_REFRESH_DEBOUNCE_MS);
    }, [channelId, sortedIdsKey, typingByChannel, refresh]);

    useEffect(() => {
        return () => {
            if (debounceTimerRef.current !== null) {
                window.clearTimeout(debounceTimerRef.current);
            }
        };
    }, []);

    return { statsByAgentId, isLoading, refresh };
}

/**
 * Compact + reset actions only - no auto-fetch, no stats state.
 *
 * For callers that already own the stats source (e.g. the channel-agents
 * popover bar fed by `useChannelAgentContextBatch`) and only need the
 * mutation surface. Mirrors the toast-on-error behaviour of
 * `useChannelAgentContext` so failed mutations still surface a friendly
 * error message to the user.
 */
export function useChannelAgentContextActions(
    channelId: string | undefined,
    agentId: string | undefined,
): UseChannelAgentContextActionsResult {
    const organizationId = useAppSelector((s) => s.auth.currentOrganizationId ?? '');
    const [isCompacting, setIsCompacting] = useState(false);
    const [isResetting, setIsResetting] = useState(false);

    const compact = useCallback(async (): Promise<CompactResult | null> => {
        if (!channelId || !agentId || !organizationId) return null;
        setIsCompacting(true);
        try {
            const response = await chatApi.compactChannelAgentContext({
                organizationId,
                channelId,
                agentId,
            });
            const fresh = response.stats ? statsFromProto(response.stats) : null;
            return {
                compacted: response.compacted,
                messagesCompacted: response.messagesCompacted,
                tokensSaved: response.tokensSaved,
                stats: fresh as ChannelAgentContextStats,
            };
        } catch (error) {
            const friendly = friendlyErrorMessage(
                error instanceof Error ? error.message : String(error),
            );
            if (friendly) toast.error(friendly);
            return null;
        } finally {
            setIsCompacting(false);
        }
    }, [channelId, agentId, organizationId]);

    const reset = useCallback(async (): Promise<ResetResult | null> => {
        if (!channelId || !agentId || !organizationId) return null;
        setIsResetting(true);
        try {
            const response = await chatApi.resetChannelAgentContext({
                organizationId,
                channelId,
                agentId,
            });
            const fresh = response.stats ? statsFromProto(response.stats) : null;
            const ts = response.resetAt;
            const resetAtMs = ts
                ? Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000)
                : Date.now();
            return {
                dividerMessageId: response.dividerMessageId,
                resetAtMs,
                stats: fresh as ChannelAgentContextStats,
            };
        } catch (error) {
            const friendly = friendlyErrorMessage(
                error instanceof Error ? error.message : String(error),
            );
            if (friendly) toast.error(friendly);
            return null;
        } finally {
            setIsResetting(false);
        }
    }, [channelId, agentId, organizationId]);

    return { isCompacting, isResetting, compact, reset };
}
