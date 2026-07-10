import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import type { SerializedMessage } from '@/features/agents/store/agentMessagesThunks';
import {
    deleteAgentMessage,
    editAgentMessage,
    fetchMessages,
    retryAgentMessage,
    submitMessageFeedback,
} from '@/features/agents/store/agentMessagesThunks';
import { MessageRole } from '@uniffy/proto/agents/v1/sessions_pb';

interface StreamingToolCall {
    toolCallId: string;
    toolName: string;
    toolArgsJson: string;
    result?: string;
    success?: boolean;
}

interface PendingConfirmation {
    toolCallId: string;
    toolName: string;
    toolArgsJson: string;
    description: string;
}

export interface FileMetadata {
    filename: string;
    mediaType: string;
}

interface AgentMessagesState {
    messagesBySession: Record<string, SerializedMessage[]>;
    fileMetadataCache: Record<string, FileMetadata>;
    streamingContent: string;
    streamingToolCalls: StreamingToolCall[];
    pendingConfirmation: PendingConfirmation | null;
    isStreaming: boolean;
    activeRunId: string | null;
    loading: boolean;
    error: string | null;
}

const ACTIVE_RUN_ID_STORAGE_KEY = 'uniffy.agentRuntime.activeRunId';

function readPersistedRunId(): string | null {
    if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
        return null;
    }
    try {
        return window.sessionStorage.getItem(ACTIVE_RUN_ID_STORAGE_KEY);
    } catch {
        return null;
    }
}

function writePersistedRunId(runId: string | null): void {
    if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
        return;
    }
    try {
        if (runId) {
            window.sessionStorage.setItem(ACTIVE_RUN_ID_STORAGE_KEY, runId);
        } else {
            window.sessionStorage.removeItem(ACTIVE_RUN_ID_STORAGE_KEY);
        }
    } catch {
        // sessionStorage may throw under quota or privacy modes; in-memory state is still authoritative.
    }
}

const initialState: AgentMessagesState = {
    messagesBySession: {},
    fileMetadataCache: {},
    streamingContent: '',
    streamingToolCalls: [],
    pendingConfirmation: null,
    isStreaming: false,
    activeRunId: readPersistedRunId(),
    loading: false,
    error: null,
};

