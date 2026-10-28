import { beforeEach, describe, expect, it, vi } from "vitest";
import { combineReducers, configureStore, type Store } from "@reduxjs/toolkit";
import { Code, ConnectError } from "@connectrpc/connect";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import type { AppDispatch, RootState } from "@/app/store";
import { sessionScopeMiddleware } from "@/app/sessionScopeMiddleware";
import { setStoreRef } from "@/app/storeRef";
import {
  ORGANIZATION_LOST_EVENT,
  refreshAccessToken,
  setMemoryAccessToken,
  takePendingOrganizationLost,
  type OrganizationLostDetail,
} from "@/config/api";
import {
  deleteOrganization,
  loadOrganization,
  saveOrganizationChanges,
  transferOrganizationOwnership,
} from "@/features/admin/store/organizationThunks";
import { WELCOME_PATH } from "@/features/auth/components/leaveOrganizationScope";
import { clearSessionCaches } from "@/features/auth/hooks/useSignOut";
import { authReducer, setCredentials } from "@/features/auth/store/authSlice";
import { credentialMiddleware } from "@/features/auth/store/credentialMiddleware";
import { organizationsReducer } from "@/features/auth/store/organizationsSlice";
import { purgeCleanSnapshots } from "@/features/realtime/persistence/encryptedYjsPersistence";

const shared = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  transfer: vi.fn(),
  remove: vi.fn(),
  refresh: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@connectrpc/connect", async (original) => ({
  ...(await original<typeof import("@connectrpc/connect")>()),
  createClient: () => ({
    getOrganization: shared.get,
    updateOrganization: shared.update,
    transferOwnership: shared.transfer,
    deleteOrganization: shared.remove,
    refreshToken: shared.refresh,
    listMyOrganizations: shared.list,
  }),
}));
vi.mock("@connectrpc/connect-web", () => ({ createConnectTransport: () => ({}) }));
vi.mock("@/config/env", () => ({ env: { apiBaseUrl: "http://test" } }));
vi.mock("@/shared/crypto/storageEncryption", () => ({ initStorageEncryption: vi.fn() }));
vi.mock("@/features/auth/hooks/useSignOut", () => ({ clearSessionCaches: vi.fn() }));
vi.mock("@/features/realtime/persistence/encryptedYjsPersistence", () => ({
  purgeCleanSnapshots: vi.fn(),
}));

const orgLessMint = {
  accessToken: "access-none",
  refreshToken: "second",
  organizationId: "",
  organizationSlug: "",
  organizationRole: "",
  sessionId: "session",
  domainAdminDomains: [],
};

function createStore() {
  return configureStore({
    reducer: combineReducers({ auth: authReducer, organizations: organizationsReducer }),
    middleware: (defaults) =>
      defaults().prepend(sessionScopeMiddleware).concat(credentialMiddleware),
  });
}

let store = createStore();

function dispatch() {
  return store.dispatch as AppDispatch;
}

function recordLosses(): OrganizationLostDetail[] {
  const details: OrganizationLostDetail[] = [];
  window.addEventListener(ORGANIZATION_LOST_EVENT, (event) => {
    details.push((event as CustomEvent<OrganizationLostDetail>).detail);
  });
  return details;
}

beforeEach(() => {
  for (const mock of Object.values(shared)) mock.mockReset();
  shared.list.mockResolvedValue({ organizations: [], canCreateOrganization: false });
  vi.mocked(clearSessionCaches).mockReset().mockResolvedValue(undefined);
  vi.mocked(purgeCleanSnapshots).mockReset().mockResolvedValue(0);
  for (const name of ["localStorage", "sessionStorage"]) {
    const values = new Map<string, string>();
    vi.stubGlobal(name, {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    });
  }
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("navigator", {
    locks: { request: (_key: string, work: () => Promise<unknown>) => work() },
  });
  store = createStore();
  setStoreRef(store as unknown as Store<RootState>);
  store.dispatch(
    setCredentials({
      user: { id: "user" } as Parameters<typeof setCredentials>[0]["user"],
      accessToken: "access-acme",
      refreshToken: "first",
      organizationId: "org-acme",
      organizationSlug: "acme",
      organizationRole: "OWNER",
      sessionId: "session",
    }),
  );
  setMemoryAccessToken("access-acme");
  takePendingOrganizationLost("user");
});

describe("loadOrganization", () => {
  it("resolves the fields the form edits", async () => {
    shared.get.mockResolvedValue({
      organization: { organization: { id: "org-acme", name: "Acme", slug: "acme" } },
    });

    await expect(dispatch()(loadOrganization("org-acme"))).resolves.toEqual({
      id: "org-acme",
      name: "Acme",
      slug: "acme",
    });
    expect(shared.get).toHaveBeenCalledWith({ organizationId: "org-acme" });
  });

  it("resolves null when the response carries no organization", async () => {
    shared.get.mockResolvedValue({});

    await expect(dispatch()(loadOrganization("org-acme"))).resolves.toBeNull();
  });
});

