/** Renders an agent-authored ChatMessage by dispatching on `metadata.kind`. */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, XCircle, FileText, ArrowsClockwise, Warning, Check, X, ArrowClockwise, CaretDown, CaretUp, Lightning, ThumbsUp, ThumbsDown } from '@phosphor-icons/react';
import { StreamingMessage } from '@/features/chat/components/channel/StreamingMessage';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/utils/cn';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { respondToAgentConfirmation, stopAgentRun, submitAgentReplyFeedback } from '@/features/chat/store/chatThunks';
import {
    selectAgentThinkingForMessage,
    selectMessagesForChannel,
    selectTypingUsers,
} from '@/features/chat/store/chatMessagesSlice';
import { useAgentsBuilderAccess } from '@/features/agents/hooks/useAgentsBuilderAccess';
import { ThinkingPane } from '@/features/agents/components/ThinkingPane';
import { ToolActivityPane, type ToolStep } from '@/features/agents/components/ToolActivityPane';
import { internalToolName, toolActionLabel } from '@/features/agents/config/toolLabels';
import { persistedThinkingBlocks } from '@/features/agents/utils/thinkingBlocks';
import { GeneratedImageCard } from '@/features/chat/components/channel/GeneratedImageCard';
import { parseImageMeta, type ImageGenerationMeta } from '@/features/chat/utils/imageMeta';
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

export function AgentMessageBody({ message }: AgentMessageBodyProps) {
    const kind = readString(message.metadata, 'kind') ?? 'final';

    switch (kind) {
        case 'tool_call':
            return <AgentToolActivityPane toolMessages={[message]} />;
        case 'tool_result':
            // A result whose tool_call row is present is absorbed into the call
            // card (the list hides it); this only renders an orphan result.
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
        case 'skill_draft':
            return <SkillDraftCard message={message} />;
        case 'final':
        default: {
            // Route every final message through StreamingMessage so the word-reveal animation runs even when the full reply arrives in one chunk.
            const isStreaming = readBoolean(message.metadata, 'streaming');
            return <FinalMessageWithThinking message={message} streaming={isStreaming} />;
        }
    }
}

/** Final agent reply plus its reasoning pane (thinking never merges into content).
 * Live stream events win; after a reload the pane rehydrates from the
 * persisted `metadata.thinking` blocks. */
function FinalMessageWithThinking({ message, streaming }: { message: ChatMessage; streaming: boolean }) {
    const liveThinking = useAppSelector((s) => selectAgentThinkingForMessage(s, message.id));
    const persisted = useMemo(
        () => persistedThinkingBlocks(message.metadata?.['thinking']),
        [message.metadata],
    );
    const thinking = liveThinking.length > 0 ? liveThinking : persisted;

    // The reasoning pane already signals live activity, so skip the streaming
    // "responding" dots on a contentless step (e.g. a tool-loop preamble whose
    // answer arrives in a later message). Keep them only when nothing else does.
    const showStreamingBody = !!message.content || thinking.length === 0;

    return (
        <div className="min-w-0 flex-1">
            {thinking.length > 0 && (
                <ThinkingPane
                    blocks={thinking}
                    live={streaming && thinking.some((b) => !b.done)}
                    answerStarted={!!message.content || !streaming}
                />
            )}
            {showStreamingBody && <StreamingMessage content={message.content} streaming={streaming} />}
            {!streaming && !!message.content && <ReplyFeedbackRow message={message} />}
        </div>
    );
}

