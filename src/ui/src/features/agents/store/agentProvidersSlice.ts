import { createSelector, createSlice } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import type { SerializedProviderKey, SerializedModelInfo } from '@/features/agents/store/agentProvidersThunks';
import {
    fetchProviderKeys,
    addProviderKey,
    removeProviderKey,
    validateProviderKey,
    fetchAvailableModels,
    fetchModelsForKey,
    toggleProviderKey,
} from '@/features/agents/store/agentProvidersThunks';

type LoadStatus = 'idle' | 'loading' | 'loaded';

interface AgentProvidersState {
    /** Org the cached rows belong to; a switch invalidates everything below. */
    organizationId: string | null;
    providerKeys: Record<string, SerializedProviderKey>;
    keysStatus: LoadStatus;
    availableModels: SerializedModelInfo[];
    modelsStatus: LoadStatus;
    /** Models are a per-provider catalog, so one entry serves every key of that provider. */
    modelsByProvider: Record<string, SerializedModelInfo[]>;
    providerByKeyId: Record<string, string>;
    pendingKeyIds: string[];
    error: string | null;
}

const initialState: AgentProvidersState = {
    organizationId: null,
    providerKeys: {},
    keysStatus: 'idle',
    availableModels: [],
    modelsStatus: 'idle',
    modelsByProvider: {},
    providerByKeyId: {},
    pendingKeyIds: [],
    error: null,
};

const adoptOrganization = (state: AgentProvidersState, organizationId: string): void => {
    if (state.organizationId === organizationId) return;
    state.organizationId = organizationId;
    state.providerKeys = {};
    state.keysStatus = 'idle';
    state.availableModels = [];
    state.modelsStatus = 'idle';
    state.modelsByProvider = {};
    state.providerByKeyId = {};
    state.pendingKeyIds = [];
};

const indexModelsByProvider = (
    state: AgentProvidersState,
    models: SerializedModelInfo[],
): void => {
    const grouped: Record<string, SerializedModelInfo[]> = {};
    for (const model of models) {
        (grouped[model.provider] ??= []).push(model);
    }
    Object.assign(state.modelsByProvider, grouped);
};

export const agentProvidersSlice = createSlice({
    name: 'agentProviders',
    initialState,
    reducers: {
        clearAgentProviders: () => initialState,
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchProviderKeys.pending, (state) => {
                state.keysStatus = 'loading';
                state.error = null;
            })
            .addCase(fetchProviderKeys.fulfilled, (state, action) => {
                adoptOrganization(state, action.payload.organizationId);
                state.keysStatus = 'loaded';
                state.providerKeys = {};
                for (const key of action.payload.keys) {
                    state.providerKeys[key.id] = key;
                    state.providerByKeyId[key.id] = key.provider;
                }
            })
            .addCase(fetchProviderKeys.rejected, (state, action) => {
                state.keysStatus = 'idle';
                state.error = action.payload ?? 'Failed to fetch provider keys';
            })
            .addCase(addProviderKey.fulfilled, (state, action) => {
                state.providerKeys[action.payload.id] = action.payload;
                state.providerByKeyId[action.payload.id] = action.payload.provider;
                state.modelsStatus = 'idle';
            })
            .addCase(removeProviderKey.fulfilled, (state, action) => {
                delete state.providerKeys[action.payload];
                delete state.providerByKeyId[action.payload];
                state.modelsStatus = 'idle';
            })
            .addCase(validateProviderKey.fulfilled, (state, action) => {
                const key = state.providerKeys[action.payload.keyId];
                if (key) {
                    key.isValid = action.payload.isValid;
                    if (action.payload.error) {
                        key.lastError = action.payload.error;
                    }
                }
                state.modelsStatus = 'idle';
            })
            .addCase(fetchAvailableModels.pending, (state) => {
                state.modelsStatus = 'loading';
            })
            .addCase(fetchAvailableModels.fulfilled, (state, action) => {
                adoptOrganization(state, action.payload.organizationId);
                state.modelsStatus = 'loaded';
                state.availableModels = action.payload.models;
                indexModelsByProvider(state, action.payload.models);
            })
            .addCase(fetchAvailableModels.rejected, (state) => {
                state.modelsStatus = 'idle';
            })
            .addCase(fetchModelsForKey.pending, (state, action) => {
                state.pendingKeyIds.push(action.meta.arg.keyId);
            })
            .addCase(fetchModelsForKey.fulfilled, (state, action) => {
                const { organizationId, keyId, models } = action.payload;
                adoptOrganization(state, organizationId);
                state.pendingKeyIds = state.pendingKeyIds.filter((id) => id !== keyId);
                indexModelsByProvider(state, models);
                const provider = models[0]?.provider ?? state.providerKeys[keyId]?.provider;
                if (provider) {
                    state.providerByKeyId[keyId] = provider;
                    state.modelsByProvider[provider] ??= [];
                }
            })
            .addCase(fetchModelsForKey.rejected, (state, action) => {
                state.pendingKeyIds = state.pendingKeyIds.filter(
                    (id) => id !== action.meta.arg.keyId,
                );
            })
            .addCase(toggleProviderKey.fulfilled, (state, action) => {
                state.providerKeys[action.payload.id] = action.payload;
                state.providerByKeyId[action.payload.id] = action.payload.provider;
                state.modelsStatus = 'idle';
            });
    },
});

export const { clearAgentProviders } = agentProvidersSlice.actions;

export const selectProviderKeys = (state: RootState) => state.agentProviders.providerKeys;
export const selectAvailableModels = (state: RootState) => state.agentProviders.availableModels;

/** True once ListKeys answered, so callers can tell "no keys" from "not asked yet". */
export const selectProviderKeysLoaded = (state: RootState) =>
    state.agentProviders.keysStatus === 'loaded';

/** Keys an agent can actually run on: enabled and passing the last live probe. */
export const selectUsableProviderKeys = createSelector(
    [selectProviderKeys],
    (keys) => Object.values(keys).filter((key) => key.isValid && key.isEnabled),
);

export const selectModelsByProvider = (state: RootState) => state.agentProviders.modelsByProvider;

const EMPTY_MODELS: SerializedModelInfo[] = [];

export const selectModelsForKey = (keyId: string) => (state: RootState) => {
    const provider = state.agentProviders.providerByKeyId[keyId];
    if (!provider) return EMPTY_MODELS;
    return state.agentProviders.modelsByProvider[provider] ?? EMPTY_MODELS;
};

/** True while the list backing this key is still on the wire, so pickers can say so. */
export const selectModelsLoadingForKey = (keyId: string) => (state: RootState) => {
    const providers = state.agentProviders;
    if (providers.pendingKeyIds.includes(keyId)) return true;
    const provider = keyId ? providers.providerByKeyId[keyId] : null;
    if (provider && providers.modelsByProvider[provider] !== undefined) return false;
    return providers.modelsStatus === 'loading' || providers.keysStatus === 'loading';
};

export const selectProvidersLoading = (state: RootState) =>
    state.agentProviders.keysStatus === 'loading';

export const agentProvidersReducer = agentProvidersSlice.reducer;
