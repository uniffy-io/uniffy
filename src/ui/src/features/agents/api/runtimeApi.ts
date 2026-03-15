import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { RuntimeService } from '@/gen/agents/v1/runtime_connect';
import type { PartialMessage } from '@bufbuild/protobuf';
import type { ConfirmationResponse, GetUsageStatsRequest, SendMessageRequest } from '@/gen/agents/v1/runtime_pb';

const client = createClient(RuntimeService, transport);

export const runtimeApi = {
    sendMessage: async (request: PartialMessage<SendMessageRequest>) => {
        return client.sendMessage(request);
    },
    streamSendMessage: (request: PartialMessage<SendMessageRequest>) => {
        return client.streamSendMessage(request);
    },
    respondToConfirmation: async (request: PartialMessage<ConfirmationResponse>) => {
        return client.respondToConfirmation(request);
    },
    getUsageStats: async (request: PartialMessage<GetUsageStatsRequest>) => {
        return client.getUsageStats(request);
    },
};
