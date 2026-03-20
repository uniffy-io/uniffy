import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { PresenceService } from '@uniffy/proto/presence/v1/presence_connect';
import type {
    SetPresenceRequest,
    GetBulkPresenceRequest,
    SetCustomStatusRequest,
    ClearCustomStatusRequest,
} from '@uniffy/proto/presence/v1/presence_pb';
import type { PartialMessage } from '@bufbuild/protobuf';

const presenceClient = createClient(PresenceService, transport);

export const presenceApi = {
    setPresence: async (request: PartialMessage<SetPresenceRequest>) => {
        return presenceClient.setPresence(request);
    },
    getBulkPresence: async (request: PartialMessage<GetBulkPresenceRequest>) => {
        return presenceClient.getBulkPresence(request);
    },
    setCustomStatus: async (request: PartialMessage<SetCustomStatusRequest>) => {
        return presenceClient.setCustomStatus(request);
    },
    clearCustomStatus: async (request: PartialMessage<ClearCustomStatusRequest>) => {
        return presenceClient.clearCustomStatus(request);
    },
};
