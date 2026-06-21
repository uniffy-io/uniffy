import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import {
    AddMessageRequestSchema,
    ArchiveSessionRequestSchema,
    CompactSessionRequestSchema,
    CreateSessionRequestSchema,
    DeleteMessageRequestSchema,
    EditMessageRequestSchema,
    GetSessionContextStatsRequestSchema,
    GetSessionRequestSchema,
    ListMessagesRequestSchema,
    ListSessionsRequestSchema,
    RetryMessageRequestSchema,
    SessionsService,
    SubmitMessageFeedbackRequestSchema,
    UpdateSessionRequestSchema,
} from '@uniffy/proto/agents/v1/sessions_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const client = createClient(SessionsService, unaryTransport);

export const sessionsApi = {
    createSession: async (request: MessageInitShape<typeof CreateSessionRequestSchema>) => {
        return client.createSession(request);
    },
    getSession: async (request: MessageInitShape<typeof GetSessionRequestSchema>) => {
        return client.getSession(request);
    },
    listSessions: async (request: MessageInitShape<typeof ListSessionsRequestSchema>) => {
        return client.listSessions(request);
    },
    updateSession: async (request: MessageInitShape<typeof UpdateSessionRequestSchema>) => {
        return client.updateSession(request);
    },
    archiveSession: async (request: MessageInitShape<typeof ArchiveSessionRequestSchema>) => {
        return client.archiveSession(request);
    },
    addMessage: async (request: MessageInitShape<typeof AddMessageRequestSchema>) => {
        return client.addMessage(request);
    },
    listMessages: async (request: MessageInitShape<typeof ListMessagesRequestSchema>) => {
        return client.listMessages(request);
    },
    getSessionContextStats: async (request: MessageInitShape<typeof GetSessionContextStatsRequestSchema>) => {
        return client.getSessionContextStats(request);
    },
    compactSession: async (request: MessageInitShape<typeof CompactSessionRequestSchema>) => {
        return client.compactSession(request);
    },
    editMessage: async (request: MessageInitShape<typeof EditMessageRequestSchema>) => {
        return client.editMessage(request);
    },
    deleteMessage: async (request: MessageInitShape<typeof DeleteMessageRequestSchema>) => {
        return client.deleteMessage(request);
    },
    retryMessage: async (request: MessageInitShape<typeof RetryMessageRequestSchema>) => {
        return client.retryMessage(request);
    },
    submitMessageFeedback: async (
        request: MessageInitShape<typeof SubmitMessageFeedbackRequestSchema>,
    ) => {
        return client.submitMessageFeedback(request);
    },
};
