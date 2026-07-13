import { createClient } from "@connectrpc/connect";
import type { MessageInitShape } from "@bufbuild/protobuf";
import {
  AgentsService,
  ListAgentsRequestSchema,
  GetAgentRequestSchema,
} from "@uniffy/proto/agents/v1/agents_pb";
import { transport } from "@core/api/transport";

const client = createClient(AgentsService, transport);

export const agentsApi = {
  listAgents: (req: MessageInitShape<typeof ListAgentsRequestSchema>) => client.listAgents(req),
  getAgent: (req: MessageInitShape<typeof GetAgentRequestSchema>) => client.getAgent(req),
};
