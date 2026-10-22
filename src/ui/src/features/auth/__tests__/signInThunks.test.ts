import { beforeEach, expect, it, vi } from "vitest";
import { combineReducers, configureStore, isAction, type Middleware } from "@reduxjs/toolkit";
import { create } from "@bufbuild/protobuf";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import { MyOrganizationSchema } from "@uniffy/proto/organizations/v1/organizations_pb";
import type { AppDispatch } from "@/app/store";
import { sessionScopeMiddleware } from "@/app/sessionScopeMiddleware";
import { getAccessToken, setMemoryAccessToken } from "@/config/api";
import { authReducer } from "@/features/auth/store/authSlice";
import { credentialMiddleware } from "@/features/auth/store/credentialMiddleware";
import { readStoredAuth } from "@/features/auth/store/credentialStorage";
import {
  readLastOrganization,
  readLastOrganizationSlug,
  writeLastOrganization,
  writeLastOrganizationSlug,
} from "@/features/auth/store/lastOrganizationStorage";
import { organizationsReducer } from "@/features/auth/store/organizationsSlice";
import { completeSignIn, type SignInResult } from "@/features/auth/store/signInThunks";
import { readTabOrganization } from "@/features/auth/store/tabOrganizationStorage";

const shared = vi.hoisted(() => ({ refresh: vi.fn(), list: vi.fn(), me: vi.fn() }));
vi.mock("@connectrpc/connect", async (original) => ({
  ...(await original<typeof import("@connectrpc/connect")>()),
  createClient: () => ({
    refreshToken: shared.refresh,
    listMyOrganizations: shared.list,
    getCurrentUser: shared.me,
    getCacheKeySeed: async () => ({ cacheKeySeed: new Uint8Array() }),
  }),
}));
vi.mock("@connectrpc/connect-web", () => ({ createConnectTransport: () => ({}) }));
vi.mock("@/config/env", () => ({ env: { apiBaseUrl: "http://test" } }));
vi.mock("@/shared/crypto/storageEncryption", () => ({ initStorageEncryption: vi.fn() }));

function membership(slug: string, suspended = false) {
  return create(MyOrganizationSchema, {
    organization: { id: `org-${slug}`, name: slug, slug },
    role: OrganizationRole.MEMBER,
    suspended,
  });
}

function mint(slug: string) {
  return {
    accessToken: `access-${slug}`,
    refreshToken: `refresh-${slug}`,
    organizationId: `org-${slug}`,
    organizationSlug: slug,
    organizationRole: "MEMBER",
    sessionId: "session",
    domainAdminDomains: [],
  };
}

