import { beforeEach, expect, it, vi } from "vitest";
import {
  combineReducers,
  configureStore,
  isAction,
  type Middleware,
  type Store,
} from "@reduxjs/toolkit";
import { create } from "@bufbuild/protobuf";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import { MyOrganizationSchema } from "@uniffy/proto/organizations/v1/organizations_pb";
import type { AppDispatch, RootState } from "@/app/store";
import { sessionScopeMiddleware } from "@/app/sessionScopeMiddleware";
import { setStoreRef } from "@/app/storeRef";
import { getAccessToken, setMemoryAccessToken } from "@/config/api";
import { clearSessionCaches } from "@/features/auth/hooks/useSignOut";
import { authReducer, setCredentials } from "@/features/auth/store/authSlice";
import { credentialMiddleware } from "@/features/auth/store/credentialMiddleware";
import { readStoredAuth, writeStoredAuth } from "@/features/auth/store/credentialStorage";
import {
  readLastOrganizationSlug,
  writeLastOrganizationSlug,
} from "@/features/auth/store/lastOrganizationStorage";
import {
  organizationsLoaded,
  organizationsReducer,
  summarizeOrganization,
} from "@/features/auth/store/organizationsSlice";
import {
  fetchMyOrganizations,
  LOST_ORGANIZATION_ACCESS_MESSAGE,
  refreshMyOrganizationsQuietly,
  reloadOrganizationsAndRole,
  switchOrganization,
} from "@/features/auth/store/organizationsThunks";
import { readTabOrganization } from "@/features/auth/store/tabOrganizationStorage";

const shared = vi.hoisted(() => ({ refresh: vi.fn(), list: vi.fn() }));
vi.mock("@connectrpc/connect", async (original) => ({
  ...(await original<typeof import("@connectrpc/connect")>()),
  createClient: () => ({ refreshToken: shared.refresh, listMyOrganizations: shared.list }),
}));
vi.mock("@connectrpc/connect-web", () => ({ createConnectTransport: () => ({}) }));
vi.mock("@/config/env", () => ({ env: { apiBaseUrl: "http://test" } }));
vi.mock("@/shared/crypto/storageEncryption", () => ({ initStorageEncryption: vi.fn() }));
vi.mock("@/features/auth/hooks/useSignOut", () => ({ clearSessionCaches: vi.fn() }));

const acme = create(MyOrganizationSchema, {
  organization: { id: "org-acme", name: "Acme", slug: "acme" },
  role: OrganizationRole.OWNER,
});
const globex = create(MyOrganizationSchema, {
  organization: { id: "org-globex", name: "Globex", slug: "globex" },
  role: OrganizationRole.MEMBER,
});
const globexMint = {
  accessToken: "access-globex",
  refreshToken: "second",
  organizationId: "org-globex",
  organizationSlug: "globex",
  organizationRole: "MEMBER",
  sessionId: "session",
  domainAdminDomains: [],
};

let actions: string[] = [];
let store = createStore();

function createStore() {
  const observer: Middleware = () => (next) => (action) => {
    if (isAction(action)) actions.push(action.type);
    return next(action);
  };
  return configureStore({
    reducer: combineReducers({ auth: authReducer, organizations: organizationsReducer }),
    middleware: (defaults) =>
      defaults().prepend(sessionScopeMiddleware).concat(credentialMiddleware, observer),
  });
}

function dispatch() {
  return store.dispatch as AppDispatch;
}

beforeEach(() => {
  shared.refresh.mockReset();
  shared.list.mockReset();
  vi.mocked(clearSessionCaches).mockReset();
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
  let pending = Promise.resolve<unknown>(undefined);
  vi.stubGlobal("navigator", {
    locks: {
      request: (_key: string, work: () => Promise<unknown>) => {
        const next = pending.then(work);
        pending = next.catch(() => {});
        return next;
      },
    },
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
      sessionId: "session",
    }),
  );
  setMemoryAccessToken("access-acme");
  actions = [];
});

