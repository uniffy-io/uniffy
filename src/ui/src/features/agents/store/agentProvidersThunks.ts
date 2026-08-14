import { createAsyncThunk } from "@reduxjs/toolkit";
import { providersApi } from "@/features/agents/api/providersApi";
import type { RootState } from "@/app/store";
import type { ProviderKeyInfo, ModelInfo } from "@uniffy/proto/agents/v1/providers_pb";

const getOrganizationId = (state: RootState): string => {
  const orgId = state.auth.currentOrganizationId;
  if (!orgId) throw new Error("No organization selected");
  return orgId;
};

/** A fetch is redundant only when the cached data belongs to the current org. */
const isCachedForCurrentOrg = (state: RootState): boolean =>
  state.agentProviders.organizationId !== null &&
  state.agentProviders.organizationId === state.auth.currentOrganizationId;

const timestampToPlain = (ts?: { seconds: bigint | number; nanos: bigint | number }) => {
  if (!ts) return undefined;
  return {
    seconds: typeof ts.seconds === "bigint" ? Number(ts.seconds) : ts.seconds,
    nanos: typeof ts.nanos === "bigint" ? Number(ts.nanos) : ts.nanos,
  };
};

export const providerKeyToPlain = (key: ProviderKeyInfo) => ({
  id: key.id,
  provider: key.provider,
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
  supportsImageGeneration: model.supportsImageGeneration,
  catalogKnown: model.catalogKnown,
  parameterSchemaJson: model.parameterSchemaJson,
  imageParameterSchemaJson: model.imageParameterSchemaJson,
  imagePriceEstimatesJson: model.imagePriceEstimatesJson,
});

export type SerializedModelInfo = ReturnType<typeof modelInfoToPlain>;

export const fetchProviderKeys = createAsyncThunk<
  { organizationId: string; keys: SerializedProviderKey[] },
  { force?: boolean } | void,
  { state: RootState; rejectValue: string }
>(
  "agentProviders/fetchProviderKeys",
  async (_, { getState, rejectWithValue }) => {
    try {
      const organizationId = getOrganizationId(getState());
      const response = await providersApi.listProviderKeys({ organizationId });
      return { organizationId, keys: response.keys.map(providerKeyToPlain) };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : "Failed to fetch provider keys",
      );
    }
  },
  {
    // Every agent surface prefetches these; without the guard each mount
    // refires the same RPC and the pickers stay empty until the last one lands.
    condition: (params, { getState }) => {
      if (params?.force) return true;
      const state = getState();
      if (!isCachedForCurrentOrg(state)) return true;
      return state.agentProviders.keysStatus === "idle";
    },
  },
);

export const addProviderKey = createAsyncThunk<
  SerializedProviderKey,
  { provider: string; label: string; credential: string },
  { state: RootState; rejectValue: string }
>("agentProviders/addProviderKey", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await providersApi.addProviderKey({
      organizationId,
      ...params,
    });
    if (!response.key) throw new Error("No key in response");
    return providerKeyToPlain(response.key);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to add provider key");
  }
});

export const removeProviderKey = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string }
>("agentProviders/removeProviderKey", async (keyId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await providersApi.removeProviderKey({ organizationId, keyId });
    return keyId;
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to remove provider key",
    );
  }
});

export const validateProviderKey = createAsyncThunk<
  { keyId: string; isValid: boolean; error?: string },
  string,
  { state: RootState; rejectValue: string }
>("agentProviders/validateProviderKey", async (keyId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await providersApi.validateProviderKey({ organizationId, keyId });
    return { keyId, isValid: response.isValid, error: response.error };
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to validate provider key",
    );
  }
});

export const fetchAvailableModels = createAsyncThunk<
  { organizationId: string; models: SerializedModelInfo[] },
  { provider?: string; force?: boolean } | void,
  { state: RootState; rejectValue: string }
>(
  "agentProviders/fetchAvailableModels",
  async (params, { getState, rejectWithValue }) => {
    try {
      const organizationId = getOrganizationId(getState());
      const response = await providersApi.listAvailableModels({
        organizationId,
        provider: params?.provider,
      });
      return { organizationId, models: response.models.map(modelInfoToPlain) };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : "Failed to fetch available models",
      );
    }
  },
  {
    condition: (params, { getState }) => {
      if (params?.force || params?.provider) return true;
      const state = getState();
      if (!isCachedForCurrentOrg(state)) return true;
      return state.agentProviders.modelsStatus === "idle";
    },
  },
);

export const fetchModelsForKey = createAsyncThunk<
  { organizationId: string; keyId: string; models: SerializedModelInfo[] },
  { keyId: string; force?: boolean },
  { state: RootState; rejectValue: string }
>(
  "agentProviders/fetchModelsForKey",
  async ({ keyId }, { getState, rejectWithValue }) => {
    try {
      const organizationId = getOrganizationId(getState());
      const response = await providersApi.listModelsForKey({ organizationId, keyId });
      return { organizationId, keyId, models: response.models.map(modelInfoToPlain) };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : "Failed to fetch models for key",
      );
    }
  },
  {
    // The list is a per-provider catalog, so the org-wide fetch already
    // covers every enabled key; only an invalid or disabled key needs its own call.
    condition: ({ keyId, force }, { getState }) => {
      if (force) return true;
      const state = getState();
      if (!isCachedForCurrentOrg(state)) return true;
      const providers = state.agentProviders;
      if (providers.pendingKeyIds.includes(keyId)) return false;
      const provider = providers.providerByKeyId[keyId];
      return !provider || providers.modelsByProvider[provider] === undefined;
    },
  },
);

export const toggleProviderKey = createAsyncThunk<
  SerializedProviderKey,
  { keyId: string; enabled: boolean },
  { state: RootState; rejectValue: string }
>("agentProviders/toggleProviderKey", async ({ keyId, enabled }, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await providersApi.toggleProviderKey({ organizationId, keyId, enabled });
    if (!response.key) throw new Error("No key in response");
    return providerKeyToPlain(response.key);
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to toggle provider key",
    );
  }
});
