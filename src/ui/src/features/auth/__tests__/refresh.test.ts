import { beforeEach, expect, it, vi } from "vitest";
import { configureStore, type Middleware, type UnknownAction } from "@reduxjs/toolkit";
import { authReducer, setCredentials } from "@/features/auth/store/authSlice";
import { credentialMiddleware } from "@/features/auth/store/credentialMiddleware";
import { writeStoredAuth, readStoredAuth } from "@/features/auth/store/credentialStorage";
import {
  readLastOrganizationSlug,
  writeLastOrganizationSlug,
} from "@/features/auth/store/lastOrganizationStorage";

const shared = vi.hoisted(() => ({
  refresh: vi.fn(),
  store: null as unknown,
  actions: [] as { type: string }[],
}));
vi.mock("@connectrpc/connect", async (original) => ({
  ...(await original<typeof import("@connectrpc/connect")>()),
  createClient: () => ({
    refreshToken: shared.refresh,
    getCacheKeySeed: async () => ({ cacheKeySeed: new Uint8Array() }),
  }),
}));
vi.mock("@connectrpc/connect-web", () => ({ createConnectTransport: () => ({}) }));
vi.mock("@/config/env", () => ({ env: { apiBaseUrl: "http://test" } }));
vi.mock("@/app/storeRef", () => ({ getStoreRef: () => shared.store }));
vi.mock("@/shared/crypto/storageEncryption", () => ({ initStorageEncryption: vi.fn() }));

const recorder: Middleware = () => (next) => (action) => {
  shared.actions.push(action as UnknownAction);
  return next(action);
};

function createStore() {
  return configureStore({
    reducer: { auth: authReducer },
    middleware: (getDefault) => getDefault().concat(credentialMiddleware, recorder),
  });
}

let store: ReturnType<typeof createStore>;

function refreshResponse(overrides: Record<string, unknown> = {}) {
  return {
    accessToken: "access-next",
    refreshToken: "second",
    organizationId: "org",
    organizationSlug: "acme",
    organizationRole: "member",
    sessionId: "session",
    domainAdminDomains: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  shared.refresh.mockReset();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  });
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
  shared.store = store;
  store.dispatch(
    setCredentials({
      user: { id: "user" } as Parameters<typeof setCredentials>[0]["user"],
      accessToken: "access",
      refreshToken: "first",
      organizationId: "org",
      organizationSlug: "acme",
      organizationRole: "member",
      sessionId: "session",
    }),
  );
  shared.actions = [];
});

it("independent tab refreshes read the rotated credential after acquiring shared lock", async () => {
  shared.refresh.mockImplementation(async ({ refreshToken }: { refreshToken: string }) =>
    refreshResponse({
      accessToken: `access-${refreshToken}`,
      refreshToken: `${refreshToken}-next`,
    }),
  );
  const first = await import("@/config/api");
  vi.resetModules();
  const second = await import("@/config/api");
  const tokens = await Promise.all([first.refreshAccessToken(), second.refreshAccessToken()]);
  expect(shared.refresh.mock.calls.map(([request]) => request.refreshToken)).toEqual([
    "first",
    "first-next",
  ]);
  expect(tokens).toEqual(["access-first", "access-first-next"]);
  expect(readStoredAuth()?.refreshToken).toBe("first-next-next");
});

