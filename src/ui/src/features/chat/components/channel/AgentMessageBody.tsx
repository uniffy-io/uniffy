/** Renders an agent-authored ChatMessage by dispatching on `metadata.kind`. */

import { useState } from 'react';
import { Wrench, CheckCircle, XCircle, FileText, ArrowsClockwise, Warning, Check, X, ArrowClockwise, CaretDown, CaretUp } from '@phosphor-icons/react';
import { StreamingMessage } from '@/features/chat/components/channel/StreamingMessage';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/utils/cn';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { respondToAgentConfirmation } from '@/features/chat/store/chatThunks';
import type { ChatMessage } from '@/features/chat/types';

interface AgentMessageBodyProps {
    message: ChatMessage;
}

function readString(metadata: Record<string, unknown>, key: string): string | undefined {
    const value = metadata[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Read a metadata flag uniformly: proto wire delivers `"true"` strings, appendDelta sets a JS boolean. */
function readBoolean(metadata: Record<string, unknown>, key: string): boolean {
    const value = metadata[key];
    if (value === true) return true;
    if (typeof value === 'string') {
        return value === 'true' || value === 'True';
    }
    return false;
}

function humanizeToolName(toolName: string): string {
    const [, action] = toolName.split('.', 2);
    const verb = (action ?? toolName).replace(/_/g, ' ');
    return verb.charAt(0).toUpperCase() + verb.slice(1);
}

export function AgentMessageBody({ message }: AgentMessageBodyProps) {
    const kind = readString(message.metadata, 'kind') ?? 'final';

    switch (kind) {
        case 'tool_call':
            return <ToolCallCard message={message} />;
        case 'tool_result':
            return <ToolResultCard message={message} />;
        case 'summary':
            return <SummaryRow message={message} />;
        case 'context_reset':
            return <ContextResetDivider message={message} />;
        case 'agent_error':
            return <AgentErrorRow message={message} />;
        case 'confirmation_request':
            return <ConfirmationRequestCard message={message} />;
        case 'confirmation_resolved':
            return <ConfirmationResolvedRow message={message} />;
        case 'final':
        default: {
            // Route every final message through StreamingMessage so the word-reveal animation runs even when the full reply arrives in one chunk.
            const isStreaming = readBoolean(message.metadata, 'streaming');
            return <StreamingMessage content={message.content} streaming={isStreaming} />;
        }
    }
}

function ToolCallCard({ message }: { message: ChatMessage }) {
    const toolName = readString(message.metadata, 'tool_name') ?? 'tool';
    const toolArgs = readString(message.metadata, 'tool_args');
    const [showDetails, setShowDetails] = useState(false);
    const hasArgs = toolArgs && toolArgs !== '{}' && toolArgs !== 'None';

    return (
        <div
            className="flex items-start gap-2.5 px-3 py-2 bg-muted/60 rounded-lg max-w-[70%]"
            data-testid={`chat-agent-tool-call-${message.id}`}
            data-tool-name={toolName}
        >
            <Wrench size={16} weight="duotone" className="text-primary shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
                <div className="text-[13px] text-foreground">{humanizeToolName(toolName)}</div>
                <div className="text-[11px] text-muted-foreground font-mono truncate">{toolName}</div>
                {hasArgs && (
                    <button
                        type="button"
                        onClick={() => setShowDetails((v) => !v)}
                        className="text-[11px] text-muted-foreground hover:text-foreground mt-1"
                        data-testid={`chat-agent-tool-call-toggle-${message.id}`}
                        data-state={showDetails ? 'open' : 'closed'}
                    >
                        {showDetails ? 'Hide arguments' : 'Show arguments'}
                    </button>
                )}
                {showDetails && hasArgs && (
                    <pre
                        className="text-[11px] font-mono bg-background/50 rounded p-2 mt-1 overflow-x-auto text-foreground/80"
                        data-testid={`chat-agent-tool-call-args-${message.id}`}
                    >
                        {toolArgs}
                    </pre>
                )}
            </div>
        </div>
    );
}

function ToolResultCard({ message }: { message: ChatMessage }) {
    const toolName = readString(message.metadata, 'tool_name') ?? 'tool';
    const [showDetails, setShowDetails] = useState(false);
    const result = message.content || readString(message.metadata, 'tool_result') || '';
    const hasResult = result.trim().length > 0;
    const looksLikeError = /^(Error|Permission denied|Not found|Validation error)/i.test(result);

    return (
        <div
            className={cn(
                'flex items-start gap-2.5 px-3 py-2 rounded-lg max-w-[70%]',
                looksLikeError ? 'bg-red-500/10' : 'bg-muted/40',
            )}
            data-testid={`chat-agent-tool-result-${message.id}`}
            data-tool-name={toolName}
            data-tool-status={looksLikeError ? 'failed' : 'completed'}
        >
            {looksLikeError ? (
                <XCircle size={16} weight="fill" className="text-red-500 shrink-0 mt-0.5" />
            ) : (
                <CheckCircle size={16} weight="fill" className="text-green-500 shrink-0 mt-0.5" />
            )}
            <div className="min-w-0 flex-1">
                <div className="text-[11px] text-muted-foreground font-mono truncate">
                    {toolName} {looksLikeError ? 'failed' : 'completed'}
                </div>
                {hasResult && (
                    <>
                        <button
                            type="button"
                            onClick={() => setShowDetails((v) => !v)}
                            className="text-[11px] text-muted-foreground hover:text-foreground mt-1"
                            data-testid={`chat-agent-tool-result-toggle-${message.id}`}
                            data-state={showDetails ? 'open' : 'closed'}
                        >
                            {showDetails ? 'Hide result' : 'Show result'}
                        </button>
                        {showDetails && (
                            <pre
                                className="text-[11px] font-mono bg-background/50 rounded p-2 mt-1 overflow-x-auto whitespace-pre-wrap text-foreground/80 max-h-64"
                                data-testid={`chat-agent-tool-result-body-${message.id}`}
                            >
                                {result}
                            </pre>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

function SummaryRow({ message }: { message: ChatMessage }) {
    const [expanded, setExpanded] = useState(false);
    const content = message.content || '';
    const compactedCount = (() => {
        const raw = message.metadata['compacted_msg_ids'];
        if (Array.isArray(raw)) return raw.length;
        if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
                return trimmed.slice(1, -1).split(',').filter((s) => s.trim().length > 0).length;
            }
        }
        return 0;
    })();

    return (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <FileText size={14} className="shrink-0 mt-0.5 opacity-70" />
            <div className="min-w-0 flex-1">
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="flex items-center gap-1 uppercase tracking-wide text-[10px] opacity-70 hover:opacity-100 transition-opacity"
                >
                    <span>Conversation summary{compactedCount > 0 ? ` (${compactedCount} messages rolled up)` : ''}</span>
                    {expanded ? <CaretUp size={10} /> : <CaretDown size={10} />}
                </button>
                {expanded && content && (
                    <div className="mt-1 opacity-80 italic whitespace-pre-wrap">{content}</div>
                )}
            </div>
        </div>
    );
}

function AgentErrorRow({ message }: { message: ChatMessage }) {
    const [showRaw, setShowRaw] = useState(false);
    const display = message.content || 'Unknown error';
    const raw = readString(message.metadata, 'raw_error');
    const hasMore = !!raw && raw !== display;
    return (
        <div className="flex items-start gap-2.5 px-3 py-2 rounded-lg max-w-[70%] bg-red-500/10 border border-red-500/30">
            <Warning size={16} weight="fill" className="text-red-500 shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-wide text-red-600 dark:text-red-400 font-medium mb-0.5">
                    Agent error
                </div>
                <div className="text-[13px] text-foreground whitespace-pre-wrap break-words">{display}</div>
                {hasMore && (
                    <>
                        <button
                            type="button"
                            onClick={() => setShowRaw((v) => !v)}
                            className="text-[11px] text-muted-foreground hover:text-foreground mt-1"
                        >
                            {showRaw ? 'Hide full error' : 'Show full error'}
                        </button>
                        {showRaw && (
                            <pre className="text-[11px] font-mono bg-background/50 rounded p-2 mt-1 overflow-x-auto whitespace-pre-wrap text-foreground/80 max-h-64">
                                {raw}
                            </pre>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

function ContextResetDivider({ message }: { message: ChatMessage }) {
    const resetByUserId = readString(message.metadata, 'reset_by_user_id') ?? '';
    const currentUserId = useAppSelector((s) => s.auth.user?.id);
    const currentUserName = useAppSelector((s) => s.auth.user?.fullName ?? s.auth.user?.email ?? '');
    const memberLookup = useAppSelector((s) => {
        if (!resetByUserId || resetByUserId === currentUserId) return null;
        return s.admin.members.find((m) => m.userId === resetByUserId) ?? null;
    });

    const resetByName =
        readString(message.metadata, 'reset_by_name') ??
        (resetByUserId && resetByUserId === currentUserId ? `${currentUserName || 'You'}` : null) ??
        memberLookup?.displayName ??
        'Someone';

    const time = new Date(message.createdAt).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit',
    });
    return (
        <div className="flex items-center gap-3 py-1 text-[11px] text-muted-foreground">
            <div className="flex-1 h-px bg-border" />
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-muted/60 border border-border/60">
                <ArrowClockwise size={11} weight="bold" className="opacity-70" />
                <span>
                    Conversation reset by <span className="font-medium text-foreground/80">{resetByName}</span> -{' '}
                    {time}
                </span>
            </div>
            <div className="flex-1 h-px bg-border" />
        </div>
    );
}

function ConfirmationRequestCard({ message }: { message: ChatMessage }) {
    const dispatch = useAppDispatch();
    const currentUserId = useAppSelector((state) => state.auth.user?.id ?? '');

    const toolName = readString(message.metadata, 'tool_name') ?? 'tool';
    const argsPreview = readString(message.metadata, 'args_preview');
    const actorUserId = readString(message.metadata, 'actor_user_id') ?? '';
    const requestId = readString(message.metadata, 'request_id') ?? message.id;
    const backingMessageId = readString(message.metadata, 'message_id') ?? message.id;

    const isActor = !!currentUserId && currentUserId === actorUserId;
    const [showDetails, setShowDetails] = useState(false);
    const [pending, setPending] = useState<'approve' | 'deny' | null>(null);

    const respond = (approved: boolean) => {
        if (!isActor || pending) return;
        setPending(approved ? 'approve' : 'deny');
        dispatch(
            respondToAgentConfirmation({
                channelId: message.channelId,
                messageId: backingMessageId,
                requestId,
                approved,
            }),
        )
            .unwrap()
            .catch(() => {
                // errorToastMiddleware surfaces the failure; reset so the user can retry.
                setPending(null);
            });
    };

    const hasArgs = argsPreview && argsPreview !== '{}' && argsPreview !== 'None';

    return (
        <div
            className="flex flex-col items-start"
            data-testid={`chat-agent-confirmation-${message.id}`}
            data-tool-name={toolName}
            data-actor={isActor ? 'self' : 'other'}
        >
            <div className="max-w-[70%] bg-card border-2 border-yellow-500/50 rounded-lg overflow-hidden">
                <div className="px-3 py-2.5 space-y-2">
                    <div className="flex items-start gap-2.5">
                        <Warning size={18} weight="fill" className="text-yellow-500 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                            <p className="text-[13px] font-medium text-foreground">
                                Approval required: {humanizeToolName(toolName)}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-0.5 font-mono truncate">
                                {toolName}
                            </p>
                        </div>
                    </div>

                    {hasArgs && (
                        <>
                            <button
                                type="button"
                                onClick={() => setShowDetails((v) => !v)}
                                className="text-[11px] text-muted-foreground hover:text-foreground"
                                data-testid={`chat-agent-confirmation-toggle-${message.id}`}
                                data-state={showDetails ? 'open' : 'closed'}
                            >
                                {showDetails ? 'Hide arguments' : 'Show arguments'}
                            </button>
                            {showDetails && (
                                <pre
                                    className="text-[11px] font-mono bg-muted/40 rounded p-2 overflow-x-auto text-foreground/80"
                                    data-testid={`chat-agent-confirmation-args-${message.id}`}
                                >
                                    {argsPreview}
                                </pre>
                            )}
                        </>
                    )}

                    {isActor ? (
                        <div className="flex gap-2">
                            <Button
                                onClick={() => respond(true)}
                                size="sm"
                                disabled={!!pending}
                                className="bg-green-600 hover:bg-green-700 text-white"
                                data-testid={`chat-agent-confirmation-allow-${message.id}`}
                            >
                                <Check size={14} className="mr-1" />
                                {pending === 'approve' ? 'Approving...' : 'Allow'}
                            </Button>
                            <Button
                                onClick={() => respond(false)}
                                size="sm"
                                variant="outline"
                                disabled={!!pending}
                                data-testid={`chat-agent-confirmation-deny-${message.id}`}
                            >
                                <X size={14} className="mr-1" />
                                {pending === 'deny' ? 'Denying...' : 'Deny'}
                            </Button>
                        </div>
                    ) : (
                        <p className="text-[11px] text-muted-foreground italic">
                            Waiting for the requester to approve...
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}

function ConfirmationResolvedRow({ message }: { message: ChatMessage }) {
    const decision = readString(message.metadata, 'decision') ?? 'approved';
    const toolName = readString(message.metadata, 'tool_name') ?? 'tool';
    const approved = decision === 'approved';

    return (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {approved ? (
                <CheckCircle size={14} weight="fill" className="text-green-500 shrink-0" />
            ) : (
                <XCircle size={14} weight="fill" className="text-red-500 shrink-0" />
            )}
            <span>
                {approved ? 'Approved' : 'Denied'}: {humanizeToolName(toolName)}
            </span>
            <ArrowsClockwise size={10} className="opacity-40" />
        </div>
    );
}
