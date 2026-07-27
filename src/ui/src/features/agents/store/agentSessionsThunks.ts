import { createAsyncThunk } from '@reduxjs/toolkit';
import { sessionsApi } from '@/features/agents/api/sessionsApi';
import type { RootState } from '@/app/store';
import type { SessionInfo } from '@uniffy/proto/agents/v1/sessions_pb';
import { SessionKind } from '@uniffy/proto/agents/v1/sessions_pb';

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
    isTest: session.isTest,
    createdAt: timestampToPlain(session.createdAt),
    updatedAt: timestampToPlain(session.updatedAt),
});

export type SerializedSession = ReturnType<typeof sessionToPlain>;

export const createSession = createAsyncThunk<
    SerializedSession,
    { agentId: string; displayName?: string; kind?: SessionKind; isTest?: boolean },
    { state: RootState; rejectValue: string }
>('agentSessions/createSession', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await sessionsApi.createSession({
            organizationId,
            agentId: params.agentId,
            kind: params.kind ?? SessionKind.DIRECT,
            displayName: params.displayName,
            isTest: params.isTest ?? false,
        });
        if (!response.session) throw new Error('No session in response');
        return sessionToPlain(response.session);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to create session');
    }
});
