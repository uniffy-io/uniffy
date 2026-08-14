import { createClient } from "@connectrpc/connect";
import { unaryTransport } from "@/config/api";
import {
  IntegrationsService,
  AddConnectionRequestSchema,
  ListConnectionsRequestSchema,
  ListIntegrationProvidersRequestSchema,
  RemoveConnectionRequestSchema,
  ToggleConnectionRequestSchema,
  UpdateConnectionRequestSchema,
  ValidateConnectionRequestSchema,
} from "@uniffy/proto/integrations/v1/integrations_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

const client = createClient(IntegrationsService, unaryTransport);

export const integrationsApi = {
  listIntegrationProviders: async (
    request: MessageInitShape<typeof ListIntegrationProvidersRequestSchema>,
  ) => {
    return client.listIntegrationProviders(request);
  },
  listConnections: async (request: MessageInitShape<typeof ListConnectionsRequestSchema>) => {
    return client.listConnections(request);
  },
  addConnection: async (request: MessageInitShape<typeof AddConnectionRequestSchema>) => {
    return client.addConnection(request);
  },
  updateConnection: async (request: MessageInitShape<typeof UpdateConnectionRequestSchema>) => {
    return client.updateConnection(request);
  },
  removeConnection: async (request: MessageInitShape<typeof RemoveConnectionRequestSchema>) => {
    return client.removeConnection(request);
  },
  validateConnection: async (request: MessageInitShape<typeof ValidateConnectionRequestSchema>) => {
    return client.validateConnection(request);
  },
  toggleConnection: async (request: MessageInitShape<typeof ToggleConnectionRequestSchema>) => {
    return client.toggleConnection(request);
  },
};