it("late refresh response cannot replace a newer login", async () => {
  let reply!: (response: unknown) => void;
  shared.refresh.mockImplementation(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  const api = await import("@/config/api");
  const refreshing = api.refreshAccessToken();
  await vi.waitFor(() => expect(shared.refresh).toHaveBeenCalledOnce());
  writeStoredAuth({
    ...readStoredAuth()!,
    refreshToken: "other-login",
    user: { id: "other" } as NonNullable<ReturnType<typeof readStoredAuth>>["user"],
  });
  reply({ accessToken: "stale", refreshToken: "stale-refresh", domainAdminDomains: [] });
  expect(await refreshing).toBeNull();
  expect(readStoredAuth()?.refreshToken).toBe("other-login");
  expect(api.getAccessToken()).not.toBe("stale");
});

it("transient refresh failure retains credentials for retry instead of signing out", async () => {
  shared.refresh.mockRejectedValue(new Error("network unavailable"));
  const api = await import("@/config/api");
  await expect(api.refreshAccessToken()).rejects.toThrow("network unavailable");
  await expect(api.rehydrateAuth()).rejects.toThrow("network unavailable");
  expect(readStoredAuth()?.refreshToken).toBe("first");
});

it("refresh asks for the organization this tab is in, not the device's last one", async () => {
  writeLastOrganizationSlug("user", "globex");
  shared.refresh.mockResolvedValue(refreshResponse());
  const api = await import("@/config/api");
  await api.refreshAccessToken();
  expect(shared.refresh).toHaveBeenCalledWith({ refreshToken: "first", organizationSlug: "acme" });
  expect(store.getState().auth).toMatchObject({
    currentOrganizationId: "org",
    currentOrganizationSlug: "acme",
  });
});

it("lost organization grant resets the scope and clears the org without signing out", async () => {
  writeLastOrganizationSlug("user", "acme");
  const lost = vi.fn();
  window.addEventListener("uniffy:auth:org-lost", lost);
  shared.refresh.mockResolvedValue(
    refreshResponse({
      accessToken: "org-less",
      organizationId: "",
      organizationSlug: "",
      organizationRole: "",
    }),
  );
  const api = await import("@/config/api");
  expect(await api.refreshAccessToken()).toBe("org-less");
  expect(shared.actions.map((action) => action.type)).toEqual([
    "auth/resetOrganizationScope",
    "auth/setCredentials",
  ]);
  expect(store.getState().auth).toMatchObject({
    isAuthenticated: true,
    refreshToken: "second",
    currentSessionId: "session",
    currentOrganizationId: null,
    currentOrganizationSlug: null,
    currentOrganizationRole: null,
  });
  expect(readStoredAuth()).toMatchObject({ refreshToken: "second", currentOrganizationId: null });
  expect(readLastOrganizationSlug("user")).toBeNull();
  expect(lost).toHaveBeenCalledOnce();
  expect(api.getAccessToken()).toBe("org-less");
});

it("lost grant keeps the device's memory of an org another tab picked since", async () => {
  writeLastOrganizationSlug("user", "globex");
  shared.refresh.mockResolvedValue(
    refreshResponse({ organizationId: "", organizationSlug: "", organizationRole: "" }),
  );
  const api = await import("@/config/api");
  await api.refreshAccessToken();
  expect(store.getState().auth.currentOrganizationId).toBeNull();
  expect(readLastOrganizationSlug("user")).toBe("globex");
});

it("rehydrate lands a fresh tab in the device's last organization", async () => {
  writeLastOrganizationSlug("user", "globex");
  shared.refresh.mockResolvedValue(
    refreshResponse({ organizationId: "org-globex", organizationSlug: "globex" }),
  );
  const api = await import("@/config/api");
  expect(await api.rehydrateAuth()).toBe(true);
  expect(shared.refresh).toHaveBeenCalledWith({
    refreshToken: "first",
    organizationSlug: "globex",
  });
  expect(store.getState().auth).toMatchObject({
    isRehydrating: false,
    currentOrganizationId: "org-globex",
    currentOrganizationSlug: "globex",
  });
  expect(shared.actions.map((action) => action.type)).not.toContain("auth/resetOrganizationScope");
});

it("rehydrate does not restore a persisted org the server no longer grants", async () => {
  shared.refresh.mockResolvedValue(
    refreshResponse({ organizationId: "", organizationSlug: "", organizationRole: "" }),
  );
  const api = await import("@/config/api");
  expect(await api.rehydrateAuth()).toBe(true);
  expect(shared.refresh).toHaveBeenCalledWith({ refreshToken: "first", organizationSlug: "acme" });
  expect(store.getState().auth).toMatchObject({
    isAuthenticated: true,
    currentOrganizationId: null,
    currentOrganizationSlug: null,
  });
  expect(shared.actions.map((action) => action.type)).not.toContain("auth/logout");
});
