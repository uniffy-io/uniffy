import { describe, it, expect } from "vitest";
import {
  clearIntegrations,
  integrationsReducer,
} from "@/features/integrations/store/integrationsSlice";
import {
  addConnection,
  fetchConnections,
  fetchIntegrationProviders,
  removeConnection,
  toggleConnection,
  validateConnection,
} from "@/features/integrations/store/integrationsThunks";
import type {
  ConnectionPlain,
  IntegrationProviderPlain,
} from "@/features/integrations/store/integrationsThunks";

function buildProvider(
  overrides: Partial<IntegrationProviderPlain> = {},
): IntegrationProviderPlain {
  return {
    id: "github",
    label: "GitHub",
    defaultBaseUrl: "https://api.github.com",
    credentialPlaceholder: "ghp_... / github_pat_...",
    credentialDocsUrl: "https://docs.github.com/authentication",
    supportsBaseUrlOverride: true,
    ...overrides,
  };
}

function buildConnection(overrides: Partial<ConnectionPlain> = {}): ConnectionPlain {
  return {
    id: "conn-1",
    provider: "github",
    name: "Engineering",
    baseUrl: undefined,
    credentialHint: "ghp_...abcd",
    accountLogin: "octo-bot",
    isValid: true,
    isEnabled: true,
    lastValidatedAt: { seconds: 1753837200, nanos: 0 },
    lastUsedAt: undefined,
    lastError: undefined,
    createdBy: "user-1",
    createdAt: { seconds: 1753837200, nanos: 0 },
    updatedAt: { seconds: 1753837200, nanos: 0 },
    ...overrides,
  };
}

const emptyState = integrationsReducer(undefined, { type: "test/init" });

describe("integrationsSlice reducers", () => {
  it("fetchConnections walks loading to loaded and stores the rows", () => {
    let state = integrationsReducer(emptyState, fetchConnections.pending("req1", undefined));
    expect(state.status).toBe("loading");

    state = integrationsReducer(
      state,
      fetchConnections.fulfilled(
        { organizationId: "org-1", connections: [buildConnection()] },
        "req1",
        undefined,
      ),
    );
    expect(state.status).toBe("loaded");
    expect(state.organizationId).toBe("org-1");
    expect(state.connections).toHaveLength(1);
    expect(state.connections[0].name).toBe("Engineering");
  });

  it("fetchConnections.rejected flags the error status", () => {
    let state = integrationsReducer(emptyState, fetchConnections.pending("req1", undefined));
    state = integrationsReducer(state, fetchConnections.rejected(null, "req1", undefined, "boom"));
    expect(state.status).toBe("error");
    expect(state.connections).toHaveLength(0);
  });

  it("fetchIntegrationProviders.fulfilled stores the descriptors", () => {
    const state = integrationsReducer(
      emptyState,
      fetchIntegrationProviders.fulfilled(
        { organizationId: "org-1", providers: [buildProvider()] },
        "req1",
        undefined,
      ),
    );
    expect(state.providers).toHaveLength(1);
    expect(state.providers[0].id).toBe("github");
  });

  it("an org switch drops rows cached for the previous org", () => {
    let state = integrationsReducer(
      emptyState,
      fetchIntegrationProviders.fulfilled(
        { organizationId: "org-1", providers: [buildProvider()] },
        "req1",
        undefined,
      ),
    );
    state = integrationsReducer(
      state,
      fetchConnections.fulfilled(
        { organizationId: "org-2", connections: [buildConnection({ id: "conn-2" })] },
        "req2",
        undefined,
      ),
    );
    expect(state.organizationId).toBe("org-2");
    expect(state.providers).toHaveLength(0);
    expect(state.connections.map((c) => c.id)).toEqual(["conn-2"]);
  });

  it("addConnection.fulfilled appends a new row and replaces an existing one", () => {
    let state = integrationsReducer(
      emptyState,
      addConnection.fulfilled(buildConnection(), "req1", {
        provider: "github",
        name: "Engineering",
        credential: "ghp_x",
      }),
    );
    expect(state.connections).toHaveLength(1);

    state = integrationsReducer(
      state,
      addConnection.fulfilled(buildConnection({ name: "Renamed" }), "req2", {
        provider: "github",
        name: "Renamed",
        credential: "ghp_x",
      }),
    );
    expect(state.connections).toHaveLength(1);
    expect(state.connections[0].name).toBe("Renamed");
  });

  it("removeConnection.fulfilled drops only the given row", () => {
    let state = integrationsReducer(
      emptyState,
      fetchConnections.fulfilled(
        {
          organizationId: "org-1",
          connections: [buildConnection(), buildConnection({ id: "conn-2" })],
        },
        "req1",
        undefined,
      ),
    );
    state = integrationsReducer(state, removeConnection.fulfilled("conn-1", "req2", "conn-1"));
    expect(state.connections.map((c) => c.id)).toEqual(["conn-2"]);
  });

  it("toggleConnection.fulfilled swaps the row in place", () => {
    let state = integrationsReducer(
      emptyState,
      fetchConnections.fulfilled(
        { organizationId: "org-1", connections: [buildConnection()] },
        "req1",
        undefined,
      ),
    );
    state = integrationsReducer(
      state,
      toggleConnection.fulfilled(buildConnection({ isEnabled: false }), "req2", {
        connectionId: "conn-1",
        enabled: false,
      }),
    );
    expect(state.connections).toHaveLength(1);
    expect(state.connections[0].isEnabled).toBe(false);
  });

  it("validateConnection.fulfilled updates validity fields on the row", () => {
    let state = integrationsReducer(
      emptyState,
      fetchConnections.fulfilled(
        { organizationId: "org-1", connections: [buildConnection()] },
        "req1",
        undefined,
      ),
    );
    state = integrationsReducer(
      state,
      validateConnection.fulfilled(
        { connectionId: "conn-1", isValid: false, error: "Bad credentials" },
        "req2",
        "conn-1",
      ),
    );
    expect(state.connections[0].isValid).toBe(false);
    expect(state.connections[0].lastError).toBe("Bad credentials");

    state = integrationsReducer(
      state,
      validateConnection.fulfilled(
        { connectionId: "conn-1", isValid: true, accountLogin: "octo-bot" },
        "req3",
        "conn-1",
      ),
    );
    expect(state.connections[0].isValid).toBe(true);
    expect(state.connections[0].lastError).toBeUndefined();
    expect(state.connections[0].accountLogin).toBe("octo-bot");
  });

  it("validateConnection.fulfilled for an unknown row leaves state unchanged", () => {
    const state = integrationsReducer(
      emptyState,
      validateConnection.fulfilled(
        { connectionId: "ghost", isValid: false, error: "nope" },
        "req1",
        "ghost",
      ),
    );
    expect(state.connections).toHaveLength(0);
  });

  it("clearIntegrations resets to the initial state", () => {
    let state = integrationsReducer(
      emptyState,
      fetchConnections.fulfilled(
        { organizationId: "org-1", connections: [buildConnection()] },
        "req1",
        undefined,
      ),
    );
    state = integrationsReducer(state, clearIntegrations());
    expect(state).toEqual(emptyState);
  });
});
