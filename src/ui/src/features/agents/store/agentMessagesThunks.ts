import { createAsyncThunk } from '@reduxjs/toolkit';
import { toast } from 'sonner';
import { sessionsApi } from '@/features/agents/api/sessionsApi';
import { runtimeApi } from '@/features/agents/api/runtimeApi';
import type { RootState } from '@/app/store';
import type { MessageInfo } from '@uniffy/proto/agents/v1/sessions_pb';
import { MessageRole } from '@uniffy/proto/agents/v1/sessions_pb';
import {
    streamStarted,
    runIdReceived,
    addOptimisticUserMessage,
    reconcileStoredMessage,
    appendStreamingToken,
    addStreamingToolCall,
    addStreamingToolResult,
    setConfirmationRequired,
    clearConfirmation,
    streamCompleted,
    streamError,
    streamCancelled,
} from '@/features/agents/store/agentMessagesSlice';

const getOrganizationId = (state: RootState): string => {
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) throw new Error('No organization selected');
    return orgId;
};

const timestampToPlain = (ts?: { seconds: bigint | number; nanos: bigint | number }) => {
    if (!ts) return undefined;
    return {
        seconds: typeof ts.seconds === 'bigint' ? Number(ts.seconds) : ts.seconds,
        nanos: typeof ts.nanos === 'bigint' ? Number(ts.nanos) : ts.nanos,
    };
};

export const messageToPlain = (msg: MessageInfo) => ({
    id: msg.id,
    sessionId: msg.sessionId,
    role: msg.role,
    content: msg.content,
    inputTokens: msg.inputTokens,
    outputTokens: msg.outputTokens,
    model: msg.model,
    toolName: msg.toolName,
    toolCallId: msg.toolCallId,
    toolArgsJson: msg.toolArgsJson,
    toolResult: msg.toolResult,
    isThinking: msg.isThinking,
    isCompacted: msg.isCompacted,
    createdAt: timestampToPlain(msg.createdAt),
    fileIds: msg.fileIds?.length ? [...msg.fileIds] : undefined,
    isInvalidated: msg.isInvalidated,
    editedAt: timestampToPlain(msg.editedAt),
    previousContent: msg.previousContent,
    wasCancelled: msg.wasCancelled,
});

export type SerializedMessage = ReturnType<typeof messageToPlain>;

export const fetchMessages = createAsyncThunk<
    { sessionId: string; messages: SerializedMessage[] },
    { sessionId: string },
    { state: RootState; rejectValue: string }
>('agentMessages/fetchMessages', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());

        // Backend caps page size at 200; compaction keeps active messages well under that.
        const first = await sessionsApi.listMessages({
            organizationId,
            sessionId: params.sessionId,
            pagination: { page: 1, pageSize: 200 },
        });
        const allMessages = first.messages.map(messageToPlain);
        const totalPages = first.pagination?.totalPages ?? 1;

        for (let page = 2; page <= totalPages; page++) {
            const next = await sessionsApi.listMessages({
                organizationId,
                sessionId: params.sessionId,
                pagination: { page, pageSize: 200 },
            });
            allMessages.push(...next.messages.map(messageToPlain));
        }

        return {
            sessionId: params.sessionId,
            messages: allMessages,
        };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch messages');
    }
});

export const streamSendMessage = createAsyncThunk<
    void,
    {
        sessionId: string;
        content: string;
        fileIds?: string[];
    },
    { state: RootState; rejectValue: string }
