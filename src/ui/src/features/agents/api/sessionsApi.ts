import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { SessionsService } from '@/gen/agents/v1/sessions_connect';
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
} from '@/gen/agents/v1/sessions_pb';

const client = createClient(SessionsService, transport);

export const sessionsApi = {
    createSession: async (request: PartialMessage<CreateSessionRequest>) => {
        return client.createSession(request);
    },
    getSession: async (request: PartialMessage<GetSessionRequest>) => {
        return client.getSession(request);
    },
    listSessions: async (request: PartialMessage<ListSessionsRequest>) => {
        return client.listSessions(request);
    },
    updateSession: async (request: PartialMessage<UpdateSessionRequest>) => {
        return client.updateSession(request);
    },
    archiveSession: async (request: PartialMessage<ArchiveSessionRequest>) => {
        return client.archiveSession(request);
    },
    addMessage: async (request: PartialMessage<AddMessageRequest>) => {
        return client.addMessage(request);
    },
    listMessages: async (request: PartialMessage<ListMessagesRequest>) => {
        return client.listMessages(request);
    },
    getSessionContextStats: async (request: PartialMessage<GetSessionContextStatsRequest>) => {
        return client.getSessionContextStats(request);
    },
    compactSession: async (request: PartialMessage<CompactSessionRequest>) => {
        return client.compactSession(request);
    },
};
