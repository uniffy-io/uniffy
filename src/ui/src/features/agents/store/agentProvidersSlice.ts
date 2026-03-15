import { createSlice } from '@reduxjs/toolkit';
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

interface AgentProvidersState {
    providerKeys: Record<string, SerializedProviderKey>;
    availableModels: SerializedModelInfo[];
    modelsPerKey: Record<string, SerializedModelInfo[]>;
    loading: boolean;
    error: string | null;
}

const initialState: AgentProvidersState = {
    providerKeys: {},
    availableModels: [],
    modelsPerKey: {},
    loading: false,
    error: null,
};

export const agentProvidersSlice = createSlice({
    name: 'agentProviders',
    initialState,
    reducers: {},
    extraReducers: (builder) => {
        builder
            .addCase(fetchProviderKeys.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchProviderKeys.fulfilled, (state, action) => {
                state.loading = false;
                state.providerKeys = {};
                for (const key of action.payload) {
                    state.providerKeys[key.id] = key;
                }
            })
            .addCase(fetchProviderKeys.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Failed to fetch provider keys';
            })
            .addCase(addProviderKey.fulfilled, (state, action) => {
                state.providerKeys[action.payload.id] = action.payload;
            })
            .addCase(removeProviderKey.fulfilled, (state, action) => {
                delete state.providerKeys[action.payload];
            })
            .addCase(validateProviderKey.fulfilled, (state, action) => {
                const key = state.providerKeys[action.payload.keyId];
                if (key) {
                    key.isValid = action.payload.isValid;
                    if (action.payload.error) {
                        key.lastError = action.payload.error;
                    }
                }
            })
            .addCase(fetchAvailableModels.fulfilled, (state, action) => {
                state.availableModels = action.payload;
            })
            .addCase(fetchModelsForKey.fulfilled, (state, action) => {
                state.modelsPerKey[action.payload.keyId] = action.payload.models;
            })
            .addCase(toggleProviderKey.fulfilled, (state, action) => {
                state.providerKeys[action.payload.id] = action.payload;
            });
    },
});

export const selectProviderKeys = (state: RootState) => state.agentProviders.providerKeys;
export const selectAvailableModels = (state: RootState) => state.agentProviders.availableModels;
export const selectModelsForKey = (keyId: string) => (state: RootState) =>
    state.agentProviders.modelsPerKey[keyId] ?? [];
export const selectProvidersLoading = (state: RootState) => state.agentProviders.loading;

export const agentProvidersReducer = agentProvidersSlice.reducer;
