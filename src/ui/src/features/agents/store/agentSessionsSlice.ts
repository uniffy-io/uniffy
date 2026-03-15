import { createSelector, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import type { SerializedSession } from '@/features/agents/store/agentSessionsThunks';
import {
    fetchSessions,
    createSession,
    updateSession,
    archiveSession,
    fetchSessionContextStats,
    compactSession,
} from '@/features/agents/store/agentSessionsThunks';
import type { SessionContextStats, CompactionResult } from '@/features/agents/store/agentSessionsThunks';

export const PROMPT_BUILDER_PREFIX = '[prompt-builder] ';

export function isPromptBuilderSession(session: SerializedSession): boolean {
    return session.displayName?.startsWith(PROMPT_BUILDER_PREFIX) ?? false;
}

interface AgentSessionsState {
    sessions: Record<string, SerializedSession>;
    activeSessionId: string | null;
    contextStats: Record<string, SessionContextStats>;
    lastCompactionResult: CompactionResult | null;
    loading: boolean;
    error: string | null;
}

const initialState: AgentSessionsState = {
    sessions: {},
    activeSessionId: null,
    contextStats: {},
    lastCompactionResult: null,
    loading: false,
    error: null,
};

export const agentSessionsSlice = createSlice({
    name: 'agentSessions',
    initialState,
    reducers: {
        setActiveSession: (state, action: PayloadAction<string | null>) => {
            state.activeSessionId = action.payload;
        },
        clearLastCompactionResult: (state) => {
            state.lastCompactionResult = null;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchSessions.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchSessions.fulfilled, (state, action) => {
                state.loading = false;
                state.sessions = {};
                for (const session of action.payload) {
                    state.sessions[session.id] = session;
                }
            })
            .addCase(fetchSessions.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Failed to fetch sessions';
            })
            .addCase(createSession.fulfilled, (state, action) => {
                state.sessions[action.payload.id] = action.payload;
                if (!isPromptBuilderSession(action.payload)) {
                    state.activeSessionId = action.payload.id;
                }
            })
            .addCase(updateSession.fulfilled, (state, action) => {
                state.sessions[action.payload.id] = action.payload;
            })
            .addCase(archiveSession.fulfilled, (state, action) => {
                delete state.sessions[action.payload];
                delete state.contextStats[action.payload];
                if (state.activeSessionId === action.payload) {
                    state.activeSessionId = null;
                }
            })
            .addCase(fetchSessionContextStats.fulfilled, (state, action) => {
                state.contextStats[action.meta.arg] = action.payload;
            })
            .addCase(compactSession.fulfilled, (state, action) => {
                state.contextStats[action.meta.arg] = action.payload.stats;
                state.lastCompactionResult = action.payload;
            });
    },
});

export const { setActiveSession, clearLastCompactionResult } = agentSessionsSlice.actions;

export const selectAllSessions = (state: RootState) => state.agentSessions.sessions;
export const selectActiveSessionId = (state: RootState) => state.agentSessions.activeSessionId;
export const selectActiveSession = (state: RootState) => {
    const id = state.agentSessions.activeSessionId;
    return id ? state.agentSessions.sessions[id] ?? null : null;
};
export const selectSessionsLoading = (state: RootState) => state.agentSessions.loading;

/** Sessions excluding prompt-builder sessions (for ChatView). */
export const selectUserSessions = (state: RootState) => {
    const all = state.agentSessions.sessions;
    const result: Record<string, SerializedSession> = {};
    for (const [id, session] of Object.entries(all)) {
        if (!isPromptBuilderSession(session)) {
            result[id] = session;
        }
    }
    return result;
};

/** Only prompt-builder sessions (for ConversationsView prompt builder section). */
export const selectPromptBuilderSessions = (state: RootState) => {
    const all = state.agentSessions.sessions;
    const result: Record<string, SerializedSession> = {};
    for (const [id, session] of Object.entries(all)) {
        if (isPromptBuilderSession(session)) {
            result[id] = session;
        }
    }
    return result;
};

/** User sessions sorted by updatedAt descending (most recent first). */
export const selectSortedUserSessions = createSelector(
    [selectUserSessions],
    (sessionsMap): SerializedSession[] => {
        return Object.values(sessionsMap).sort((a, b) => {
            const aTime = a.updatedAt?.seconds ?? 0;
            const bTime = b.updatedAt?.seconds ?? 0;
            return bTime - aTime;
        });
    },
);

export const selectContextStats = (sessionId: string | null) => (state: RootState) =>
    sessionId ? state.agentSessions.contextStats[sessionId] ?? null : null;

export const selectLastCompactionResult = (state: RootState) =>
    state.agentSessions.lastCompactionResult;

export const agentSessionsReducer = agentSessionsSlice.reducer;
