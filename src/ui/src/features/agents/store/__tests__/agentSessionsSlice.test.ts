import { describe, expect, it } from 'vitest';
import { agentSessionsReducer, isPromptBuilderSession } from '@/features/agents/store/agentSessionsSlice';
import { createSession } from '@/features/agents/store/agentSessionsThunks';
import type { SerializedSession } from '@/features/agents/store/agentSessionsThunks';
import { SessionKind } from '@uniffy/proto/agents/v1/sessions_pb';

function makeSession(overrides: Partial<SerializedSession>): SerializedSession {
    return {
        id: 'sess-1',
        organizationId: 'org-1',
        agentId: 'agent-1',
        userId: 'user-1',
        kind: SessionKind.GROUP,
        displayName: undefined,
        modelOverride: undefined,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        messageCount: 0,
        lastModelUsed: undefined,
        isArchived: false,
        isTest: false,
        createdAt: { seconds: 1, nanos: 0 },
        updatedAt: { seconds: 1, nanos: 0 },
        ...overrides,
    };
}

function created(session: SerializedSession) {
    return agentSessionsReducer(
        undefined,
        createSession.fulfilled(session, 'req-1', { agentId: session.agentId }),
    );
}

describe('agentSessionsSlice createSession.fulfilled', () => {
    it('stores regular sessions', () => {
        const state = created(makeSession({ id: 'regular' }));
        expect(state.sessions.regular).toBeDefined();
    });

    it('stores test sessions', () => {
        const state = created(makeSession({ id: 'test-sess', isTest: true, displayName: '[test] Agent' }));
        expect(state.sessions['test-sess']).toBeDefined();
    });
});

describe('isPromptBuilderSession', () => {
    it('detects the prompt-builder prefix', () => {
        expect(isPromptBuilderSession(makeSession({ displayName: '[prompt-builder] Agent' }))).toBe(true);
        expect(isPromptBuilderSession(makeSession({ displayName: 'Agent chat' }))).toBe(false);
        expect(isPromptBuilderSession(makeSession({ displayName: undefined }))).toBe(false);
    });
});
