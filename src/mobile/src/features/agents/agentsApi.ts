import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  AgentsService,
  ListAgentsRequestSchema,
  GetAgentRequestSchema,
  ListToolsRequestSchema,
} from "@uniffy/proto/agents/v1/agents_pb";
import {
  ProvidersService,
  ListAvailableModelsRequestSchema,
  ListModelsForKeyRequestSchema,
} from "@uniffy/proto/agents/v1/providers_pb";
import { RuntimeService, RegenerateImageRequestSchema } from "@uniffy/proto/agents/v1/runtime_pb";
import { transport } from "@core/api/transport";
import { IMAGE_RPC_TIMEOUT_MS } from "@core/api/baseFetch";

const client = createClient(AgentsService, transport);
const providersClient = createClient(ProvidersService, transport);
const runtimeClient = createClient(RuntimeService, transport);

export const agentsApi = {
  listAgents: (req: MessageInitShape<typeof ListAgentsRequestSchema>) => client.listAgents(req),
  getAgent: (req: MessageInitShape<typeof GetAgentRequestSchema>) => client.getAgent(req),
  listTools: (req: MessageInitShape<typeof ListToolsRequestSchema>) => client.listTools(req),
};

export const providersApi = {
  listAvailableModels: (req: MessageInitShape<typeof ListAvailableModelsRequestSchema>) =>
    providersClient.listAvailableModels(req),
  listModelsForKey: (req: MessageInitShape<typeof ListModelsForKeyRequestSchema>) =>
    providersClient.listModelsForKey(req),
};

export const runtimeApi = {
  // A re-run of the image tool, not an LLM turn, and it can take minutes.
  regenerateImage: (req: MessageInitShape<typeof RegenerateImageRequestSchema>) =>
    runtimeClient.regenerateImage(req, { timeoutMs: IMAGE_RPC_TIMEOUT_MS }),
};
