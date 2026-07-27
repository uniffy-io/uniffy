import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import type { SerializedMessage } from '@/features/agents/store/agentMessagesThunks';
import {
    editAgentMessage,
    fetchMessages,
    retryAgentMessage,
} from '@/features/agents/store/agentMessagesThunks';
import { MessageRole } from '@uniffy/proto/agents/v1/sessions_pb';
import { persistedThinkingBlocks } from '@/features/agents/utils/thinkingBlocks';

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

export interface ThinkingBlock {
    blockId: string;
    content: string;
    elapsedMs: number;
    done: boolean;
}

export function parsePersistedThinking(thinkingJson: string | undefined): ThinkingBlock[] {
    if (!thinkingJson) return [];
    try {
        return persistedThinkingBlocks(JSON.parse(thinkingJson));
    } catch {
        return [];
    }
}

export interface StreamingUsage {
    model: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
}

interface AgentMessagesState {
    messagesBySession: Record<string, SerializedMessage[]>;
    fileMetadataCache: Record<string, FileMetadata>;
    streamingContent: string;
    streamingThinking: ThinkingBlock[];
    // Reasoning re-anchored to the stored assistant message on stream
    // completion; rehydrated from each message's persisted thinking_json
    // on history load.
    thinkingByMessage: Record<string, ThinkingBlock[]>;
    streamingUsage: StreamingUsage | null;
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
    streamingThinking: [],
    thinkingByMessage: {},
    streamingUsage: null,
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
            state.streamingThinking = [];
            state.streamingUsage = null;
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
                thinkingJson: '',
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
        // Opens the block implicitly on the first delta; replay coalescing
        // can fold a whole block into one delta, so a separate start
        // signal is never required.
        appendStreamingThinking: (state, action: PayloadAction<{ blockId: string; delta: string }>) => {
            const { blockId, delta } = action.payload;
            const block = state.streamingThinking.find((b) => b.blockId === blockId);
            if (block) {
                block.content += delta;
            } else {
                state.streamingThinking.push({ blockId, content: delta, elapsedMs: 0, done: false });
            }
        },
        endStreamingThinking: (state, action: PayloadAction<{ blockId: string; elapsedMs: number }>) => {
            const block = state.streamingThinking.find((b) => b.blockId === action.payload.blockId);
            if (!block) return;
            block.done = true;
            block.elapsedMs = action.payload.elapsedMs;
        },
        recordModelCallEnd: (state, action: PayloadAction<StreamingUsage>) => {
            // Tool-loop runs invoke the model repeatedly; accumulate so the
            // live counter reflects the whole reply, not the last segment.
            const prev = state.streamingUsage;
            state.streamingUsage = {
                model: action.payload.model || prev?.model || '',
                inputTokens: (prev?.inputTokens ?? 0) + action.payload.inputTokens,
                outputTokens: (prev?.outputTokens ?? 0) + action.payload.outputTokens,
                cacheReadInputTokens:
                    (prev?.cacheReadInputTokens ?? 0) + action.payload.cacheReadInputTokens,
            };
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
                if (state.streamingThinking.length > 0) {
                    state.thinkingByMessage[assistantMessage.id] = state.streamingThinking.map(
                        (b) => ({ ...b, done: true }),
                    );
                }
            }
            state.streamingContent = '';
            state.streamingThinking = [];
            state.streamingUsage = null;
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
            state.streamingThinking = [];
            state.streamingUsage = null;
            state.streamingToolCalls = [];
            state.pendingConfirmation = null;
            state.activeRunId = null;
            writePersistedRunId(null);
        },
        streamCancelled: (state) => {
            state.isStreaming = false;
            state.error = null;
            state.streamingContent = '';
            state.streamingThinking = [];
            state.streamingUsage = null;
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
                for (const msg of action.payload.messages) {
                    const blocks = parsePersistedThinking(msg.thinkingJson);
                    if (blocks.length > 0) {
                        state.thinkingByMessage[msg.id] = blocks;
                    }
                }
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
            .addCase(retryAgentMessage.fulfilled, (state, action) => {
                const { sessionId, anchorMessageId } = action.payload;
                const list = state.messagesBySession[sessionId];
                if (!list) return;
                const anchor = list.find((m) => m.id === anchorMessageId);
                invalidateAfter(list, anchor?.createdAt, false);
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
    appendStreamingThinking,
    endStreamingThinking,
    recordModelCallEnd,
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
export const selectStreamingThinking = (state: RootState) => state.agentMessages.streamingThinking;
export const selectThinkingByMessage = (state: RootState) => state.agentMessages.thinkingByMessage;
export const selectStreamingUsage = (state: RootState) => state.agentMessages.streamingUsage;
export const selectStreamingToolCalls = (state: RootState) => state.agentMessages.streamingToolCalls;
export const selectIsStreaming = (state: RootState) => state.agentMessages.isStreaming;
export const selectActiveRunId = (state: RootState) => state.agentMessages.activeRunId;
export const selectPendingConfirmation = (state: RootState) => state.agentMessages.pendingConfirmation;
export const selectMessagesLoading = (state: RootState) => state.agentMessages.loading;
export const selectFileMetadataCache = (state: RootState) => state.agentMessages.fileMetadataCache;

export const agentMessagesReducer = agentMessagesSlice.reducer;
