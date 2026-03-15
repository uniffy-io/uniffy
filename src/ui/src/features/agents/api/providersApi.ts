import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { ProvidersService } from '@/gen/agents/v1/providers_connect';
import type { PartialMessage } from '@bufbuild/protobuf';
import type {
    AddProviderKeyRequest,
    ListProviderKeysRequest,
    RemoveProviderKeyRequest,
    ToggleProviderKeyRequest,
    ValidateProviderKeyRequest,
    ListAvailableModelsRequest,
    ListModelsForKeyRequest,
} from '@/gen/agents/v1/providers_pb';

const client = createClient(ProvidersService, transport);

export const providersApi = {
    addProviderKey: async (request: PartialMessage<AddProviderKeyRequest>) => {
        return client.addProviderKey(request);
    },
    listProviderKeys: async (request: PartialMessage<ListProviderKeysRequest>) => {
        return client.listProviderKeys(request);
    },
    removeProviderKey: async (request: PartialMessage<RemoveProviderKeyRequest>) => {
        return client.removeProviderKey(request);
    },
    validateProviderKey: async (request: PartialMessage<ValidateProviderKeyRequest>) => {
        return client.validateProviderKey(request);
    },
    listAvailableModels: async (request: PartialMessage<ListAvailableModelsRequest>) => {
        return client.listAvailableModels(request);
    },
    toggleProviderKey: async (request: PartialMessage<ToggleProviderKeyRequest>) => {
        return client.toggleProviderKey(request);
    },
    listModelsForKey: async (request: PartialMessage<ListModelsForKeyRequest>) => {
        return client.listModelsForKey(request);
    },
};
