import { createAsyncThunk } from '@reduxjs/toolkit';
import { providersApi } from '@/features/agents/api/providersApi';
import type { RootState } from '@/app/store';
import type { ProviderKeyInfo, ModelInfo } from '@uniffy/proto/agents/v1/providers_pb';
import type { CredentialType } from '@uniffy/proto/agents/v1/providers_pb';

const getOrganizationId = (state: RootState): string => {
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) throw new Error('No organization selected');
    return orgId;
};

const timestampToPlain = (ts?: { seconds: bigint | number; nanos: bigint | number }) => {
    if (!ts) return undefined;
    return {
        seconds: typeof ts.seconds === 'bigint' ? Number(ts.seconds) : ts.seconds,
        nanos: typeof ts.nanos === 'bigint' ? Number(ts.nanos) : ts.nanos,
    };
};

export const providerKeyToPlain = (key: ProviderKeyInfo) => ({
    id: key.id,
    provider: key.provider,
    credentialType: key.credentialType,
    label: key.label,
    keyHint: key.keyHint,
    isValid: key.isValid,
    isEnabled: key.isEnabled,
    lastValidatedAt: timestampToPlain(key.lastValidatedAt),
    lastUsedAt: timestampToPlain(key.lastUsedAt),
    lastError: key.lastError,
    createdAt: timestampToPlain(key.createdAt),
    updatedAt: timestampToPlain(key.updatedAt),
    createdBy: key.createdBy,
    accessMode: key.accessMode,
    baselineRole: key.baselineRole,
});

export type SerializedProviderKey = ReturnType<typeof providerKeyToPlain>;

export const modelInfoToPlain = (model: ModelInfo) => ({
    id: model.id,
    displayName: model.displayName,
    provider: model.provider,
    contextWindow: model.contextWindow,
    supportsTools: model.supportsTools,
    supportsVision: model.supportsVision,
    supportsThinking: model.supportsThinking,
});

export type SerializedModelInfo = ReturnType<typeof modelInfoToPlain>;

export const fetchProviderKeys = createAsyncThunk<
    SerializedProviderKey[],
    void,
    { state: RootState; rejectValue: string }
>('agentProviders/fetchProviderKeys', async (_, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await providersApi.listProviderKeys({ organizationId });
        return response.keys.map(providerKeyToPlain);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch provider keys');
    }
});

export const addProviderKey = createAsyncThunk<
    SerializedProviderKey,
    { provider: string; credentialType: CredentialType; label: string; credential: string; accessMode?: number; baselineRole?: number },
    { state: RootState; rejectValue: string }
>('agentProviders/addProviderKey', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await providersApi.addProviderKey({
            organizationId,
            ...params,
        });
        if (!response.key) throw new Error('No key in response');
        return providerKeyToPlain(response.key);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to add provider key');
    }
});

export const removeProviderKey = createAsyncThunk<
    string,
    string,
    { state: RootState; rejectValue: string }
>('agentProviders/removeProviderKey', async (keyId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        await providersApi.removeProviderKey({ organizationId, keyId });
        return keyId;
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to remove provider key');
    }
});

export const validateProviderKey = createAsyncThunk<
    { keyId: string; isValid: boolean; error?: string },
    string,
    { state: RootState; rejectValue: string }
>('agentProviders/validateProviderKey', async (keyId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await providersApi.validateProviderKey({ organizationId, keyId });
        return { keyId, isValid: response.isValid, error: response.error };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to validate provider key');
    }
});

export const fetchAvailableModels = createAsyncThunk<
    SerializedModelInfo[],
    { provider?: string; forceRefresh?: boolean } | void,
    { state: RootState; rejectValue: string }
>('agentProviders/fetchAvailableModels', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await providersApi.listAvailableModels({
            organizationId,
            provider: params?.provider,
            forceRefresh: params?.forceRefresh ?? false,
        });
        return response.models.map(modelInfoToPlain);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch available models');
    }
});

export const fetchModelsForKey = createAsyncThunk<
    { keyId: string; models: SerializedModelInfo[] },
    { keyId: string; forceRefresh?: boolean },
    { state: RootState; rejectValue: string }
>('agentProviders/fetchModelsForKey', async ({ keyId, forceRefresh }, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await providersApi.listModelsForKey({
            organizationId,
            keyId,
            forceRefresh: forceRefresh ?? false,
        });
        return { keyId, models: response.models.map(modelInfoToPlain) };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch models for key');
    }
});

export const toggleProviderKey = createAsyncThunk<
    SerializedProviderKey,
    { keyId: string; enabled: boolean },
    { state: RootState; rejectValue: string }
>('agentProviders/toggleProviderKey', async ({ keyId, enabled }, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await providersApi.toggleProviderKey({ organizationId, keyId, enabled });
        if (!response.key) throw new Error('No key in response');
        return providerKeyToPlain(response.key);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to toggle provider key');
    }
});