export const agentMessagesSlice = createSlice({
    name: 'agentMessages',
    initialState,
    reducers: {
        streamStarted: (state) => {
            state.isStreaming = true;
            state.streamingContent = '';
            state.streamingToolCalls = [];
            state.pendingConfirmation = null;
            state.activeRunId = null;
            writePersistedRunId(null);
            state.error = null;
        },
        runIdReceived: (state, action: PayloadAction<string>) => {
            state.activeRunId = action.payload;
            writePersistedRunId(action.payload);
        },
        clearActiveRunId: (state) => {
            state.activeRunId = null;
            writePersistedRunId(null);
        },
        addOptimisticUserMessage: (state, action: PayloadAction<{ sessionId: string; content: string; fileIds?: string[]; invokedSkillName?: string }>) => {
            const { sessionId, content, fileIds, invokedSkillName } = action.payload;
            if (!state.messagesBySession[sessionId]) {
                state.messagesBySession[sessionId] = [];
            }

            // Build display content with file mention chips so the
            // optimistic message renders file references immediately.
            let displayContent = content;
            if (fileIds?.length) {
                const mentions = fileIds
                    .map((id) => {
                        const meta = state.fileMetadataCache[id];
                        const label = meta?.filename ?? `file-${id.slice(0, 8)}`;
                        return `[[[${label}|urn:uniffy:content:FILE:${id}]]]`;
                    })
                    .join('\n');
                displayContent = [mentions, content].filter(Boolean).join('\n\n');
            }

            state.messagesBySession[sessionId].push({
                id: `optimistic-${Date.now()}`,
                sessionId,
                role: MessageRole.USER,
                content: displayContent,
                inputTokens: 0,
                outputTokens: 0,
                model: undefined,
                toolName: undefined,
                toolCallId: undefined,
                toolArgsJson: undefined,
                toolResult: undefined,
                isThinking: false,
                isCompacted: false,
                createdAt: {
                    seconds: Math.floor(Date.now() / 1000),
                    nanos: 0,
                },
                fileIds: fileIds?.length ? fileIds : undefined,
                isInvalidated: false,
                editedAt: undefined,
                previousContent: undefined,
                wasCancelled: false,
                feedbackRating: '',
                invokedSkillName: invokedSkillName || '',
            });
        },
        reconcileStoredMessage: (state, action: PayloadAction<{ sessionId: string; message: SerializedMessage }>) => {
            const { sessionId, message } = action.payload;
            const list = state.messagesBySession[sessionId];
            if (!list) {
                state.messagesBySession[sessionId] = [message];
                return;
            }
            if (list.some((m) => m.id === message.id)) return;
            const idx = list.findIndex(
                (m) => m.role === message.role && typeof m.id === 'string' && m.id.startsWith('optimistic-'),
            );
            if (idx >= 0) {
                list[idx] = message;
            } else {
                list.push(message);
            }
        },
        cacheFileMetadata: (state, action: PayloadAction<Record<string, FileMetadata>>) => {
            Object.assign(state.fileMetadataCache, action.payload);
        },
        appendStreamingToken: (state, action: PayloadAction<string>) => {
            state.streamingContent += action.payload;
        },
        addStreamingToolCall: (state, action: PayloadAction<{ toolCallId: string; toolName: string; toolArgsJson: string }>) => {
            state.streamingToolCalls.push({
                toolCallId: action.payload.toolCallId,
                toolName: action.payload.toolName,
                toolArgsJson: action.payload.toolArgsJson,
            });
        },
        addStreamingToolResult: (state, action: PayloadAction<{ toolCallId: string; toolName: string; success: boolean; result: string }>) => {
            const call = state.streamingToolCalls.find(
                (tc) => tc.toolCallId === action.payload.toolCallId
            );
            if (call) {
                call.result = action.payload.result;
                call.success = action.payload.success;
            }
        },
        streamCompleted: (state, action: PayloadAction<{ sessionId: string; assistantMessage?: SerializedMessage }>) => {
            state.isStreaming = false;
            const { sessionId, assistantMessage } = action.payload;
            if (assistantMessage) {
                if (!state.messagesBySession[sessionId]) {
                    state.messagesBySession[sessionId] = [];
                }
                state.messagesBySession[sessionId].push(assistantMessage);
            }
            state.streamingContent = '';
            state.streamingToolCalls = [];
            state.activeRunId = null;
            writePersistedRunId(null);
        },
        setConfirmationRequired: (state, action: PayloadAction<PendingConfirmation>) => {
            state.pendingConfirmation = action.payload;
        },
        clearConfirmation: (state) => {
            state.pendingConfirmation = null;
        },
        streamError: (state, action: PayloadAction<string>) => {
            state.isStreaming = false;
            state.error = action.payload;
            state.streamingContent = '';
            state.streamingToolCalls = [];
            state.pendingConfirmation = null;
            state.activeRunId = null;
            writePersistedRunId(null);
        },
        streamCancelled: (state) => {
            state.isStreaming = false;
            state.error = null;
            state.streamingContent = '';
            state.streamingToolCalls = [];
            state.pendingConfirmation = null;
            state.activeRunId = null;
            writePersistedRunId(null);
        },
        clearAgentMessages: () => {
            writePersistedRunId(null);
            return { ...initialState, activeRunId: null };
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchMessages.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchMessages.fulfilled, (state, action) => {
                state.loading = false;
                state.messagesBySession[action.payload.sessionId] = action.payload.messages;
            })
            .addCase(fetchMessages.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Failed to fetch messages';
            })
            .addCase(editAgentMessage.fulfilled, (state, action) => {
                const { sessionId, updated, anchorCreatedAt } = action.payload;
                const list = state.messagesBySession[sessionId];
                if (!list) return;
                const idx = list.findIndex((m) => m.id === updated.id);
                if (idx >= 0) {
                    list[idx] = updated;
                }
                invalidateAfter(list, anchorCreatedAt, false);
            })
            .addCase(deleteAgentMessage.fulfilled, (state, action) => {
                const { sessionId, anchorCreatedAt } = action.payload;
                const list = state.messagesBySession[sessionId];
                if (!list) return;
                invalidateAfter(list, anchorCreatedAt, true);
            })
            .addCase(retryAgentMessage.fulfilled, (state, action) => {
                const { sessionId, anchorMessageId } = action.payload;
                const list = state.messagesBySession[sessionId];
                if (!list) return;
                const anchor = list.find((m) => m.id === anchorMessageId);
                invalidateAfter(list, anchor?.createdAt, false);
            })
            .addCase(submitMessageFeedback.fulfilled, (state, action) => {
                const { sessionId, messageId, rating } = action.payload;
                const msg = state.messagesBySession[sessionId]?.find((m) => m.id === messageId);
                if (msg) msg.feedbackRating = rating;
            });
    },
});

function invalidateAfter(
    list: SerializedMessage[],
    anchorCreatedAt: { seconds: number; nanos: number } | undefined,
    includeAnchor: boolean,
): void {
    if (!anchorCreatedAt) return;
    const anchorMs = anchorCreatedAt.seconds * 1000;
    for (const m of list) {
        if (!m.createdAt) continue;
        const ms = m.createdAt.seconds * 1000;
        const after = includeAnchor ? ms >= anchorMs : ms > anchorMs;
        if (after) {
            m.isInvalidated = true;
        }
    }
}

export const {
    streamStarted,
    runIdReceived,
    clearActiveRunId,
    addOptimisticUserMessage,
    reconcileStoredMessage,
    cacheFileMetadata,
    appendStreamingToken,
    addStreamingToolCall,
    addStreamingToolResult,
    setConfirmationRequired,
    clearConfirmation,
    streamCompleted,
    streamError,
    streamCancelled,
    clearAgentMessages,
} = agentMessagesSlice.actions;


export const selectMessagesForSession = (sessionId: string | null) => (state: RootState) =>
    sessionId ? state.agentMessages.messagesBySession[sessionId] ?? [] : [];
export const selectStreamingContent = (state: RootState) => state.agentMessages.streamingContent;
export const selectStreamingToolCalls = (state: RootState) => state.agentMessages.streamingToolCalls;
export const selectIsStreaming = (state: RootState) => state.agentMessages.isStreaming;
export const selectActiveRunId = (state: RootState) => state.agentMessages.activeRunId;
export const selectPendingConfirmation = (state: RootState) => state.agentMessages.pendingConfirmation;
export const selectMessagesLoading = (state: RootState) => state.agentMessages.loading;
export const selectFileMetadataCache = (state: RootState) => state.agentMessages.fileMetadataCache;

export const agentMessagesReducer = agentMessagesSlice.reducer;
