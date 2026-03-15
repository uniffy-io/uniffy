import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { MemoriesService } from '@/gen/agents/v1/memories_connect';
import type { PartialMessage } from '@bufbuild/protobuf';
import type {
    ListMemoriesRequest,
    CreateMemoryRequest,
    UpdateMemoryRequest,
    DeleteMemoryRequest,
} from '@/gen/agents/v1/memories_pb';

const client = createClient(MemoriesService, transport);

export const memoriesApi = {
    listMemories: async (request: PartialMessage<ListMemoriesRequest>) => {
        return client.listMemories(request);
    },
    createMemory: async (request: PartialMessage<CreateMemoryRequest>) => {
        return client.createMemory(request);
    },
    updateMemory: async (request: PartialMessage<UpdateMemoryRequest>) => {
        return client.updateMemory(request);
    },
    deleteMemory: async (request: PartialMessage<DeleteMemoryRequest>) => {
        return client.deleteMemory(request);
    },
};
