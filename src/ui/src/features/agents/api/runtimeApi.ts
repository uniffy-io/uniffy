import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import {
    RuntimeService,
    RespondToConfirmationRequestSchema,
    GetUsageStatsRequestSchema,
    SendMessageRequestSchema,
    StreamSendMessageRequestSchema,
    SubscribeToRunRequestSchema,
} from '@uniffy/proto/agents/v1/runtime_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

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
    respondToConfirmation: async (request: MessageInitShape<typeof RespondToConfirmationRequestSchema>) => {
        return client.respondToConfirmation(request);
    },
    getUsageStats: async (request: MessageInitShape<typeof GetUsageStatsRequestSchema>) => {
        return client.getUsageStats(request);
    },
};