/** Thumbs on a settled agent reply; clicking the active thumb clears the rating. */
function ReplyFeedbackRow({ message }: { message: ChatMessage }) {
    const dispatch = useAppDispatch();
    const rating = message.feedbackRating ?? '';

    const rate = (value: 'up' | 'down') => {
        dispatch(
            submitAgentReplyFeedback({
                channelId: message.channelId,
                messageId: message.id,
                rating: rating === value ? '' : value,
            }),
        );
    };

    return (
        <div
            className={cn(
                'mt-1 flex items-center gap-0.5 transition-opacity',
                rating ? 'opacity-100' : 'md:opacity-0 md:group-hover:opacity-100',
            )}
            data-testid={`chat-agent-feedback-${message.id}`}
            data-rating={rating || 'none'}
        >
            <button
                type="button"
                onClick={() => rate('up')}
                className={cn(
                    'p-1 rounded-md hover:bg-muted transition-colors',
                    rating === 'up'
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-muted-foreground hover:text-foreground',
                )}
                title="Good response"
                data-testid={`chat-agent-feedback-up-${message.id}`}
            >
                <ThumbsUp size={14} weight={rating === 'up' ? 'fill' : 'regular'} />
            </button>
            <button
                type="button"
                onClick={() => rate('down')}
                className={cn(
                    'p-1 rounded-md hover:bg-muted transition-colors',
                    rating === 'down'
                        ? 'text-red-500'
                        : 'text-muted-foreground hover:text-foreground',
                )}
                title="Bad response"
                data-testid={`chat-agent-feedback-down-${message.id}`}
            >
                <ThumbsDown size={14} weight={rating === 'down' ? 'fill' : 'regular'} />
            </button>
        </div>
    );
}

const TOOL_ERROR_RE = /^(Error|Permission denied|Not found|Validation error)/i;

/** Groups a run of tool calls into one reasoning-pane-styled timeline, evolving
 * running -> completed / failed as each call's result row and the agent's typing
 * state arrive. Consecutive tool-call rows are folded into a single instance by
 * the message list; a lone call renders a one-step pane. */
export function AgentToolActivityPane({ toolMessages }: { toolMessages: ChatMessage[] }) {
    const dispatch = useAppDispatch();
    const channelId = toolMessages[0]?.channelId ?? '';
    const agentId = readString(toolMessages[0]?.metadata ?? {}, 'agent_id');
    const channelMessages = useAppSelector((s) => selectMessagesForChannel(s, channelId));
    const agentActive = useAppSelector(
        (s) => !!agentId && selectTypingUsers(s, channelId).some((u) => u.userId === agentId),
    );

    const steps: ToolStep[] = toolMessages.map((message) => {
        const toolName = readString(message.metadata, 'tool_name') ?? 'tool';
        const toolCallId = readString(message.metadata, 'tool_call_id');
        const resultMsg = toolCallId
            ? channelMessages.find(
                  (m) =>
                      m.senderType === 'AGENT' &&
                      m.metadata?.['kind'] === 'tool_result' &&
                      m.metadata?.['tool_call_id'] === toolCallId,
              )
            : undefined;
        const result =
            resultMsg?.content ||
            (resultMsg ? readString(resultMsg.metadata, 'tool_result') : undefined) ||
            '';
        const failed = !!resultMsg && TOOL_ERROR_RE.test(result);
        const running = !resultMsg && agentActive;
        const interrupted = !resultMsg && !agentActive;
        const isImage = internalToolName(toolName).includes('image');
        return {
            id: message.id,
            toolName,
            label: toolActionLabel(toolName),
            args: readString(message.metadata, 'tool_args'),
            result: result || undefined,
            status: running ? 'running' : interrupted ? 'interrupted' : failed ? 'failed' : 'completed',
            durationSecs: resultMsg
                ? Math.max(
                      0,
                      Math.floor(
                          (new Date(resultMsg.createdAt).getTime() - new Date(message.createdAt).getTime()) / 1000,
                      ),
                  )
                : undefined,
            hint: running && isImage ? 'Image generation can take up to 5 minutes - hang tight.' : undefined,
        };
    });

    // A generated image carries its resolved params on the result row; they are
    // what the regenerate menu patches, and the model never saw most of them.
    const imageResults: { messageId: string; meta: ImageGenerationMeta }[] = toolMessages
        .flatMap((message) => {
            const toolCallId = readString(message.metadata, 'tool_call_id');
            const resultMsg = toolCallId
                ? channelMessages.find(
                      (m) =>
                          m.senderType === 'AGENT' &&
                          m.metadata?.['kind'] === 'tool_result' &&
                          m.metadata?.['tool_call_id'] === toolCallId,
                  )
                : undefined;
            const meta = resultMsg ? parseImageMeta(resultMsg.metadata?.['tool_meta']) : null;
            return meta && resultMsg ? [{ messageId: resultMsg.id, meta }] : [];
        });

    const live = steps.some((s) => s.status === 'running');
    const onStop = live && agentId ? () => dispatch(stopAgentRun({ channelId, agentId })) : undefined;

    return (
        <div className="min-w-0 flex-1">
            <ToolActivityPane
                steps={steps}
                live={live}
                answerStarted={!live}
                onStop={onStop}
                testId={`chat-agent-tool-activity-${toolMessages[0]?.id ?? ''}`}
            />
            {imageResults.map(({ messageId, meta }) => (
                <GeneratedImageCard
                    key={messageId}
                    meta={meta}
                    channelId={channelId}
                    messageId={messageId}
                />
            ))}
        </div>
    );
}