it("switches on the same session through the scope guard and lands the new credentials", async () => {
  store.dispatch(organizationsLoaded([acme, globex].map(summarizeOrganization)));
  shared.refresh.mockResolvedValue(globexMint);

  await expect(dispatch()(switchOrganization("globex"))).resolves.toEqual({
    organizationId: "org-globex",
  });

  expect(shared.refresh).toHaveBeenCalledOnce();
  expect(shared.refresh).toHaveBeenCalledWith({
    refreshToken: "first",
    organizationId: "org-globex",
    organizationSlug: "globex",
  });
  const reset = actions.indexOf("auth/resetOrganizationScope");
  expect(reset).toBeGreaterThanOrEqual(0);
  expect(reset).toBeLessThan(actions.indexOf("auth/setCredentials"));
  expect(actions).not.toContain("auth/logout");
  // A switch moves only this tab, so the per-organization device stores stay for other tabs.
  expect(clearSessionCaches).toHaveBeenCalledOnce();
  expect(clearSessionCaches).toHaveBeenCalledWith(expect.any(Function), { reason: "switch" });
  expect(store.getState().auth).toMatchObject({
    currentOrganizationId: "org-globex",
    currentOrganizationSlug: "globex",
    refreshToken: "second",
    currentSessionId: "session",
    isAuthenticated: true,
  });
  expect(store.getState().organizations.switchingSlug).toBeNull();
  expect(readStoredAuth()?.refreshToken).toBe("second");
  expect(getAccessToken()).toBe("access-globex");
  expect(readLastOrganizationSlug("user")).toBe("globex");
  expect(readTabOrganization("user")).toEqual({ id: "org-globex", slug: "globex" });
});

it("switches by slug alone into an organization the list does not hold yet", async () => {
  shared.refresh.mockResolvedValue(globexMint);

  await dispatch()(switchOrganization("globex"));

  const [request] = shared.refresh.mock.calls[0] as [Record<string, unknown>];
  expect(request).toMatchObject({ refreshToken: "first", organizationSlug: "globex" });
  expect(request.organizationId).toBeUndefined();
  expect(store.getState().auth.currentOrganizationId).toBe("org-globex");
});

it("refuses a switch when another tab replaced the credential while the mint was in flight", async () => {
  shared.refresh.mockImplementation(async () => {
    writeStoredAuth({ ...readStoredAuth()!, refreshToken: "other-tab" });
    return globexMint;
  });

  await expect(dispatch()(switchOrganization("globex"))).rejects.toBe("Session changed");

  expect(actions).not.toContain("auth/resetOrganizationScope");
  expect(actions).not.toContain("auth/setCredentials");
  expect(store.getState().auth.currentOrganizationId).toBe("org-acme");
  expect(readStoredAuth()?.refreshToken).toBe("other-tab");
  expect(getAccessToken()).toBe("access-acme");
  expect(readLastOrganizationSlug("user")).toBeNull();
});

it("refuses a switch when the stored credential belongs to another session", async () => {
  writeStoredAuth({ ...readStoredAuth()!, currentSessionId: "other-session" });

  await expect(dispatch()(switchOrganization("globex"))).rejects.toBe("Session changed");

  expect(shared.refresh).not.toHaveBeenCalled();
  expect(actions).not.toContain("auth/setCredentials");
});

it("keeps the tab in its organization when the requested grant is gone", async () => {
  writeLastOrganizationSlug("user", "globex");
  shared.refresh.mockResolvedValue({
    accessToken: "access-orgless",
    refreshToken: "second",
    organizationId: "",
    organizationSlug: "",
    organizationRole: "",
    sessionId: "session",
    domainAdminDomains: [],
  });
  shared.list.mockResolvedValue({ organizations: [acme] });

  await expect(dispatch()(switchOrganization("globex"))).rejects.toBe(
    LOST_ORGANIZATION_ACCESS_MESSAGE,
  );
  await vi.waitFor(() => expect(store.getState().organizations.status).toBe("ready"));

  expect(actions).toContain("organizations/switchOrganization/rejected");
  expect(actions).not.toContain("auth/resetOrganizationScope");
  expect(actions).not.toContain("auth/setCredentials");
  expect(shared.list).toHaveBeenCalledOnce();
  expect(store.getState().organizations.items.map((item) => item.slug)).toEqual(["acme"]);
  expect(store.getState().auth).toMatchObject({
    currentOrganizationId: "org-acme",
    refreshToken: "second",
  });
  expect(readStoredAuth()).toMatchObject({ refreshToken: "second" });
  expect(readTabOrganization("user")).toEqual({ id: "org-acme", slug: "acme" });
  expect(getAccessToken()).toBe("access-acme");
  expect(readLastOrganizationSlug("user")).toBeNull();
});

it("reloads an organization list that the switch interrupted", async () => {
  let replyStale!: (response: unknown) => void;
  shared.list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        replyStale = resolve;
      }),
  );
  shared.list.mockResolvedValueOnce({ organizations: [acme, globex] });
  shared.refresh.mockResolvedValue(globexMint);
  const interrupted = dispatch()(fetchMyOrganizations());

  await dispatch()(switchOrganization("globex"));
  await expect(interrupted.unwrap()).rejects.toMatchObject({ name: "AbortError" });
  replyStale({ organizations: [acme] });
  await vi.waitFor(() => expect(store.getState().organizations.status).toBe("ready"));

  expect(shared.list).toHaveBeenCalledTimes(2);
  expect(store.getState().organizations.items.map((item) => item.slug)).toEqual(["acme", "globex"]);
});

