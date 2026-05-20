import { useEffect, useRef, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';
import { toast } from 'sonner';
import { useAppDispatch } from '@/app/hooks';
import { runtimeApi } from '@/features/agents/api/runtimeApi';
import {
    streamStarted,
    runIdReceived,
    clearActiveRunId,
    appendStreamingToken,
    addStreamingToolCall,
    addStreamingToolResult,
    setConfirmationRequired,
    streamCompleted,
    streamError,
} from '@/features/agents/store/agentMessagesSlice';
import { messageToPlain } from '@/features/agents/store/agentMessagesThunks';

export interface UseAgentRunStreamResult {
    isStreaming: boolean;
    error: string | null;
}

export function useAgentRunStream(
    runId: string | null,
    organizationId: string,
    sessionId: string | null,
): UseAgentRunStreamResult {
    const dispatch = useAppDispatch();
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (!runId || !organizationId || !sessionId) return;

        const controller = new AbortController();
        abortRef.current = controller;
        let cancelled = false;

        setIsStreaming(true);
        setError(null);
        dispatch(streamStarted());
        dispatch(runIdReceived(runId));

        let tokenBuffer = '';
        let rafId: number | null = null;

        const flushTokens = () => {
            if (tokenBuffer) {
                dispatch(appendStreamingToken(tokenBuffer));
                tokenBuffer = '';
            }
            rafId = null;
        };

        const bufferToken = (text: string) => {
            tokenBuffer += text;
            if (rafId === null) {
                rafId = requestAnimationFrame(flushTokens);
            }
        };

        const run = async () => {
            try {
                const stream = runtimeApi.subscribeToRun(
                    { runId, organizationId },
                    { signal: controller.signal },
                );

                for await (const envelope of stream) {
                    if (cancelled) break;
                    const event = envelope.event;
                    if (!event) continue;
                    if (event.runId) {
                        dispatch(runIdReceived(event.runId));
                    }
                    if (event.event.case === 'token') {
                        bufferToken(event.event.value.text);
                    } else if (event.event.case === 'toolCall') {
                        dispatch(addStreamingToolCall({
                            toolCallId: event.event.value.toolCallId,
                            toolName: event.event.value.toolName,
                            toolArgsJson: event.event.value.toolArgsJson,
                        }));
                    } else if (event.event.case === 'toolResult') {
                        dispatch(addStreamingToolResult({
                            toolCallId: event.event.value.toolCallId,
                            toolName: event.event.value.toolName,
                            success: event.event.value.success,
                            result: event.event.value.result,
                        }));
                    } else if (event.event.case === 'done') {
                        if (rafId !== null) cancelAnimationFrame(rafId);
                        flushTokens();
                        const assistantMsg = event.event.value.assistantMessage;
                        dispatch(streamCompleted({
                            sessionId,
                            assistantMessage: assistantMsg ? messageToPlain(assistantMsg) : undefined,
                        }));
                    } else if (event.event.case === 'failover') {
                        const f = event.event.value;
                        toast.info(
                            `Switched to ${f.toModel || 'a different provider'}`,
                            { description: `Retry attempt ${f.attempt} (${f.reason})` },
                        );
                    } else if (event.event.case === 'confirmationRequired') {
                        dispatch(setConfirmationRequired({
                            toolCallId: event.event.value.toolCallId,
                            toolName: event.event.value.toolName,
                            toolArgsJson: event.event.value.toolArgsJson,
                            description: event.event.value.description,
                        }));
                    } else if (event.event.case === 'error') {
                        if (rafId !== null) cancelAnimationFrame(rafId);
                        flushTokens();
                        const message = event.event.value.message;
                        dispatch(streamError(message));
                        setError(message);
                    }
                }
            } catch (err) {
                if (controller.signal.aborted) return;
                // The persisted run TTL has expired or the stream was already
                // cleaned up. Drop the persisted run id silently and let the
                // user start fresh - this is not a user-facing error.
                if (err instanceof ConnectError && err.code === Code.NotFound) {
                    dispatch(clearActiveRunId());
                    return;
                }
                const message = err instanceof Error ? err.message : 'Run subscription failed';
                dispatch(streamError(message));
                setError(message);
            } finally {
                if (rafId !== null) cancelAnimationFrame(rafId);
                if (!cancelled) setIsStreaming(false);
            }
        };

        run();

        return () => {
            cancelled = true;
            controller.abort();
            if (rafId !== null) cancelAnimationFrame(rafId);
            abortRef.current = null;
        };
    }, [runId, organizationId, sessionId, dispatch]);

    return { isStreaming, error };
}