describe("saveOrganizationChanges", () => {
  it("sends only the changed name and keeps the credentials as they are", async () => {
    shared.update.mockResolvedValue({
      organization: { id: "org-acme", name: "Acme Labs", slug: "acme" },
    });

    await expect(
      dispatch()(saveOrganizationChanges("org-acme", { name: "Acme Labs" })),
    ).resolves.toEqual({ name: "Acme Labs", slug: "acme" });

    expect(shared.update).toHaveBeenCalledWith({ organizationId: "org-acme", name: "Acme Labs" });
    expect(shared.update.mock.calls[0][0]).not.toHaveProperty("slug");
    expect(shared.refresh).not.toHaveBeenCalled();
    expect(shared.list).toHaveBeenCalledOnce();
  });

  it("refreshes by organization id after a slug change so the tab carries the new slug", async () => {
    shared.update.mockResolvedValue({
      organization: { id: "org-acme", name: "Acme", slug: "acme-labs" },
    });
    shared.refresh.mockResolvedValue({
      accessToken: "access-acme-2",
      refreshToken: "second",
      organizationId: "org-acme",
      organizationSlug: "acme-labs",
      organizationRole: "OWNER",
      sessionId: "session",
      domainAdminDomains: [],
    });

    await dispatch()(saveOrganizationChanges("org-acme", { slug: "acme-labs" }));

    expect(shared.update).toHaveBeenCalledWith({ organizationId: "org-acme", slug: "acme-labs" });
    expect(shared.refresh).toHaveBeenCalledOnce();
    expect(shared.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: "first", organizationId: "org-acme" }),
    );
    expect(store.getState().auth.currentOrganizationId).toBe("org-acme");
    expect(store.getState().auth.currentOrganizationSlug).toBe("acme-labs");
  });

  it("keeps a saved slug when the refresh after it fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    shared.update.mockResolvedValue({
      organization: { id: "org-acme", name: "Acme", slug: "acme-labs" },
    });
    shared.refresh.mockRejectedValue(new ConnectError("offline", Code.Unavailable));

    await expect(
      dispatch()(saveOrganizationChanges("org-acme", { slug: "acme-labs" })),
    ).resolves.toEqual({ name: "Acme", slug: "acme-labs" });
  });

  it("rejects with the server refusal and refreshes nothing", async () => {
    const refusal = new ConnectError(
      "Validation error on 'slug': Slug is already in use",
      Code.InvalidArgument,
    );
    shared.update.mockRejectedValue(refusal);

    await expect(dispatch()(saveOrganizationChanges("org-acme", { slug: "globex" }))).rejects.toBe(
      refusal,
    );
    expect(shared.refresh).not.toHaveBeenCalled();
    expect(shared.list).not.toHaveBeenCalled();
  });
});

describe("transferOrganizationOwnership", () => {
  it("carries the new role into the credentials and the organization list", async () => {
    shared.transfer.mockResolvedValue({});
    shared.refresh.mockResolvedValue({
      accessToken: "access-acme-2",
      refreshToken: "second",
      organizationId: "org-acme",
      organizationSlug: "acme",
      organizationRole: "ADMIN",
      sessionId: "session",
      domainAdminDomains: [],
    });
    shared.list.mockResolvedValue({
      organizations: [
        {
          organization: { id: "org-acme", name: "Acme", slug: "acme" },
          role: OrganizationRole.ADMIN,
          suspended: false,
        },
      ],
      canCreateOrganization: false,
    });

    await dispatch()(transferOrganizationOwnership("org-acme", "user-b"));

    expect(shared.transfer).toHaveBeenCalledWith({
      organizationId: "org-acme",
      newOwnerUserId: "user-b",
    });
    expect(store.getState().auth.currentOrganizationRole).toBe("ADMIN");
    await vi.waitFor(() =>
      expect(store.getState().organizations.items[0]?.role).toBe(OrganizationRole.ADMIN),
    );
  });

  it("rejects with the server refusal and reloads nothing", async () => {
    const refusal = new ConnectError(
      "Ownership can only go to an active account",
      Code.PermissionDenied,
    );
    shared.transfer.mockRejectedValue(refusal);

    await expect(dispatch()(transferOrganizationOwnership("org-acme", "user-b"))).rejects.toBe(
      refusal,
    );
    expect(shared.refresh).not.toHaveBeenCalled();
    expect(shared.list).not.toHaveBeenCalled();
  });
});

describe("deleteOrganization", () => {
  it("expects the loss before the server revokes the grant, so a refresh in that window reads it as expected", async () => {
    shared.refresh.mockResolvedValue(orgLessMint);
    // The server publishes the revoke before it answers; another path refreshes on it.
    shared.remove.mockImplementation(async () => {
      await refreshAccessToken();
      return {};
    });
    const losses = recordLosses();
    const navigate = vi.fn();

    await dispatch()(
      deleteOrganization({ organizationId: "org-acme", confirmSlug: "acme", navigate }),
    );

    expect(shared.remove).toHaveBeenCalledWith({
      organizationId: "org-acme",
      confirmSlug: "acme",
    });
    expect(losses).toEqual([{ organizationId: "org-acme", expected: true }]);
    expect(clearSessionCaches).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ organizationId: "org-acme", userId: "user" }),
    );
    expect(store.getState().auth.currentOrganizationId).toBeNull();
    expect(navigate).toHaveBeenCalledWith(WELCOME_PATH, { replace: true });
  });

  it("stops expecting the loss when the server refuses the delete", async () => {
    const refusal = new ConnectError(
      "Requires organization owner privileges",
      Code.PermissionDenied,
    );
    shared.remove.mockRejectedValue(refusal);
    const navigate = vi.fn();

    await expect(
      dispatch()(deleteOrganization({ organizationId: "org-acme", confirmSlug: "acme", navigate })),
    ).rejects.toBe(refusal);
    expect(navigate).not.toHaveBeenCalled();
    expect(shared.refresh).not.toHaveBeenCalled();

    shared.refresh.mockResolvedValue(orgLessMint);
    const losses = recordLosses();
    await refreshAccessToken();

    expect(losses).toEqual([{ organizationId: "org-acme" }]);
  });
});
