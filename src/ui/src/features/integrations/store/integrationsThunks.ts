import { createAsyncThunk } from "@reduxjs/toolkit";
import { integrationsApi } from "@/features/integrations/api/integrationsApi";
import type { RootState } from "@/app/store";
import type {
  IntegrationConnectionInfo,
  IntegrationProviderInfo,
} from "@uniffy/proto/integrations/v1/integrations_pb";

const getOrganizationId = (state: RootState): string => {
  const orgId = state.auth.currentOrganizationId;
  if (!orgId) throw new Error("No organization selected");
  return orgId;
};

/** A fetch is redundant only when the cached data belongs to the current org. */
const isCachedForCurrentOrg = (state: RootState): boolean =>
  state.integrations.organizationId !== null &&
  state.integrations.organizationId === state.auth.currentOrganizationId;

const timestampToPlain = (ts?: { seconds: bigint | number; nanos: bigint | number }) => {
  if (!ts) return undefined;
  return {
    seconds: typeof ts.seconds === "bigint" ? Number(ts.seconds) : ts.seconds,
    nanos: typeof ts.nanos === "bigint" ? Number(ts.nanos) : ts.nanos,
  };
};

export const integrationProviderToPlain = (provider: IntegrationProviderInfo) => ({
  id: provider.id,
  label: provider.label,
  defaultBaseUrl: provider.defaultBaseUrl,
  credentialPlaceholder: provider.credentialPlaceholder,
  credentialDocsUrl: provider.credentialDocsUrl,
  supportsBaseUrlOverride: provider.supportsBaseUrlOverride,
});

export type IntegrationProviderPlain = ReturnType<typeof integrationProviderToPlain>;

export const connectionToPlain = (connection: IntegrationConnectionInfo) => ({
  id: connection.id,
  provider: connection.provider,
  name: connection.name,
  baseUrl: connection.baseUrl,
  credentialHint: connection.credentialHint,
  accountLogin: connection.accountLogin,
  isValid: connection.isValid,
  isEnabled: connection.isEnabled,
  lastValidatedAt: timestampToPlain(connection.lastValidatedAt),
  lastUsedAt: timestampToPlain(connection.lastUsedAt),
  lastError: connection.lastError,
  createdBy: connection.createdBy,
  createdAt: timestampToPlain(connection.createdAt),
  updatedAt: timestampToPlain(connection.updatedAt),
});

export type ConnectionPlain = ReturnType<typeof connectionToPlain>;

export const fetchIntegrationProviders = createAsyncThunk<
  { organizationId: string; providers: IntegrationProviderPlain[] },
  { force?: boolean } | void,
  { state: RootState; rejectValue: string }
>(
  "integrations/fetchProviders",
  async (_, { getState, rejectWithValue }) => {
    try {
      const organizationId = getOrganizationId(getState());
      const response = await integrationsApi.listIntegrationProviders({ organizationId });
      return {
        organizationId,
        providers: response.providers.map(integrationProviderToPlain),
      };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : "Failed to fetch integration providers",
      );
    }
  },
  {
    // Descriptors are static per build, so one load per org is enough.
    condition: (params, { getState }) => {
      if (params?.force) return true;
      const state = getState();
      if (!isCachedForCurrentOrg(state)) return true;
      return state.integrations.providers.length === 0;
    },
  },
);

export const fetchConnections = createAsyncThunk<
  { organizationId: string; connections: ConnectionPlain[] },
  { force?: boolean } | void,
  { state: RootState; rejectValue: string }
>(
  "integrations/fetchConnections",
  async (_, { getState, rejectWithValue }) => {
    try {
      const organizationId = getOrganizationId(getState());
      const response = await integrationsApi.listConnections({ organizationId });
      return { organizationId, connections: response.connections.map(connectionToPlain) };
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : "Failed to fetch connections",
      );
    }
  },
  {
    condition: (params, { getState }) => {
      if (params?.force) return true;
      const state = getState();
      if (!isCachedForCurrentOrg(state)) return true;
      return state.integrations.status === "idle";
    },
  },
);

export const addConnection = createAsyncThunk<
  ConnectionPlain,
  { provider: string; name: string; credential: string; baseUrl?: string },
  { state: RootState; rejectValue: string }
>("integrations/addConnection", async (params, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await integrationsApi.addConnection({ organizationId, ...params });
    if (!response.connection) throw new Error("No connection in response");
    return connectionToPlain(response.connection);
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to add connection");
  }
});

export const removeConnection = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: string }
>("integrations/removeConnection", async (connectionId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    await integrationsApi.removeConnection({ organizationId, connectionId });
    return connectionId;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to remove connection");
  }
});

export const validateConnection = createAsyncThunk<
  { connectionId: string; isValid: boolean; error?: string; accountLogin?: string },
  string,
  { state: RootState; rejectValue: string }
>("integrations/validateConnection", async (connectionId, { getState, rejectWithValue }) => {
  try {
    const organizationId = getOrganizationId(getState());
    const response = await integrationsApi.validateConnection({ organizationId, connectionId });
    return {
      connectionId,
      isValid: response.isValid,
      error: response.error,
      accountLogin: response.accountLogin,
    };
  } catch (error) {
    return rejectWithValue(
      error instanceof Error ? error.message : "Failed to validate connection",
    );
  }
});

export const toggleConnection = createAsyncThunk<
  ConnectionPlain,
  { connectionId: string; enabled: boolean },
  { state: RootState; rejectValue: string }
>(
  "integrations/toggleConnection",
  async ({ connectionId, enabled }, { getState, rejectWithValue }) => {
    try {
      const organizationId = getOrganizationId(getState());
      const response = await integrationsApi.toggleConnection({
        organizationId,
        connectionId,
        enabled,
      });
      if (!response.connection) throw new Error("No connection in response");
      return connectionToPlain(response.connection);
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : "Failed to toggle connection",
      );
    }
  },
);
