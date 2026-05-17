import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import {
    PromptsService,
    CreatePromptRequestSchema,
    GetPromptRequestSchema,
    ListPromptsRequestSchema,
    UpdatePromptRequestSchema,
    DeletePromptRequestSchema,
} from '@uniffy/proto/agents/v1/prompts_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

const client = createClient(PromptsService, unaryTransport);

export const promptsApi = {
    createPrompt: async (request: MessageInitShape<typeof CreatePromptRequestSchema>) => {
        return client.createPrompt(request);
    },
    getPrompt: async (request: MessageInitShape<typeof GetPromptRequestSchema>) => {
        return client.getPrompt(request);
    },
    listPrompts: async (request: MessageInitShape<typeof ListPromptsRequestSchema>) => {
        return client.listPrompts(request);
    },
    updatePrompt: async (request: MessageInitShape<typeof UpdatePromptRequestSchema>) => {
        return client.updatePrompt(request);
    },
    deletePrompt: async (request: MessageInitShape<typeof DeletePromptRequestSchema>) => {
        return client.deletePrompt(request);
    },
};
