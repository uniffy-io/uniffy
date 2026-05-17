import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import {
    MemoriesService,
    ListMemoriesRequestSchema,
    CreateMemoryRequestSchema,
    UpdateMemoryRequestSchema,
    DeleteMemoryRequestSchema,
} from '@uniffy/proto/agents/v1/memories_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const client = createClient(MemoriesService, unaryTransport);

export const memoriesApi = {
    listMemories: async (request: MessageInitShape<typeof ListMemoriesRequestSchema>) => {
        return client.listMemories(request);
    },
    createMemory: async (request: MessageInitShape<typeof CreateMemoryRequestSchema>) => {
        return client.createMemory(request);
    },
    updateMemory: async (request: MessageInitShape<typeof UpdateMemoryRequestSchema>) => {
        return client.updateMemory(request);
    },
    deleteMemory: async (request: MessageInitShape<typeof DeleteMemoryRequestSchema>) => {
        return client.deleteMemory(request);
    },
};