/** An orphan tool result whose call row never arrived; a single settled step. */
function ToolResultCard({ message }: { message: ChatMessage }) {
    const toolName = readString(message.metadata, 'tool_name') ?? 'tool';
    const result = message.content || readString(message.metadata, 'tool_result') || '';
    const failed = TOOL_ERROR_RE.test(result);
    const steps: ToolStep[] = [
        {
            id: message.id,
            toolName,
            label: toolActionLabel(toolName),
            result: result || undefined,
            status: failed ? 'failed' : 'completed',
        },
    ];

    return (
        <ToolActivityPane
            steps={steps}
            live={false}
            answerStarted
            testId={`chat-agent-tool-result-${message.id}`}
        />
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
                                Approval required: {toolActionLabel(toolName)}
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

function SkillDraftCard({ message }: { message: ChatMessage }) {
    const navigate = useNavigate();
    const currentUserId = useAppSelector((state) => state.auth.user?.id ?? '');
    const { isBuilder } = useAgentsBuilderAccess();

    const draftId = readString(message.metadata, 'draft_id') ?? '';
    const title = readString(message.metadata, 'draft_display_name')
        ?? readString(message.metadata, 'draft_name')
        ?? 'Proposed skill';
    const description = readString(message.metadata, 'draft_description');
    const draftKind = readString(message.metadata, 'draft_kind') ?? 'create';
    const status = readString(message.metadata, 'draft_status') ?? 'pending';
    const actorUserId = readString(message.metadata, 'actor_user_id') ?? '';

    const isActor = !!currentUserId && currentUserId === actorUserId;

    const openReview = () => {
        if (!draftId) return;
        navigate(`/agents/skills/drafts/${draftId}`);
    };

    return (
        <div
            className="flex flex-col items-start"
            data-testid={`chat-skill-draft-${message.id}`}
            data-actor={isActor ? 'self' : 'other'}
        >
            <div className="max-w-[70%] bg-card border-2 border-primary/40 rounded-lg overflow-hidden">
                <div className="px-3 py-2.5 space-y-2">
                    <div className="flex items-start gap-2.5">
                        <Lightning size={18} weight="fill" className="text-primary shrink-0 mt-0.5" />
                        <div className="min-w-0">
                            <p className="text-[13px] font-medium text-foreground">
                                {draftKind === 'create' ? 'Proposed skill' : 'Proposed skill update'}: {title}
                            </p>
                            {description && (
                                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                                    {description}
                                </p>
                            )}
                        </div>
                    </div>

                    {status === 'pending' ? (
                        isBuilder ? (
                            <Button
                                onClick={openReview}
                                size="sm"
                                data-testid={`chat-skill-draft-review-${message.id}`}
                            >
                                Review &amp; save
                            </Button>
                        ) : (
                            <p className="text-[11px] text-muted-foreground italic">
                                Waiting for a builder to review...
                            </p>
                        )
                    ) : (
                        <div
                            className={cn(
                                'inline-flex items-center gap-1 text-[11px]',
                                status === 'saved' ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground',
                            )}
                        >
                            {status === 'saved' ? <Check size={13} /> : <X size={13} />}
                            {status === 'saved' ? 'Saved to skills' : 'Discarded'}
                        </div>
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
                {approved ? 'Approved' : 'Denied'}: {toolActionLabel(toolName)}
            </span>
            <ArrowsClockwise size={10} className="opacity-40" />
        </div>
    );
}
