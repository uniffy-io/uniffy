import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import { PresenceService, ClearCustomStatusRequestSchema, GetBulkPresenceRequestSchema, SetCustomStatusRequestSchema, SetPresenceRequestSchema } from '@uniffy/proto/presence/v1/presence_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const presenceClient = createClient(PresenceService, unaryTransport);

export const presenceApi = {
    setPresence: async (request: MessageInitShape<typeof SetPresenceRequestSchema>) => {
        return presenceClient.setPresence(request);
    },
    getBulkPresence: async (request: MessageInitShape<typeof GetBulkPresenceRequestSchema>) => {
        return presenceClient.getBulkPresence(request);
    },
    setCustomStatus: async (request: MessageInitShape<typeof SetCustomStatusRequestSchema>) => {
        return presenceClient.setCustomStatus(request);
    },
    clearCustomStatus: async (request: MessageInitShape<typeof ClearCustomStatusRequestSchema>) => {
        return presenceClient.clearCustomStatus(request);
    },
};
