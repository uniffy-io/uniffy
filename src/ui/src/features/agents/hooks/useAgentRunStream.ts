import { useEffect, useRef, useState } from 'react';
import { ConnectError, Code } from '@connectrpc/connect';
import { useAppDispatch } from '@/app/hooks';
import { runtimeApi } from '@/features/agents/api/runtimeApi';
import {
    streamStarted,
    runIdReceived,
    clearActiveRunId,
    streamError,
} from '@/features/agents/store/agentMessagesSlice';
import { createAgentStreamConsumer } from '@/features/agents/store/agentStreamFold';

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

        const consumer = createAgentStreamConsumer(dispatch, sessionId);

        const run = async () => {
            try {
                const stream = runtimeApi.subscribeToRun(
                    { runId, organizationId },
                    { signal: controller.signal },
                );

                for await (const envelope of stream) {
                    if (cancelled) break;
                    const outcome = consumer.handle(envelope);
                    if (outcome?.status === 'error') {
                        setError(outcome.errorMessage ?? 'Run failed');
                    }
                }
            } catch (err) {
                if (controller.signal.aborted) return;
                // Persisted run TTL expired or stream already cleaned up - silently drop the id.
                if (err instanceof ConnectError && err.code === Code.NotFound) {
                    dispatch(clearActiveRunId());
                    return;
                }
                const message = err instanceof Error ? err.message : 'Run subscription failed';
                dispatch(streamError(message));
                setError(message);
            } finally {
                consumer.dispose();
                if (!cancelled) setIsStreaming(false);
            }
        };

        run();

        return () => {
            cancelled = true;
            controller.abort();
            consumer.dispose();
            abortRef.current = null;
        };
    }, [runId, organizationId, sessionId, dispatch]);

    return { isStreaming, error };
}
