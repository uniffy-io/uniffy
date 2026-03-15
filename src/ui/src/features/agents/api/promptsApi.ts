import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { PromptsService } from '@/gen/agents/v1/prompts_connect';
import type { PartialMessage } from '@bufbuild/protobuf';
import type {
    CreatePromptRequest,
    GetPromptRequest,
    ListPromptsRequest,
    UpdatePromptRequest,
    DeletePromptRequest,
} from '@/gen/agents/v1/prompts_pb';

const client = createClient(PromptsService, transport);

export const promptsApi = {
    createPrompt: async (request: PartialMessage<CreatePromptRequest>) => {
        return client.createPrompt(request);
    },
    getPrompt: async (request: PartialMessage<GetPromptRequest>) => {
        return client.getPrompt(request);
    },
    listPrompts: async (request: PartialMessage<ListPromptsRequest>) => {
        return client.listPrompts(request);
    },
    updatePrompt: async (request: PartialMessage<UpdatePromptRequest>) => {
        return client.updatePrompt(request);
    },
    deletePrompt: async (request: PartialMessage<DeletePromptRequest>) => {
        return client.deletePrompt(request);
    },
};
