/**
 * Sessions Redux slice - manages user session list and revocation state.
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import type { PlainMessage } from '@bufbuild/protobuf';
import type { SessionInfo } from '@/gen/auth/v1/auth_pb';
import { sessionsApi } from '@/features/settings/api/sessionsApi';

export interface SessionsState {
    sessions: PlainMessage<SessionInfo>[];
    loading: boolean;
    revoking: string | null; // session_id being revoked
    revokingAll: boolean;
    error: string | null;
}

const initialState: SessionsState = {
    sessions: [],
    loading: false,
    revoking: null,
    revokingAll: false,
    error: null,
};

export const fetchSessions = createAsyncThunk(
    'sessions/fetchSessions',
    async () => {
        const response = await sessionsApi.listSessions();
        return response.sessions.map((s) => ({
            id: s.id,
            userAgent: s.userAgent,
            deviceLabel: s.deviceLabel,
            createdAt: s.createdAt,
            lastActivity: s.lastActivity,
            isCurrent: s.isCurrent,
        }));
    },
);

export const revokeSession = createAsyncThunk(
    'sessions/revokeSession',
    async (sessionId: string) => {
        await sessionsApi.revokeSession(sessionId);
        return sessionId;
    },
);

export const revokeOtherSessions = createAsyncThunk(
    'sessions/revokeOtherSessions',
    async () => {
        const response = await sessionsApi.revokeOtherSessions();
        return response.revokedCount;
    },
);

export const sessionsSlice = createSlice({
    name: 'sessions',
    initialState,
    reducers: {
        clearSessionsError: (state) => {
            state.error = null;
        },
    },
    extraReducers: (builder) => {
        // fetchSessions
        builder.addCase(fetchSessions.pending, (state) => {
            state.loading = true;
            state.error = null;
        });
        builder.addCase(fetchSessions.fulfilled, (state, action) => {
            state.loading = false;
            state.sessions = action.payload;
        });
        builder.addCase(fetchSessions.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message || 'Failed to load sessions';
        });

        // revokeSession
        builder.addCase(revokeSession.pending, (state, action) => {
            state.revoking = action.meta.arg;
            state.error = null;
        });
        builder.addCase(revokeSession.fulfilled, (state, action) => {
            state.revoking = null;
            state.sessions = state.sessions.filter((s) => s.id !== action.payload);
        });
        builder.addCase(revokeSession.rejected, (state, action) => {
            state.revoking = null;
            state.error = action.error.message || 'Failed to revoke session';
        });

        // revokeOtherSessions
        builder.addCase(revokeOtherSessions.pending, (state) => {
            state.revokingAll = true;
            state.error = null;
        });
        builder.addCase(revokeOtherSessions.fulfilled, (state) => {
            state.revokingAll = false;
            state.sessions = state.sessions.filter((s) => s.isCurrent);
        });
        builder.addCase(revokeOtherSessions.rejected, (state, action) => {
            state.revokingAll = false;
            state.error = action.error.message || 'Failed to revoke other sessions';
        });
    },
});

export const { clearSessionsError } = sessionsSlice.actions;

export const sessionsReducer = sessionsSlice.reducer;
