/**
 * AgentContextBar - per-(channel, agent) context meter + controls.
 *
 * Two variants: `full` (DM header sub-bar, sized to the header) and
 * `compact` (popover / inline row in the group-channel Members tab, tighter
 * padding and fewer breakdown chips). `canMutate=false` hides Compact and
 * the overflow menu, so non-admins in group channels see the meter only
 * while the backend permission checker still enforces the real gate.
 *
 * Two render modes:
 *   - Standalone (default; DM header, single-agent surfaces). Mounts
 *     `useChannelAgentContext` and owns its own stats fetch + typing-stop
 *     refresh.
 *   - Batched (`stats` prop provided; channel-agents popover). Renders from
 *     prop stats supplied by `useChannelAgentContextBatch` mounted by the
 *     popover, and uses `useChannelAgentContextActions` for compact/reset.
 *     `onAfterAction` is called after a successful action so the parent
 *     can re-issue the batched fetch.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowsClockwise, DotsThree, Trash } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
    useChannelAgentContext,
    useChannelAgentContextActions,
    type ChannelAgentContextStats,
    type CompactResult,
    type ResetResult,
} from '@/features/chat/hooks/useChannelAgentContext';
import { cn } from '@/shared/utils/cn';
import { toast } from 'sonner';

interface AgentContextBarProps {
    channelId: string;
    agentId: string;
    agentName: string;
    variant?: 'full' | 'compact';
    canMutate?: boolean;
    /**
     * When set (including `null`), the bar renders from these stats and
     * skips its internal per-agent fetch. Used by `ChannelAgentsPopover`
     * which fans N agents into one batched fetch. Pass `null` while the
     * batch is loading or returned no entry for this agent. When
     * undefined, the bar mounts `useChannelAgentContext` itself.
     */
    stats?: ChannelAgentContextStats | null;
    /**
     * Called after a successful compact or reset in batched mode so the
     * parent can re-issue the batched fetch. Ignored in standalone mode.
     */
    onAfterAction?: () => void;
}

function formatTokenCount(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
    return String(tokens);
}

export function AgentContextBar(props: AgentContextBarProps) {
    if (props.stats !== undefined) {
        return <AgentContextBarBatched {...props} stats={props.stats} />;
    }
    return <AgentContextBarStandalone {...props} />;
}

function AgentContextBarStandalone({
    channelId,
    agentId,
    agentName,
    variant = 'full',
    canMutate = true,
}: AgentContextBarProps) {
    const { stats, isCompacting, isResetting, compact, reset } = useChannelAgentContext(
        channelId,
        agentId,
    );
    return (
        <AgentContextBarBody
            stats={stats}
            agentName={agentName}
            variant={variant}
            canMutate={canMutate}
            isCompacting={isCompacting}
            isResetting={isResetting}
            compact={compact}
            reset={reset}
        />
    );
}

function AgentContextBarBatched({
    channelId,
    agentId,
    agentName,
    variant = 'full',
    canMutate = true,
    stats,
    onAfterAction,
}: AgentContextBarProps & { stats: ChannelAgentContextStats | null }) {
    const {
        isCompacting,
        isResetting,
        compact: rawCompact,
        reset: rawReset,
    } = useChannelAgentContextActions(channelId, agentId);

    const compact = useCallback(async (): Promise<CompactResult | null> => {
        const result = await rawCompact();
        if (result) onAfterAction?.();
        return result;
    }, [rawCompact, onAfterAction]);

    const reset = useCallback(async (): Promise<ResetResult | null> => {
        const result = await rawReset();
        if (result) onAfterAction?.();
        return result;
    }, [rawReset, onAfterAction]);

    return (
        <AgentContextBarBody
            stats={stats}
            agentName={agentName}
            variant={variant}
            canMutate={canMutate}
            isCompacting={isCompacting}
            isResetting={isResetting}
            compact={compact}
            reset={reset}
        />
    );
}

