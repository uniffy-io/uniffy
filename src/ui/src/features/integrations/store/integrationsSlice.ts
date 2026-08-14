import { createSlice } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import type {
  ConnectionPlain,
  IntegrationProviderPlain,
} from "@/features/integrations/store/integrationsThunks";
import {
  addConnection,
  fetchConnections,
  fetchIntegrationProviders,
  removeConnection,
  toggleConnection,
  validateConnection,
} from "@/features/integrations/store/integrationsThunks";

type LoadStatus = "idle" | "loading" | "loaded" | "error";

interface IntegrationsState {
  /** Org the cached rows belong to; a switch invalidates everything below. */
  organizationId: string | null;
  providers: IntegrationProviderPlain[];
  connections: ConnectionPlain[];
  status: LoadStatus;
}

const initialState: IntegrationsState = {
  organizationId: null,
  providers: [],
  connections: [],
  status: "idle",
};

const adoptOrganization = (state: IntegrationsState, organizationId: string): void => {
  if (state.organizationId === organizationId) return;
  state.organizationId = organizationId;
  state.providers = [];
  state.connections = [];
  state.status = "idle";
};

const upsertConnection = (state: IntegrationsState, connection: ConnectionPlain): void => {
  const index = state.connections.findIndex((c) => c.id === connection.id);
  if (index >= 0) {
    state.connections[index] = connection;
  } else {
    state.connections.push(connection);
  }
};

export const integrationsSlice = createSlice({
  name: "integrations",
  initialState,
  reducers: {
    clearIntegrations: () => initialState,
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchIntegrationProviders.fulfilled, (state, action) => {
        adoptOrganization(state, action.payload.organizationId);
        state.providers = action.payload.providers;
      })
      .addCase(fetchConnections.pending, (state) => {
        state.status = "loading";
      })
      .addCase(fetchConnections.fulfilled, (state, action) => {
        adoptOrganization(state, action.payload.organizationId);
        state.status = "loaded";
        state.connections = action.payload.connections;
      })
      .addCase(fetchConnections.rejected, (state) => {
        state.status = "error";
      })
      .addCase(addConnection.fulfilled, (state, action) => {
        upsertConnection(state, action.payload);
      })
      .addCase(removeConnection.fulfilled, (state, action) => {
        state.connections = state.connections.filter((c) => c.id !== action.payload);
      })
      .addCase(validateConnection.fulfilled, (state, action) => {
        const connection = state.connections.find((c) => c.id === action.payload.connectionId);
        if (!connection) return;
        connection.isValid = action.payload.isValid;
        connection.lastError = action.payload.error;
        if (action.payload.accountLogin) {
          connection.accountLogin = action.payload.accountLogin;
        }
      })
      .addCase(toggleConnection.fulfilled, (state, action) => {
        upsertConnection(state, action.payload);
      });
  },
});

export const { clearIntegrations } = integrationsSlice.actions;
export const integrationsReducer = integrationsSlice.reducer;

export const selectIntegrationProviders = (state: RootState) => state.integrations.providers;
export const selectIntegrationConnections = (state: RootState) => state.integrations.connections;
export const selectIntegrationsStatus = (state: RootState) => state.integrations.status;