>('agentMessages/streamSendMessage', async (params, { getState, dispatch, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        dispatch(streamStarted());
        dispatch(addOptimisticUserMessage({
            sessionId: params.sessionId,
            content: params.content,
            fileIds: params.fileIds,
        }));

        const stream = runtimeApi.streamSendMessage({
            organizationId,
            sessionId: params.sessionId,
            content: params.content,
            fileIds: params.fileIds ?? [],
            userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });

        // RAF-batched token flush caps React re-renders at ~60fps regardless of token arrival rate.
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

        for await (const envelope of stream) {
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
            } else if (event.event.case === 'messageStored') {
                const stored = event.event.value.message;
                if (stored) {
                    dispatch(reconcileStoredMessage({
                        sessionId: params.sessionId,
                        message: messageToPlain(stored),
                    }));
                }
            } else if (event.event.case === 'done') {
                if (rafId !== null) cancelAnimationFrame(rafId);
                flushTokens();
                const assistantMsg = event.event.value.assistantMessage;
                dispatch(streamCompleted({
                    sessionId: params.sessionId,
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
                if (event.event.value.message === 'cancelled') {
                    dispatch(streamCancelled());
                    return;
                }
                dispatch(streamError(event.event.value.message));
                return rejectWithValue(event.event.value.message);
            }
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Streaming failed';
        dispatch(streamError(msg));
        return rejectWithValue(msg);
    }
});

export const rerunFromMessage = createAsyncThunk<
    void,
    { sessionId: string; messageId: string },
    { state: RootState; rejectValue: string }
>('agentMessages/rerunFromMessage', async (params, { getState, dispatch, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        dispatch(streamStarted());

        const stream = runtimeApi.rerunFromMessage({
            organizationId,
            messageId: params.messageId,
            userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });

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

        for await (const envelope of stream) {
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
            } else if (event.event.case === 'messageStored') {
                const stored = event.event.value.message;
                if (stored) {
                    dispatch(reconcileStoredMessage({
                        sessionId: params.sessionId,
                        message: messageToPlain(stored),
                    }));
                }
            } else if (event.event.case === 'done') {
                if (rafId !== null) cancelAnimationFrame(rafId);
                flushTokens();
                const assistantMsg = event.event.value.assistantMessage;
                dispatch(streamCompleted({
                    sessionId: params.sessionId,
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
                if (event.event.value.message === 'cancelled') {
                    dispatch(streamCancelled());
                    return;
                }
                dispatch(streamError(event.event.value.message));
                return rejectWithValue(event.event.value.message);
            }
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Rerun failed';
        dispatch(streamError(msg));
        return rejectWithValue(msg);
    }
});

export const cancelActiveRun = createAsyncThunk<
    void,
    void,
    { state: RootState; rejectValue: string }
>('agentMessages/cancelActiveRun', async (_, { getState, rejectWithValue }) => {
    try {
        const state = getState();
        const organizationId = getOrganizationId(state);
        const runId = state.agentMessages.activeRunId;
        if (!runId) return;
        await runtimeApi.cancelStream({ organizationId, runId });
    } catch (error) {
        return rejectWithValue(
            error instanceof Error ? error.message : 'Failed to cancel run',
        );
    }
});

export const editAgentMessage = createAsyncThunk<
    { sessionId: string; updated: SerializedMessage; anchorCreatedAt?: { seconds: number; nanos: number } },
    { sessionId: string; messageId: string; newContent: string },
    { state: RootState; rejectValue: string }
>('agentMessages/editMessage', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const resp = await sessionsApi.editMessage({
            organizationId,
            messageId: params.messageId,
            newContent: params.newContent,
        });
        if (!resp.message) throw new Error('Empty edit response');
        const updated = messageToPlain(resp.message);
        return {
            sessionId: params.sessionId,
            updated,
            anchorCreatedAt: updated.createdAt,
        };
    } catch (error) {
        return rejectWithValue(
            error instanceof Error ? error.message : 'Failed to edit message',
        );
    }
});

export const deleteAgentMessage = createAsyncThunk<
    { sessionId: string; messageId: string; anchorCreatedAt?: { seconds: number; nanos: number } },
    { sessionId: string; messageId: string },
    { state: RootState; rejectValue: string }
>('agentMessages/deleteMessage', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        await sessionsApi.deleteMessage({
            organizationId,
            messageId: params.messageId,
        });
        const list = getState().agentMessages.messagesBySession[params.sessionId];
        const anchor = list?.find((m) => m.id === params.messageId);
        return {
            sessionId: params.sessionId,
            messageId: params.messageId,
            anchorCreatedAt: anchor?.createdAt,
        };
    } catch (error) {
        return rejectWithValue(
            error instanceof Error ? error.message : 'Failed to delete message',
        );
    }
});

export const retryAgentMessage = createAsyncThunk<
    { sessionId: string; content: string; fileIds: string[]; anchorMessageId: string },
    { sessionId: string; messageId: string },
    { state: RootState; rejectValue: string }
>('agentMessages/retryMessage', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const resp = await sessionsApi.retryMessage({
            organizationId,
            messageId: params.messageId,
        });
        return {
            sessionId: params.sessionId,
            content: resp.content,
            fileIds: [...resp.fileIds],
            anchorMessageId: params.messageId,
        };
    } catch (error) {
        return rejectWithValue(
            error instanceof Error ? error.message : 'Failed to retry message',
        );
    }
});

export const respondToConfirmation = createAsyncThunk<
    void,
    { sessionId: string; toolCallId: string; approved: boolean },
    { state: RootState; rejectValue: string }
>('agentMessages/respondToConfirmation', async (params, { getState, dispatch, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        dispatch(clearConfirmation());
        await runtimeApi.respondToConfirmation({
            organizationId,
            sessionId: params.sessionId,
            toolCallId: params.toolCallId,
            approved: params.approved,
        });
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to respond to confirmation');
    }
});

export { MessageRole };
