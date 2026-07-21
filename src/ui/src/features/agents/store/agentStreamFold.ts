import { toast } from 'sonner';
import type { AgentStreamEvent } from '@uniffy/proto/agents/v1/runtime_pb';
import type { AppDispatch } from '@/app/store';
import {
    runIdReceived,
    appendStreamingToken,
    appendStreamingThinking,
    endStreamingThinking,
    recordModelCallEnd,
    addStreamingToolCall,
    addStreamingToolResult,
    setConfirmationRequired,
    reconcileStoredMessage,
    streamCompleted,
    streamError,
    streamCancelled,
} from '@/features/agents/store/agentMessagesSlice';
import { messageToPlain } from '@/features/agents/store/agentMessagesSerde';
import { upsertProposedDraft } from '@/features/agents/store/agentSkillDraftsSlice';
import { skillDraftToPlain } from '@/features/agents/store/agentSkillDraftsThunks';

export interface AgentStreamOutcome {
    status: 'done' | 'error' | 'cancelled';
    errorMessage?: string;
}

export interface AgentStreamConsumer {
    /** Fold one envelope; returns the terminal outcome or null to keep going. */
    handle(envelope: { event?: AgentStreamEvent }): AgentStreamOutcome | null;
    /** Cancel pending animation frames and flush buffered deltas. */
    dispose(): void;
}

/**
 * Single fold for the block-framed agent stream, shared by the send,
 * rerun, and resume paths. Text and thinking deltas are RAF-batched so
 * React re-renders cap at ~60fps regardless of token arrival rate;
 * every other event dispatches immediately.
 *
 * Ignored on purpose: replyStart / modelCallStart / text block framing
 * (content is concatenated), toolCallStart/Delta/End (the tool card is
 * driven by toolResultStart/End, which carry the persisted row), and
 * exceedMaxIters (a terminal error event follows it).
 */
export function createAgentStreamConsumer(
    dispatch: AppDispatch,
    sessionId: string,
): AgentStreamConsumer {
    let textBuffer = '';
    const thinkingBuffers = new Map<string, string>();
    let rafId: number | null = null;

    const flush = () => {
        rafId = null;
        if (textBuffer) {
            dispatch(appendStreamingToken(textBuffer));
            textBuffer = '';
        }
        for (const [blockId, delta] of thinkingBuffers) {
            dispatch(appendStreamingThinking({ blockId, delta }));
        }
        thinkingBuffers.clear();
    };

    const schedule = () => {
        // No frame scheduler (tests, workers): flush synchronously.
        if (typeof requestAnimationFrame === 'undefined') {
            flush();
            return;
        }
        if (rafId === null) {
            rafId = requestAnimationFrame(flush);
        }
    };

    const dispose = () => {
        if (rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
            cancelAnimationFrame(rafId);
        }
        flush();
    };

    const handle = (envelope: { event?: AgentStreamEvent }): AgentStreamOutcome | null => {
        const event = envelope.event;
        if (!event) return null;
        if (event.runId) {
            dispatch(runIdReceived(event.runId));
        }

        switch (event.event.case) {
            case 'textBlockDelta': {
                textBuffer += event.event.value.delta;
                schedule();
                return null;
            }
            case 'thinkingBlockDelta': {
                const { blockId, delta } = event.event.value;
                thinkingBuffers.set(blockId, (thinkingBuffers.get(blockId) ?? '') + delta);
                schedule();
                return null;
            }
            case 'thinkingBlockEnd': {
                dispose();
                dispatch(endStreamingThinking({
                    blockId: event.event.value.blockId,
                    elapsedMs: event.event.value.elapsedMs,
                }));
                return null;
            }
            case 'modelCallEnd': {
                const v = event.event.value;
                dispatch(recordModelCallEnd({
                    model: v.model,
                    inputTokens: Number(v.inputTokens),
                    outputTokens: Number(v.outputTokens),
                    cacheReadInputTokens: Number(v.cacheReadInputTokens),
                }));
                return null;
            }
            case 'toolResultStart': {
                dispatch(addStreamingToolCall({
                    toolCallId: event.event.value.toolCallId,
                    toolName: event.event.value.toolName,
                    toolArgsJson: event.event.value.toolArgsJson,
                }));
                return null;
            }
            case 'toolResultEnd': {
                dispatch(addStreamingToolResult({
                    toolCallId: event.event.value.toolCallId,
                    toolName: event.event.value.toolName,
                    success: event.event.value.success,
                    result: event.event.value.result,
                }));
                return null;
            }
            case 'messageStored': {
                const stored = event.event.value.message;
                if (stored) {
                    dispatch(reconcileStoredMessage({
                        sessionId,
                        message: messageToPlain(stored),
                    }));
                }
                return null;
            }
            case 'done': {
                dispose();
                const assistantMsg = event.event.value.assistantMessage;
                dispatch(streamCompleted({
                    sessionId,
                    assistantMessage: assistantMsg ? messageToPlain(assistantMsg) : undefined,
                }));
                return { status: 'done' };
            }
            case 'failover': {
                const f = event.event.value;
                toast.info(
                    `Switched to ${f.toModel || 'a different provider'}`,
                    { description: `Retry attempt ${f.attempt} (${f.reason})` },
                );
                return null;
            }
            case 'confirmationRequired': {
                dispatch(setConfirmationRequired({
                    toolCallId: event.event.value.toolCallId,
                    toolName: event.event.value.toolName,
                    toolArgsJson: event.event.value.toolArgsJson,
                    description: event.event.value.description,
                }));
                return null;
            }
            case 'skillDraft': {
                const draft = event.event.value.draft;
                if (draft) {
                    dispatch(upsertProposedDraft({
                        draft: skillDraftToPlain(draft),
                        sessionId,
                    }));
                }
                return null;
            }
            case 'error': {
                dispose();
                const message = event.event.value.message;
                if (message === 'cancelled') {
                    dispatch(streamCancelled());
                    return { status: 'cancelled' };
                }
                dispatch(streamError(message));
                return { status: 'error', errorMessage: message };
            }
            default:
                return null;
        }
    };

    return { handle, dispose };
}
