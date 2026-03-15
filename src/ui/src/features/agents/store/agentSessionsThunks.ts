import { createAsyncThunk } from '@reduxjs/toolkit';
import { sessionsApi } from '@/features/agents/api/sessionsApi';
import type { RootState } from '@/app/store';
import type { SessionInfo } from '@/gen/agents/v1/sessions_pb';
import { SessionKind } from '@/gen/agents/v1/sessions_pb';

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

export const sessionToPlain = (session: SessionInfo) => ({
    id: session.id,
    organizationId: session.organizationId,
    agentId: session.agentId,
    userId: session.userId,
    kind: session.kind,
    displayName: session.displayName,
    modelOverride: session.modelOverride,
    totalInputTokens: typeof session.totalInputTokens === 'bigint'
        ? Number(session.totalInputTokens)
        : session.totalInputTokens,
    totalOutputTokens: typeof session.totalOutputTokens === 'bigint'
        ? Number(session.totalOutputTokens)
        : session.totalOutputTokens,
    messageCount: session.messageCount,
    lastModelUsed: session.lastModelUsed,
    isArchived: session.isArchived,
    createdAt: timestampToPlain(session.createdAt),
    updatedAt: timestampToPlain(session.updatedAt),
});

export type SerializedSession = ReturnType<typeof sessionToPlain>;

export const fetchSessions = createAsyncThunk<
    SerializedSession[],
    { includeArchived?: boolean } | void,
    { state: RootState; rejectValue: string }
>('agentSessions/fetchSessions', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await sessionsApi.listSessions({
            organizationId,
            isArchived: params && params.includeArchived ? undefined : false,
        });
        return response.sessions.map(sessionToPlain);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch sessions');
    }
});

export const createSession = createAsyncThunk<
    SerializedSession,
    { agentId: string; displayName?: string; kind?: SessionKind },
    { state: RootState; rejectValue: string }
>('agentSessions/createSession', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await sessionsApi.createSession({
            organizationId,
            agentId: params.agentId,
            kind: params.kind ?? SessionKind.DIRECT,
            displayName: params.displayName,
        });
        if (!response.session) throw new Error('No session in response');
        return sessionToPlain(response.session);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to create session');
    }
});

export const updateSession = createAsyncThunk<
    SerializedSession,
    { sessionId: string; displayName?: string; modelOverride?: string },
    { state: RootState; rejectValue: string }
>('agentSessions/updateSession', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const { sessionId, ...fields } = params;
        const response = await sessionsApi.updateSession({
            organizationId,
            sessionId,
            ...fields,
        });
        if (!response.session) throw new Error('No session in response');
        return sessionToPlain(response.session);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to update session');
    }
});

export const archiveSession = createAsyncThunk<
    string,
    string,
    { state: RootState; rejectValue: string }
>('agentSessions/archiveSession', async (sessionId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        await sessionsApi.archiveSession({ organizationId, sessionId });
        return sessionId;
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to archive session');
    }
});

export interface SessionContextStats {
    totalMessages: number;
    activeMessages: number;
    compactedMessages: number;
    summaryCount: number;
    activeTokens: number;
    tokenBudget: number;
    tokensUntilCompaction: number;
    contextWindowTokens: number;
}

export const fetchSessionContextStats = createAsyncThunk<
    SessionContextStats,
    string,
    { state: RootState; rejectValue: string }
>('agentSessions/fetchContextStats', async (sessionId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await sessionsApi.getSessionContextStats({
            organizationId,
            sessionId,
        });
        return {
            totalMessages: response.totalMessages,
            activeMessages: response.activeMessages,
            compactedMessages: response.compactedMessages,
            summaryCount: response.summaryCount,
            activeTokens: response.activeTokens,
            tokenBudget: response.tokenBudget,
            tokensUntilCompaction: response.tokensUntilCompaction,
            contextWindowTokens: response.contextWindowTokens,
        };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch context stats');
    }
});

export interface CompactionResult {
    compacted: boolean;
    stats: SessionContextStats;
    messagesCompacted: number;
    tokensBefore: number;
    tokensAfter: number;
    tokensSaved: number;
    summaryTokens: number;
}

export const compactSession = createAsyncThunk<
    CompactionResult,
    string,
    { state: RootState; rejectValue: string }
>('agentSessions/compactSession', async (sessionId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await sessionsApi.compactSession({
            organizationId,
            sessionId,
        });
        const stats = response.stats;
        return {
            compacted: response.compacted,
            stats: {
                totalMessages: stats?.totalMessages ?? 0,
                activeMessages: stats?.activeMessages ?? 0,
                compactedMessages: stats?.compactedMessages ?? 0,
                summaryCount: stats?.summaryCount ?? 0,
                activeTokens: stats?.activeTokens ?? 0,
                tokenBudget: stats?.tokenBudget ?? 0,
                tokensUntilCompaction: stats?.tokensUntilCompaction ?? 0,
                contextWindowTokens: stats?.contextWindowTokens ?? 200000,
            },
            messagesCompacted: response.messagesCompacted,
            tokensBefore: response.tokensBefore,
            tokensAfter: response.tokensAfter,
            tokensSaved: response.tokensSaved,
            summaryTokens: response.summaryTokens,
        };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to compact session');
    }
});
