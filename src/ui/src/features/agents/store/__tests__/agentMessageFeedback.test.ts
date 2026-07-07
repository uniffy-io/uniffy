import { describe, expect, it } from 'vitest';
import type { MessageInfo } from '@uniffy/proto/agents/v1/sessions_pb';
import { MessageRole } from '@uniffy/proto/agents/v1/sessions_pb';
import { agentMessagesReducer } from '@/features/agents/store/agentMessagesSlice';
import {
    fetchMessages,
    submitMessageFeedback,
    messageToPlain,
} from '@/features/agents/store/agentMessagesThunks';

const SESSION = 'session-1';

const assistantProto = (over: Partial<MessageInfo> = {}): MessageInfo =>
    ({
        id: 'm1',
        sessionId: SESSION,
        role: MessageRole.ASSISTANT,
        content: 'hi',
        inputTokens: 0,
        outputTokens: 0,
        isThinking: false,
        isCompacted: false,
        fileIds: [],
        isInvalidated: false,
        wasCancelled: false,
        feedbackRating: '',
        ...over,
    }) as unknown as MessageInfo;

describe('messageToPlain feedback', () => {
    it('maps a persisted rating', () => {
        const plain = messageToPlain(assistantProto({ feedbackRating: 'up' } as Partial<MessageInfo>));
        expect(plain.feedbackRating).toBe('up');
    });

    it('defaults to empty when unset', () => {
        const plain = messageToPlain(assistantProto());
        expect(plain.feedbackRating).toBe('');
    });
});

describe('submitMessageFeedback reducer', () => {
    const seeded = () =>
        agentMessagesReducer(
            undefined,
            fetchMessages.fulfilled(
                { sessionId: SESSION, messages: [messageToPlain(assistantProto())] },
                'req',
                { sessionId: SESSION },
            ),
        );

    it('sets the rating on the target message', () => {
        let state = seeded();
        state = agentMessagesReducer(
            state,
            submitMessageFeedback.fulfilled(
                { sessionId: SESSION, messageId: 'm1', rating: 'down' },
                'req',
                { sessionId: SESSION, messageId: 'm1', rating: 'down' },
            ),
        );
        expect(state.messagesBySession[SESSION][0].feedbackRating).toBe('down');
    });

    it('clears the rating when an empty rating is submitted', () => {
        let state = agentMessagesReducer(
            undefined,
            fetchMessages.fulfilled(
                {
                    sessionId: SESSION,
                    messages: [messageToPlain(assistantProto({ feedbackRating: 'up' } as Partial<MessageInfo>))],
                },
                'req',
                { sessionId: SESSION },
            ),
        );
        state = agentMessagesReducer(
            state,
            submitMessageFeedback.fulfilled(
                { sessionId: SESSION, messageId: 'm1', rating: '' },
                'req',
                { sessionId: SESSION, messageId: 'm1', rating: '' },
            ),
        );
        expect(state.messagesBySession[SESSION][0].feedbackRating).toBe('');
    });
});
