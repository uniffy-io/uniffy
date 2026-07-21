import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  AgentsService,
  ListAgentsRequestSchema,
  GetAgentRequestSchema,
} from "@uniffy/proto/agents/v1/agents_pb";
import {
  ProvidersService,
  ListAvailableModelsRequestSchema,
  ListModelsForKeyRequestSchema,
} from "@uniffy/proto/agents/v1/providers_pb";
import { transport } from "@core/api/transport";

const client = createClient(AgentsService, transport);
const providersClient = createClient(ProvidersService, transport);

export const agentsApi = {
  listAgents: (req: MessageInitShape<typeof ListAgentsRequestSchema>) => client.listAgents(req),
  getAgent: (req: MessageInitShape<typeof GetAgentRequestSchema>) => client.getAgent(req),
};

export const providersApi = {
  listAvailableModels: (req: MessageInitShape<typeof ListAvailableModelsRequestSchema>) =>
    providersClient.listAvailableModels(req),
  listModelsForKey: (req: MessageInitShape<typeof ListModelsForKeyRequestSchema>) =>
    providersClient.listModelsForKey(req),
};