it("summarizes memberships and keeps the last list when a reload fails", async () => {
  shared.list.mockResolvedValueOnce({ organizations: [acme], canCreateOrganization: true });
  await dispatch()(fetchMyOrganizations()).unwrap();
  expect(store.getState().organizations).toMatchObject({
    status: "ready",
    canCreateOrganization: true,
    items: [
      {
        id: "org-acme",
        name: "Acme",
        slug: "acme",
        role: OrganizationRole.OWNER,
        suspended: false,
        joinedAt: "",
      },
    ],
  });

  shared.list.mockRejectedValueOnce(new Error("network unavailable"));
  await expect(dispatch()(fetchMyOrganizations()).unwrap()).rejects.toBe("network unavailable");
  expect(store.getState().organizations.status).toBe("error");
  expect(store.getState().organizations.items).toHaveLength(1);
  expect(store.getState().organizations.canCreateOrganization).toBe(true);
});

it("skips a load while one is running", async () => {
  let reply!: (response: unknown) => void;
  shared.list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );

  const first = dispatch()(fetchMyOrganizations());
  void dispatch()(fetchMyOrganizations());
  void dispatch()(refreshMyOrganizationsQuietly());
  reply({ organizations: [acme] });
  await first;

  expect(shared.list).toHaveBeenCalledOnce();
  expect(store.getState().organizations.items.map((item) => item.slug)).toEqual(["acme"]);
});

it("reloads quietly in place and keeps the list and its status when the reload fails", async () => {
  shared.list.mockResolvedValueOnce({ organizations: [acme, globex], canCreateOrganization: true });
  await expect(dispatch()(refreshMyOrganizationsQuietly()).unwrap()).resolves.toHaveLength(2);
  expect(store.getState().organizations).toMatchObject({ status: "ready", settled: "ready" });

  shared.list.mockRejectedValueOnce(new Error("network unavailable"));
  await expect(dispatch()(refreshMyOrganizationsQuietly()).unwrap()).resolves.toBeNull();

  // No rejected action, so errorToastMiddleware has nothing to toast.
  expect(actions.some((type) => type.endsWith("/rejected"))).toBe(false);
  expect(store.getState().organizations).toMatchObject({ status: "ready", settled: "ready" });
  expect(store.getState().organizations.items.map((item) => item.slug)).toEqual(["acme", "globex"]);
});

function holdRole(organizationRole: string) {
  store.dispatch(
    setCredentials({
      user: { id: "user" } as Parameters<typeof setCredentials>[0]["user"],
      accessToken: "access-acme",
      refreshToken: "first",
      organizationId: "org-acme",
      organizationSlug: "acme",
      organizationRole,
      sessionId: "session",
    }),
  );
}

it("refreshes the tab's credentials once when the list names another role for its organization", async () => {
  holdRole("MEMBER");
  shared.list.mockResolvedValue({ organizations: [acme, globex] });
  shared.refresh.mockResolvedValue({
    accessToken: "access-acme-owner",
    refreshToken: "second",
    organizationId: "org-acme",
    organizationSlug: "acme",
    organizationRole: "OWNER",
    sessionId: "session",
    domainAdminDomains: [],
  });

  await dispatch()(reloadOrganizationsAndRole());

  expect(shared.refresh).toHaveBeenCalledOnce();
  expect(shared.refresh).toHaveBeenCalledWith({
    refreshToken: "first",
    organizationId: "org-acme",
    organizationSlug: "acme",
  });
  expect(store.getState().auth).toMatchObject({
    currentOrganizationId: "org-acme",
    currentOrganizationRole: "OWNER",
  });
  expect(getAccessToken()).toBe("access-acme-owner");
  expect(actions).not.toContain("auth/resetOrganizationScope");
});

it("leaves the credentials alone when the listed role matches the tab's", async () => {
  holdRole("OWNER");
  shared.list.mockResolvedValue({ organizations: [acme, globex] });

  await dispatch()(reloadOrganizationsAndRole());

  expect(shared.list).toHaveBeenCalledOnce();
  expect(shared.refresh).not.toHaveBeenCalled();
  expect(getAccessToken()).toBe("access-acme");
});

it("leaves the credentials alone and raises no toast when the list fails to load", async () => {
  holdRole("MEMBER");
  shared.list.mockRejectedValue(new Error("network unavailable"));

  await dispatch()(reloadOrganizationsAndRole());

  expect(shared.refresh).not.toHaveBeenCalled();
  expect(actions.some((type) => type.endsWith("/rejected"))).toBe(false);
  expect(store.getState().auth.currentOrganizationRole).toBe("MEMBER");
});
