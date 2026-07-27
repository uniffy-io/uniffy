import { describe, expect, it } from 'vitest';
import { MessageRole } from '@uniffy/proto/agents/v1/sessions_pb';
import type { SerializedMessage } from '@/features/agents/store/agentMessagesSerde';
import {
    foldMessageTurns,
    streamingToolCallsToSteps,
    toolActionLabel,
    toolMessagesToSteps,
} from '@/features/agents/utils/messageTurns';

function makeMessage(overrides: Partial<SerializedMessage>): SerializedMessage {
    return {
        id: 'm1',
        sessionId: 's1',
        role: MessageRole.USER,
        content: 'hello',
        inputTokens: 0,
        outputTokens: 0,
        model: undefined,
        toolName: undefined,
        toolCallId: undefined,
        toolArgsJson: undefined,
        toolResult: undefined,
        isThinking: false,
        isCompacted: false,
        createdAt: { seconds: 1, nanos: 0 },
        fileIds: undefined,
        isInvalidated: false,
        editedAt: undefined,
        previousContent: undefined,
        wasCancelled: false,
        feedbackRating: '',
        invokedSkillName: '',
        thinkingJson: '',
        ...overrides,
    };
}

describe('foldMessageTurns', () => {
    it('groups consecutive tool rows into one tools turn', () => {
        const messages = [
            makeMessage({ id: 'u1', role: MessageRole.USER }),
            makeMessage({ id: 't1', role: MessageRole.TOOL, toolName: 'notes.create_note', toolResult: 'ok' }),
            makeMessage({ id: 't2', role: MessageRole.TOOL, toolName: 'notes.get_note', toolResult: 'ok' }),
            makeMessage({ id: 'a1', role: MessageRole.ASSISTANT, content: 'done' }),
        ];
        const turns = foldMessageTurns(messages, {});
        expect(turns.map((t) => t.kind)).toEqual(['user', 'tools', 'assistant']);
        const tools = turns[1];
        if (tools.kind !== 'tools') throw new Error('expected tools turn');
        expect(tools.key).toBe('t1');
        expect(tools.steps.map((s) => s.id)).toEqual(['t1', 't2']);
    });

    it('skips intermediate tool-loop assistant rows that carry a toolCallId', () => {
        const messages = [
            makeMessage({ id: 'a-loop', role: MessageRole.ASSISTANT, toolCallId: 'call-1', content: 'preamble' }),
            makeMessage({ id: 'a-final', role: MessageRole.ASSISTANT, content: 'answer' }),
        ];
        const turns = foldMessageTurns(messages, {});
        expect(turns).toHaveLength(1);
        expect(turns[0].kind).toBe('assistant');
        if (turns[0].kind === 'assistant') {
            expect(turns[0].message.id).toBe('a-final');
        }
    });

    it('attaches persisted thinking blocks to their assistant turn', () => {
        const blocks = [{ blockId: 'b1', content: 'reasoning', elapsedMs: 1200, done: true }];
        const messages = [makeMessage({ id: 'a1', role: MessageRole.ASSISTANT, content: 'answer' })];
        const turns = foldMessageTurns(messages, { a1: blocks });
        if (turns[0].kind !== 'assistant') throw new Error('expected assistant turn');
        expect(turns[0].thinking).toEqual(blocks);
    });
});

describe('toolMessagesToSteps', () => {
    it('marks failure-prefixed results as failed', () => {
        const steps = toolMessagesToSteps([
            makeMessage({ id: 't1', role: MessageRole.TOOL, toolName: 'x.do', toolResult: 'Error: nope' }),
            makeMessage({ id: 't2', role: MessageRole.TOOL, toolName: 'x.do', toolResult: 'Permission denied' }),
            makeMessage({ id: 't3', role: MessageRole.TOOL, toolName: 'x.do', toolResult: 'all good' }),
        ]);
        expect(steps.map((s) => s.status)).toEqual(['failed', 'failed', 'completed']);
    });
});

describe('streamingToolCallsToSteps', () => {
    it('maps pending, failed, and successful calls to statuses', () => {
        const steps = streamingToolCallsToSteps([
            { toolCallId: 'c1', toolName: 'x.do', toolArgsJson: '{}' },
            { toolCallId: 'c2', toolName: 'x.do', toolArgsJson: '{}', result: 'boom', success: false },
            { toolCallId: 'c3', toolName: 'x.do', toolArgsJson: '{}', result: 'ok', success: true },
        ]);
        expect(steps.map((s) => s.status)).toEqual(['running', 'failed', 'completed']);
    });
});

describe('toolActionLabel', () => {
    it('humanizes unknown tool names from their action segment', () => {
        expect(toolActionLabel('files.share_with_group')).toBe('Share With Group');
    });
});
