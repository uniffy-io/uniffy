import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import type { SerializedMessage } from '@/features/agents/store/agentMessagesThunks';
import { fetchMessages } from '@/features/agents/store/agentMessagesThunks';
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
    loading: boolean;
    error: string | null;
}

const initialState: AgentMessagesState = {
    messagesBySession: {},
    fileMetadataCache: {},
    streamingContent: '',
    streamingToolCalls: [],
    pendingConfirmation: null,
    isStreaming: false,
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
            state.error = null;
        },
        addOptimisticUserMessage: (state, action: PayloadAction<{ sessionId: string; content: string; fileIds?: string[] }>) => {
            const { sessionId, content, fileIds } = action.payload;
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
            });
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
            });
    },
});

export const {
    streamStarted,
    addOptimisticUserMessage,
    cacheFileMetadata,
    appendStreamingToken,
    addStreamingToolCall,
    addStreamingToolResult,
    setConfirmationRequired,
    clearConfirmation,
    streamCompleted,
    streamError,
} = agentMessagesSlice.actions;

export const selectMessagesForSession = (sessionId: string | null) => (state: RootState) =>
    sessionId ? state.agentMessages.messagesBySession[sessionId] ?? [] : [];
export const selectStreamingContent = (state: RootState) => state.agentMessages.streamingContent;
export const selectStreamingToolCalls = (state: RootState) => state.agentMessages.streamingToolCalls;
export const selectIsStreaming = (state: RootState) => state.agentMessages.isStreaming;
export const selectPendingConfirmation = (state: RootState) => state.agentMessages.pendingConfirmation;
export const selectMessagesLoading = (state: RootState) => state.agentMessages.loading;
export const selectFileMetadataCache = (state: RootState) => state.agentMessages.fileMetadataCache;

export const agentMessagesReducer = agentMessagesSlice.reducer;
