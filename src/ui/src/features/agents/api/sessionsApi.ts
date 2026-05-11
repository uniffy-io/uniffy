import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { SessionsService } from '@uniffy/proto/agents/v1/sessions_connect';
import type { PartialMessage } from '@bufbuild/protobuf';
import type {
    CreateSessionRequest,
    GetSessionRequest,
    ListSessionsRequest,
    UpdateSessionRequest,
    ArchiveSessionRequest,
    AddMessageRequest,
    ListMessagesRequest,
    GetSessionContextStatsRequest,
    CompactSessionRequest,
    EditMessageRequest,
    DeleteMessageRequest,
    RetryMessageRequest,
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
    editMessage: async (request: PartialMessage<EditMessageRequest>) => {
        return client.editMessage(request);
    },
    deleteMessage: async (request: PartialMessage<DeleteMessageRequest>) => {
        return client.deleteMessage(request);
    },
    retryMessage: async (request: PartialMessage<RetryMessageRequest>) => {
        return client.retryMessage(request);
    },
};
