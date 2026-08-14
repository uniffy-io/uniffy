import { createClient } from "@connectrpc/connect";
import { unaryTransport } from "@/config/api";
import {
  ProvidersService,
  AddProviderKeyRequestSchema,
  ListProviderKeysRequestSchema,
  RemoveProviderKeyRequestSchema,
  ToggleProviderKeyRequestSchema,
  ValidateProviderKeyRequestSchema,
  ListAvailableModelsRequestSchema,
  ListModelsForKeyRequestSchema,
} from "@uniffy/proto/agents/v1/providers_pb";
import type { MessageInitShape } from "@bufbuild/protobuf";

const client = createClient(ProvidersService, unaryTransport);

export const providersApi = {
  addProviderKey: async (request: MessageInitShape<typeof AddProviderKeyRequestSchema>) => {
    return client.addProviderKey(request);
  },
  listProviderKeys: async (request: MessageInitShape<typeof ListProviderKeysRequestSchema>) => {
    return client.listProviderKeys(request);
  },
  removeProviderKey: async (request: MessageInitShape<typeof RemoveProviderKeyRequestSchema>) => {
    return client.removeProviderKey(request);
  },
  validateProviderKey: async (
    request: MessageInitShape<typeof ValidateProviderKeyRequestSchema>,
  ) => {
    return client.validateProviderKey(request);
  },
  listAvailableModels: async (
    request: MessageInitShape<typeof ListAvailableModelsRequestSchema>,
  ) => {
    return client.listAvailableModels(request);
  },
  toggleProviderKey: async (request: MessageInitShape<typeof ToggleProviderKeyRequestSchema>) => {
    return client.toggleProviderKey(request);
  },
  listModelsForKey: async (request: MessageInitShape<typeof ListModelsForKeyRequestSchema>) => {
    return client.listModelsForKey(request);
  },
};
