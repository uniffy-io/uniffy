import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { AgentsService } from '@uniffy/proto/agents/v1/agents_connect';
import type { PartialMessage } from '@bufbuild/protobuf';
import type {
    CreateAgentRequest,
    GetAgentRequest,
    ListAgentsRequest,
    UpdateAgentRequest,
    DeleteAgentRequest,
    UploadAgentAvatarRequest,
    DeleteAgentAvatarRequest,
    PreviewSystemPromptRequest,
} from '@uniffy/proto/agents/v1/agents_pb';

const client = createClient(AgentsService, transport);

export const agentsApi = {
    createAgent: async (request: PartialMessage<CreateAgentRequest>) => {
        return client.createAgent(request);
    },
    getAgent: async (request: PartialMessage<GetAgentRequest>) => {
        return client.getAgent(request);
    },
    listAgents: async (request: PartialMessage<ListAgentsRequest>) => {
        return client.listAgents(request);
    },
    updateAgent: async (request: PartialMessage<UpdateAgentRequest>) => {
        return client.updateAgent(request);
    },
    deleteAgent: async (request: PartialMessage<DeleteAgentRequest>) => {
        return client.deleteAgent(request);
    },
    uploadAgentAvatar: async (request: PartialMessage<UploadAgentAvatarRequest>) => {
        return client.uploadAgentAvatar(request);
    },
    deleteAgentAvatar: async (request: PartialMessage<DeleteAgentAvatarRequest>) => {
        return client.deleteAgentAvatar(request);
    },
    previewSystemPrompt: async (request: PartialMessage<PreviewSystemPromptRequest>) => {
        return client.previewSystemPrompt(request);
    },
};
