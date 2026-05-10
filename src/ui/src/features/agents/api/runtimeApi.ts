import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { RuntimeService } from '@uniffy/proto/agents/v1/runtime_connect';
import type { PartialMessage } from '@bufbuild/protobuf';
import type { RespondToConfirmationRequest, GetUsageStatsRequest, SendMessageRequest, SubscribeToRunRequest } from '@uniffy/proto/agents/v1/runtime_pb';

const client = createClient(RuntimeService, transport);

export const runtimeApi = {
    sendMessage: async (request: PartialMessage<SendMessageRequest>) => {
        return client.sendMessage(request);
    },
    streamSendMessage: (request: PartialMessage<SendMessageRequest>) => {
        return client.streamSendMessage(request);
    },
    subscribeToRun: (request: PartialMessage<SubscribeToRunRequest>, options?: { signal?: AbortSignal }) => {
        return client.subscribeToRun(request, options);
    },
    respondToConfirmation: async (request: PartialMessage<RespondToConfirmationRequest>) => {
        return client.respondToConfirmation(request);
    },
    getUsageStats: async (request: PartialMessage<GetUsageStatsRequest>) => {
        return client.getUsageStats(request);
    },
};
