import { createSlice } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import type { SerializedSession } from '@/features/agents/store/agentSessionsThunks';
import { createSession } from '@/features/agents/store/agentSessionsThunks';

export const PROMPT_BUILDER_PREFIX = '[prompt-builder] ';

export function isPromptBuilderSession(session: SerializedSession): boolean {
    return session.displayName?.startsWith(PROMPT_BUILDER_PREFIX) ?? false;
}

interface AgentSessionsState {
    sessions: Record<string, SerializedSession>;
}

const initialState: AgentSessionsState = {
    sessions: {},
};

export const agentSessionsSlice = createSlice({
    name: 'agentSessions',
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        builder.addCase(createSession.fulfilled, (state, action) => {
            state.sessions[action.payload.id] = action.payload;
        });
    },
});

export const selectAllSessions = (state: RootState) => state.agentSessions.sessions;

export const agentSessionsReducer = agentSessionsSlice.reducer;