const login: SignInResult = {
  accessToken: "login-access",
  refreshToken: "login-refresh",
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

function signIn(result: SignInResult) {
  return (store.dispatch as AppDispatch)(completeSignIn(result)).unwrap();
}

function credentialDispatches() {
  return actions.filter((type) => type === "auth/setCredentials").length;
}

beforeEach(() => {
  shared.refresh.mockReset();
  shared.list.mockReset();
  shared.me.mockReset();
  shared.me.mockResolvedValue({
    id: "user",
    email: "user@example.com",
    username: "user",
    fullName: "User",
    isActive: true,
    isSystemAdmin: false,
    emailVerified: true,
    hasAvatar: false,
  });
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
  setMemoryAccessToken(null);
  actions = [];
  store = createStore();
});

it("signs a single-organization user straight into that organization", async () => {
  shared.list.mockResolvedValue({ organizations: [membership("acme")] });
  shared.refresh.mockResolvedValue(mint("acme"));

  await expect(signIn(login)).resolves.toEqual({ organizationId: "org-acme" });

  expect(shared.refresh).toHaveBeenCalledWith({
    refreshToken: "login-refresh",
    organizationId: "org-acme",
    organizationSlug: "acme",
  });
  expect(credentialDispatches()).toBe(1);
  // The credentials carry the tab's organization; nothing else writes it.
  expect(readTabOrganization("user")).toEqual({ id: "org-acme", slug: "acme" });
  expect(store.getState().auth).toMatchObject({
    currentOrganizationId: "org-acme",
    currentOrganizationSlug: "acme",
    refreshToken: "refresh-acme",
    isAuthenticated: true,
  });
  expect(readStoredAuth()?.refreshToken).toBe("refresh-acme");
  expect(getAccessToken()).toBe("access-acme");
  expect(readLastOrganizationSlug("user")).toBe("acme");
});

it("signs a multi-organization user into the organization remembered on this device", async () => {
  writeLastOrganizationSlug("user", "globex");
  shared.list.mockResolvedValue({ organizations: [membership("acme"), membership("globex")] });
  shared.refresh.mockResolvedValue(mint("globex"));

  await expect(signIn(login)).resolves.toEqual({ organizationId: "org-globex" });

  expect(shared.refresh).toHaveBeenCalledWith({
    refreshToken: "login-refresh",
    organizationId: "org-globex",
    organizationSlug: "globex",
  });
  expect(credentialDispatches()).toBe(1);
  expect(store.getState().auth.currentOrganizationId).toBe("org-globex");
  expect(store.getState().organizations.items.map((item) => item.slug)).toEqual(["acme", "globex"]);
});

it("finds the remembered organization by id after a slug rename and records the new slug", async () => {
  writeLastOrganization("user", { id: "org-globex", slug: "globex-old" });
  shared.list.mockResolvedValue({ organizations: [membership("acme"), membership("globex")] });
  shared.refresh.mockResolvedValue(mint("globex"));

  await expect(signIn(login)).resolves.toEqual({ organizationId: "org-globex" });

  expect(shared.refresh).toHaveBeenCalledWith({
    refreshToken: "login-refresh",
    organizationId: "org-globex",
    organizationSlug: "globex",
  });
  expect(readLastOrganization("user")).toEqual({ id: "org-globex", slug: "globex" });
});

it("forgets a remembered id that is no longer listed even when another organization took its slug", async () => {
  writeLastOrganization("user", { id: "org-gone", slug: "globex" });
  shared.list.mockResolvedValue({ organizations: [membership("acme"), membership("globex")] });

  await expect(signIn(login)).resolves.toEqual({ organizationId: null });

  expect(shared.refresh).not.toHaveBeenCalled();
  expect(readLastOrganization("user")).toBeNull();
});

it("adds the id to a record that names the organization by slug alone", async () => {
  writeLastOrganizationSlug("user", "globex");
  shared.list.mockResolvedValue({
    organizations: [membership("acme"), membership("globex", true)],
  });

  await expect(signIn(login)).resolves.toEqual({ organizationId: null });

  expect(readLastOrganization("user")).toEqual({ id: "org-globex", slug: "globex" });
});

it("leaves a multi-organization user without a memory to the welcome page", async () => {
  shared.list.mockResolvedValue({ organizations: [membership("acme"), membership("globex")] });

  await expect(signIn(login)).resolves.toEqual({ organizationId: null });

  expect(shared.refresh).not.toHaveBeenCalled();
  expect(credentialDispatches()).toBe(1);
  expect(store.getState().auth).toMatchObject({
    currentOrganizationId: null,
    refreshToken: "login-refresh",
    isAuthenticated: true,
  });
  expect(store.getState().organizations.status).toBe("ready");
  expect(getAccessToken()).toBe("login-access");
});

it("forgets a remembered organization that is no longer listed", async () => {
  writeLastOrganizationSlug("user", "initech");
  shared.list.mockResolvedValue({ organizations: [membership("acme"), membership("globex")] });

  await expect(signIn(login)).resolves.toEqual({ organizationId: null });

  expect(readLastOrganizationSlug("user")).toBeNull();
  expect(shared.refresh).not.toHaveBeenCalled();
  expect(store.getState().auth.currentOrganizationId).toBeNull();
});

it("does not mint a remembered organization that is suspended", async () => {
  writeLastOrganizationSlug("user", "globex");
  shared.list.mockResolvedValue({
    organizations: [membership("acme"), membership("globex", true)],
  });

  await expect(signIn(login)).resolves.toEqual({ organizationId: null });

  expect(shared.refresh).not.toHaveBeenCalled();
  expect(readLastOrganizationSlug("user")).toBe("globex");
});

it("signs in org-less on the rotated token when the grant ends before the mint", async () => {
  writeLastOrganizationSlug("user", "acme");
  shared.list.mockResolvedValue({ organizations: [membership("acme")] });
  shared.refresh.mockResolvedValue({
    accessToken: "access-orgless",
    refreshToken: "refresh-rotated",
    organizationId: "",
    organizationSlug: "",
    organizationRole: "",
    sessionId: "session",
    domainAdminDomains: [],
  });

  await expect(signIn(login)).resolves.toEqual({ organizationId: null });

  expect(readLastOrganizationSlug("user")).toBeNull();
  expect(credentialDispatches()).toBe(1);
  expect(store.getState().auth).toMatchObject({
    currentOrganizationId: null,
    currentOrganizationSlug: null,
    refreshToken: "refresh-rotated",
  });
  expect(getAccessToken()).toBe("access-orgless");
});

it("keeps an organization-bound result as is and skips the list", async () => {
  await expect(
    signIn({ ...login, organizationId: "org-acme", organizationSlug: "acme" }),
  ).resolves.toEqual({ organizationId: "org-acme" });

  expect(shared.list).not.toHaveBeenCalled();
  expect(shared.refresh).not.toHaveBeenCalled();
  expect(credentialDispatches()).toBe(1);
  expect(store.getState().auth.currentOrganizationId).toBe("org-acme");
  expect(readLastOrganizationSlug("user")).toBe("acme");
  expect(getAccessToken()).toBe("login-access");
});

it("drops the fresh access token when the user cannot be loaded", async () => {
  shared.me.mockRejectedValue(new Error("network unavailable"));

  await expect(signIn(login)).rejects.toBe("network unavailable");

  expect(credentialDispatches()).toBe(0);
  expect(store.getState().auth.isAuthenticated).toBe(false);
  expect(getAccessToken()).toBeNull();
});
