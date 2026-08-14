import { createClient } from "@connectrpc/connect";
import { unaryTransport } from "@/config/api";
import {
  AgentsService,
  CreateAgentRequestSchema,
  GetAgentRequestSchema,
  ListAgentsRequestSchema,
  UpdateAgentRequestSchema,
  DeleteAgentRequestSchema,
  RestoreAgentRequestSchema,
  UploadAgentAvatarRequestSchema,
  DeleteAgentAvatarRequestSchema,
  PreviewSystemPromptRequestSchema,
  ListAgentTemplatesRequestSchema,
  ListToolsRequestSchema,
} from "@uniffy/proto/agents/v1/agents_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

const client = createClient(AgentsService, unaryTransport);

export const agentsApi = {
  createAgent: async (request: MessageInitShape<typeof CreateAgentRequestSchema>) => {
    return client.createAgent(request);
  },
  getAgent: async (request: MessageInitShape<typeof GetAgentRequestSchema>) => {
    return client.getAgent(request);
  },
  listAgents: async (request: MessageInitShape<typeof ListAgentsRequestSchema>) => {
    return client.listAgents(request);
  },
  updateAgent: async (request: MessageInitShape<typeof UpdateAgentRequestSchema>) => {
    return client.updateAgent(request);
  },
  deleteAgent: async (request: MessageInitShape<typeof DeleteAgentRequestSchema>) => {
    return client.deleteAgent(request);
  },
  restoreAgent: async (request: MessageInitShape<typeof RestoreAgentRequestSchema>) => {
    return client.restoreAgent(request);
  },
  uploadAgentAvatar: async (request: MessageInitShape<typeof UploadAgentAvatarRequestSchema>) => {
    return client.uploadAgentAvatar(request);
  },
  deleteAgentAvatar: async (request: MessageInitShape<typeof DeleteAgentAvatarRequestSchema>) => {
    return client.deleteAgentAvatar(request);
  },
  previewSystemPrompt: async (
    request: MessageInitShape<typeof PreviewSystemPromptRequestSchema>,
  ) => {
    return client.previewSystemPrompt(request);
  },
  listAgentTemplates: async (request: MessageInitShape<typeof ListAgentTemplatesRequestSchema>) => {
    return client.listAgentTemplates(request);
  },
  listTools: async (request: MessageInitShape<typeof ListToolsRequestSchema>) => {
    return client.listTools(request);
  },
};
