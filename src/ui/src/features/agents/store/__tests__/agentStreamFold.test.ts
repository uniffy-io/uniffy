import { describe, expect, it, vi } from 'vitest';
import type { UnknownAction } from '@reduxjs/toolkit';
import type { AgentStreamEvent } from '@uniffy/proto/agents/v1/runtime_pb';
import { createAgentStreamConsumer } from '@/features/agents/store/agentStreamFold';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

type Recorded = { actions: UnknownAction[]; dispatch: (a: UnknownAction) => UnknownAction };

function recorder(): Recorded {
    const actions: UnknownAction[] = [];
    return {
        actions,
        dispatch: (action: UnknownAction) => {
            actions.push(action);
            return action;
        },
    };
}

function envelope(eventCase: string, value: Record<string, unknown>, runId = '') {
    return {
        event: { runId, event: { case: eventCase, value } } as unknown as AgentStreamEvent,
    };
}

const SESSION = 'session-1';

describe('createAgentStreamConsumer', () => {
    it('folds text deltas into appendStreamingToken', () => {
        const rec = recorder();
        const consumer = createAgentStreamConsumer(rec.dispatch as never, SESSION);
        consumer.handle(envelope('textBlockDelta', { blockId: 'x1', delta: 'Hel', sequence: 1 }));
        consumer.handle(envelope('textBlockDelta', { blockId: 'x1', delta: 'lo', sequence: 2 }));
        consumer.dispose();
        const tokens = rec.actions.filter((a) => a.type === 'agentMessages/appendStreamingToken');
        expect(tokens.map((a) => a.payload).join('')).toBe('Hello');
    });

    it('folds thinking deltas per block and ends with elapsed', () => {
        const rec = recorder();
        const consumer = createAgentStreamConsumer(rec.dispatch as never, SESSION);
        consumer.handle(envelope('thinkingBlockDelta', { blockId: 't1', delta: 'pondering ' }));
        consumer.handle(envelope('thinkingBlockDelta', { blockId: 't1', delta: 'deeply' }));
        consumer.handle(envelope('thinkingBlockEnd', { blockId: 't1', elapsedMs: 3200 }));
        consumer.dispose();
        const deltas = rec.actions.filter((a) => a.type === 'agentMessages/appendStreamingThinking');
        expect(
            deltas
                .map((a) => (a.payload as { delta: string }).delta)
                .join(''),
        ).toBe('pondering deeply');
        const end = rec.actions.find((a) => a.type === 'agentMessages/endStreamingThinking');
        expect(end?.payload).toEqual({ blockId: 't1', elapsedMs: 3200 });
        // Buffered deltas must land before the end marker.
        expect(rec.actions.indexOf(deltas[0])).toBeLessThan(rec.actions.indexOf(end!));
    });

    it('converts bigint usage on modelCallEnd', () => {
        const rec = recorder();
        const consumer = createAgentStreamConsumer(rec.dispatch as never, SESSION);
        consumer.handle(envelope('modelCallEnd', {
            model: 'claude-sonnet-4-6',
            inputTokens: 10n,
            outputTokens: 5n,
            cacheCreationInputTokens: 4n,
            cacheReadInputTokens: 3n,
            thinkingTokens: 0n,
        }));
        consumer.dispose();
        const usage = rec.actions.find((a) => a.type === 'agentMessages/recordModelCallEnd');
        expect(usage?.payload).toEqual({
            model: 'claude-sonnet-4-6',
            inputTokens: 10,
            outputTokens: 5,
            cacheCreationInputTokens: 4,
            cacheReadInputTokens: 3,
        });
    });

    it('maps tool result start/end to tool card actions', () => {
        const rec = recorder();
        const consumer = createAgentStreamConsumer(rec.dispatch as never, SESSION);
        consumer.handle(envelope('toolResultStart', {
            toolCallId: 'tc_1',
            toolName: 'notes.read_note',
            toolArgsJson: '{"note_id": "n1"}',
        }));
        consumer.handle(envelope('toolResultEnd', {
            toolCallId: 'tc_1',
            toolName: 'notes.read_note',
            success: true,
            result: 'note text',
        }));
        consumer.dispose();
        const call = rec.actions.find((a) => a.type === 'agentMessages/addStreamingToolCall');
        const result = rec.actions.find((a) => a.type === 'agentMessages/addStreamingToolResult');
        expect((call?.payload as { toolArgsJson: string }).toolArgsJson).toBe('{"note_id": "n1"}');
        expect((result?.payload as { success: boolean }).success).toBe(true);
    });

    it('returns done outcome and flushes pending text first', () => {
        const rec = recorder();
        const consumer = createAgentStreamConsumer(rec.dispatch as never, SESSION);
        consumer.handle(envelope('textBlockDelta', { blockId: 'x1', delta: 'partial' }));
        const outcome = consumer.handle(envelope('done', { modelUsed: 'm' }));
        expect(outcome).toEqual({ status: 'done' });
        const types = rec.actions.map((a) => a.type);
        expect(types.indexOf('agentMessages/appendStreamingToken')).toBeLessThan(
            types.indexOf('agentMessages/streamCompleted'),
        );
    });

    it('maps cancelled error to streamCancelled outcome', () => {
        const rec = recorder();
        const consumer = createAgentStreamConsumer(rec.dispatch as never, SESSION);
        const outcome = consumer.handle(envelope('error', { message: 'cancelled' }));
        expect(outcome).toEqual({ status: 'cancelled' });
        expect(rec.actions.some((a) => a.type === 'agentMessages/streamCancelled')).toBe(true);
    });

    it('returns error outcome with the message', () => {
        const rec = recorder();
        const consumer = createAgentStreamConsumer(rec.dispatch as never, SESSION);
        const outcome = consumer.handle(envelope('error', { message: 'boom' }));
        expect(outcome).toEqual({ status: 'error', errorMessage: 'boom' });
    });

    it('ignores framing-only events', () => {
        const rec = recorder();
        const consumer = createAgentStreamConsumer(rec.dispatch as never, SESSION);
        consumer.handle(envelope('replyStart', { role: 'assistant' }));
        consumer.handle(envelope('modelCallStart', { model: 'm' }));
        consumer.handle(envelope('textBlockStart', { blockId: 'x1' }));
        consumer.handle(envelope('toolCallDelta', { blockId: 'c1', delta: '{"a"' }));
        consumer.handle(envelope('exceedMaxIters', {}));
        consumer.dispose();
        expect(rec.actions).toHaveLength(0);
    });

    it('stamps run id from the envelope', () => {
        const rec = recorder();
        const consumer = createAgentStreamConsumer(rec.dispatch as never, SESSION);
        consumer.handle(envelope('modelCallStart', { model: 'm' }, 'run-42'));
        consumer.dispose();
        const runId = rec.actions.find((a) => a.type === 'agentMessages/runIdReceived');
        expect(runId?.payload).toBe('run-42');
    });
});
