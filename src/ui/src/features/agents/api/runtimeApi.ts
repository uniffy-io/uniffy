import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { RuntimeService } from '@uniffy/proto/agents/v1/runtime_connect';
import type { PartialMessage } from '@bufbuild/protobuf';
import type {
    CancelStreamRequest,
    GetUsageStatsRequest,
    RespondToConfirmationRequest,
    SendMessageRequest,
    SubscribeToRunRequest,
} from '@uniffy/proto/agents/v1/runtime_pb';

const client = createClient(RuntimeService, transport);

export const runtimeApi = {
    sendMessage: async (request: MessageInitShape<typeof SendMessageRequestSchema>) => {
        return client.sendMessage(request);
    },
    streamSendMessage: (request: MessageInitShape<typeof StreamSendMessageRequestSchema>) => {
        return client.streamSendMessage(request);
    },
    subscribeToRun: (request: MessageInitShape<typeof SubscribeToRunRequestSchema>, options?: { signal?: AbortSignal }) => {
        return client.subscribeToRun(request, options);
    },
    cancelStream: async (request: PartialMessage<CancelStreamRequest>) => {
        return client.cancelStream(request);
    },
    respondToConfirmation: async (request: PartialMessage<RespondToConfirmationRequest>) => {
        return client.respondToConfirmation(request);
    },
    getUsageStats: async (request: MessageInitShape<typeof GetUsageStatsRequestSchema>) => {
        return client.getUsageStats(request);
    },
};