interface AgentContextBarBodyProps {
    stats: ChannelAgentContextStats | null;
    agentName: string;
    variant: 'full' | 'compact';
    canMutate: boolean;
    isCompacting: boolean;
    isResetting: boolean;
    compact: () => Promise<CompactResult | null>;
    reset: () => Promise<ResetResult | null>;
}

function AgentContextBarBody({
    stats,
    agentName,
    variant,
    canMutate,
    isCompacting,
    isResetting,
    compact,
    reset,
}: AgentContextBarBodyProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [confirmResetOpen, setConfirmResetOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const isCompact = variant === 'compact';

    useEffect(() => {
        if (!menuOpen) return;
        const handler = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [menuOpen]);

    if (!stats) {
        return (
            <div
                className={cn(
                    'space-y-2',
                    isCompact
                        ? 'px-3 py-2'
                        : 'px-4 py-2.5 border-b border-border bg-muted/30',
                )}
                aria-busy="true"
                data-testid="chat-agent-context-bar"
                data-state="loading"
                data-variant={variant}
            >
                <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                        <div className="h-full w-1/3 rounded-full bg-muted-foreground/20 animate-pulse" />
                    </div>
                    <span className="text-xs tabular-nums font-medium text-muted-foreground/60">
                        ...
                    </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground/70">
                    <ArrowsClockwise size={12} className="animate-spin" />
                    <span>Loading context stats...</span>
                </div>
            </div>
        );
    }

    if (stats.contextWindowTokens === 0) {
        return (
            <div
                className={cn(
                    isCompact
                        ? 'px-3 py-2'
                        : 'px-4 py-2.5 border-b border-border bg-muted/30',
                )}
                data-testid="chat-agent-context-bar"
                data-state="no-model"
                data-variant={variant}
            >
                <p className="text-xs text-muted-foreground">
                    No model configured for this agent yet.
                </p>
            </div>
        );
    }

    const usagePercent = Math.min(
        100,
        Math.round((stats.activeTokens / Math.max(stats.tokenBudget, 1)) * 100),
    );
    const barColor =
        usagePercent >= 80
            ? 'bg-red-500 dark:bg-red-400'
            : usagePercent >= 50
                ? 'bg-yellow-500 dark:bg-yellow-400'
                : 'bg-emerald-500 dark:bg-emerald-400';
    const percentColor =
        usagePercent >= 80
            ? 'text-red-600 dark:text-red-400'
            : usagePercent >= 50
                ? 'text-yellow-600 dark:text-yellow-400'
                : 'text-muted-foreground';

    const targetTokens = Math.round(stats.contextWindowTokens * 0.4);
    const freeableTokens = Math.max(0, stats.activeTokens - targetTokens);
    const canCompact = stats.activeMessages > 5;

    const handleCompact = async () => {
        const result = await compact();
        if (result?.compacted) {
            toast.success(
                `Compacted ${result.messagesCompacted} messages, saved ~${formatTokenCount(result.tokensSaved)} tokens`,
            );
        } else if (result && !result.compacted) {
            toast.info('Nothing to compact yet');
        }
    };

    const handleReset = async () => {
        const result = await reset();
        if (result) {
            toast.success(`Conversation with ${agentName} reset`);
        }
        setConfirmResetOpen(false);
    };

    return (
        <div
            className={cn(
                'space-y-2',
                isCompact
                    ? 'px-3 py-2'
                    : 'px-4 py-2.5 border-b border-border bg-muted/30',
            )}
            data-testid="chat-agent-context-bar"
            data-state="ready"
            data-variant={variant}
            data-usage-percent={usagePercent}
        >
            {/* Progress bar */}
            <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                        className={cn('h-full rounded-full transition-all duration-300', barColor)}
                        style={{ width: `${usagePercent}%` }}
                        data-testid="chat-agent-context-progress"
                    />
                </div>
                <span
                    className={cn('text-xs tabular-nums font-medium', percentColor)}
                    data-testid="chat-agent-context-percent"
                >
                    {usagePercent}%
                </span>
            </div>

            {/* Stats breakdown */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                <span>
                    Active: <span className="font-medium text-foreground">{formatTokenCount(stats.activeTokens)}</span> tokens ({stats.activeMessages} msgs)
                </span>
                {stats.summaryCount > 0 && (
                    <span>
                        Summaries: <span className="font-medium text-foreground">{stats.summaryCount}</span>
                    </span>
                )}
                {stats.compactedMessages > 0 && (
                    <span>
                        Compacted: <span className="font-medium text-foreground">{stats.compactedMessages}</span> msgs
                    </span>
                )}
                {!isCompact && (
                    <>
                        <span>
                            Window: <span className="font-medium text-foreground">{formatTokenCount(stats.contextWindowTokens)}</span>
                        </span>
                        <span>
                            Budget: <span className="font-medium text-foreground">{formatTokenCount(stats.tokenBudget)}</span> (65%)
                        </span>
                    </>
                )}
            </div>

            {/* Action row (admins only) */}
            {canMutate && (
                <div className="flex items-center gap-2 flex-wrap">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCompact}
                        disabled={isCompacting || !canCompact}
                        className="h-6 px-2.5 text-xs gap-1.5"
                        data-testid="chat-agent-context-compact-button"
                    >
                        <ArrowsClockwise size={12} className={cn(isCompacting && 'animate-spin')} />
                        {!canCompact
                            ? 'Nothing to compact'
                            : freeableTokens > 0
                                ? `Compact (~${formatTokenCount(freeableTokens)} freeable)`
                                : 'Force compact'}
                    </Button>
                    {isCompact ? (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setConfirmResetOpen(true)}
                            disabled={isResetting}
                            className="h-6 px-2.5 text-xs gap-1.5"
                            data-testid="chat-agent-context-reset-button"
                        >
                            <Trash size={12} />
                            Reset
                        </Button>
                    ) : null}
                    {stats.tokensUntilCompaction > 0 ? (
                        <span className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">{formatTokenCount(stats.tokensUntilCompaction)}</span> until auto-compaction
                        </span>
                    ) : (
                        <span className="text-xs text-yellow-600 dark:text-yellow-400">
                            Auto-compaction will trigger on next message
                        </span>
                    )}

                    {!isCompact && (
                        <>
                            <div className="flex-1" />
                            <div className="relative" ref={menuRef}>
                                <button
                                    type="button"
                                    onClick={() => setMenuOpen((open) => !open)}
                                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                    aria-label="Context options"
                                    data-testid="chat-agent-context-menu-button"
                                    data-state={menuOpen ? 'open' : 'closed'}
                                >
                                    <DotsThree size={16} weight="bold" />
                                </button>
                                {menuOpen && (
                                    <div
                                        className="absolute right-0 top-full mt-1 z-20 min-w-[200px] bg-card border border-border rounded-md shadow-lg py-1"
                                        data-testid="chat-agent-context-menu"
                                    >
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setMenuOpen(false);
                                                setConfirmResetOpen(true);
                                            }}
                                            disabled={isResetting}
                                            className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                                            data-testid="chat-agent-context-menu-reset"
                                        >
                                            <Trash size={14} className="text-muted-foreground" />
                                            <span>Reset conversation</span>
                                        </button>
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}
            {!canMutate && stats.tokensUntilCompaction > 0 && (
                <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{formatTokenCount(stats.tokensUntilCompaction)}</span> until auto-compaction
                </div>
            )}

            <ConfirmDialog
                isOpen={confirmResetOpen}
                onClose={() => setConfirmResetOpen(false)}
                onConfirm={handleReset}
                title="Reset conversation"
                message={
                    <>
                        <p>
                            This will hide all messages from <strong>{agentName}</strong>'s memory of
                            this conversation. Future replies start from a clean slate.
                        </p>
                        <p className="mt-2">
                            Your message history stays visible -- a divider will appear marking the
                            reset point. This affects only this agent's view of the channel.
                        </p>
                    </>
                }
                confirmLabel="Reset conversation"
                variant="warning"
                loading={isResetting}
            />
        </div>
    );
}
