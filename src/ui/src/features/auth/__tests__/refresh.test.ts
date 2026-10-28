import { beforeEach, expect, it, vi } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { configureStore, type Middleware, type UnknownAction } from "@reduxjs/toolkit";
import { authReducer, setCredentials } from "@/features/auth/store/authSlice";
import { credentialMiddleware } from "@/features/auth/store/credentialMiddleware";
import { writeStoredAuth, readStoredAuth } from "@/features/auth/store/credentialStorage";
import {
  readLastOrganizationSlug,
  writeLastOrganizationSlug,
} from "@/features/auth/store/lastOrganizationStorage";
import {
  clearTabOrganization,
  readTabOrganization,
} from "@/features/auth/store/tabOrganizationStorage";

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

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  shared.refresh.mockReset();
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
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
  expect(shared.refresh).toHaveBeenCalledWith({
    refreshToken: "first",
    organizationId: "org",
    organizationSlug: "acme",
  });
  expect(store.getState().auth).toMatchObject({
    currentOrganizationId: "org",
    currentOrganizationSlug: "acme",
  });
});

it("a renamed slug keeps the tab in its organization and moves the device's memory along", async () => {
  writeLastOrganizationSlug("user", "acme");
  shared.refresh.mockResolvedValue(refreshResponse({ organizationSlug: "acme-renamed" }));
  const lost = vi.fn();
  window.addEventListener("uniffy:auth:org-lost", lost);
  const api = await import("@/config/api");
  await api.refreshAccessToken();
  expect(store.getState().auth).toMatchObject({
    currentOrganizationId: "org",
    currentOrganizationSlug: "acme-renamed",
  });
  expect(readLastOrganizationSlug("user")).toBe("acme-renamed");
  expect(readTabOrganization("user")).toEqual({ id: "org", slug: "acme-renamed" });
  expect(lost).not.toHaveBeenCalled();
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
  expect(readTabOrganization("user")).toBeNull();
  expect(lost).toHaveBeenCalledOnce();
  const [event] = lost.mock.calls[0] as [Event];
  expect(event).toBeInstanceOf(CustomEvent);
  expect((event as CustomEvent).detail).toEqual({ organizationId: "org" });
  expect(api.getAccessToken()).toBe("org-less");
});

it("a lost grant stays pending for the shell of the same user until it takes it once", async () => {
  shared.refresh.mockResolvedValue(
    refreshResponse({ organizationId: "", organizationSlug: "", organizationRole: "" }),
  );
  const api = await import("@/config/api");
  await api.refreshAccessToken();
  expect(api.takePendingOrganizationLost("someone-else")).toBeNull();

  await api.refreshAccessToken();
  expect(api.takePendingOrganizationLost("user")).toBeNull();

  store.dispatch(
    setCredentials({
      user: { id: "user" } as Parameters<typeof setCredentials>[0]["user"],
      accessToken: "access",
      refreshToken: readStoredAuth()!.refreshToken!,
      organizationId: "org",
      organizationSlug: "acme",
      sessionId: "session",
    }),
  );
  await api.refreshAccessToken();
  expect(api.takePendingOrganizationLost("user")).toEqual({ organizationId: "org" });
  expect(api.takePendingOrganizationLost("user")).toBeNull();
});

it("a tab in no organization asks for the device's last one without announcing a loss", async () => {
  store.dispatch(
    setCredentials({
      user: { id: "user" } as Parameters<typeof setCredentials>[0]["user"],
      accessToken: "access",
      refreshToken: "first",
      sessionId: "session",
    }),
  );
  writeLastOrganizationSlug("user", "globex");
  shared.refresh.mockResolvedValue(
    refreshResponse({ organizationId: "", organizationSlug: "", organizationRole: "" }),
  );
  const lost = vi.fn();
  window.addEventListener("uniffy:auth:org-lost", lost);
  const api = await import("@/config/api");
  await api.refreshAccessToken();
  expect(shared.refresh).toHaveBeenCalledWith({
    refreshToken: "first",
    organizationSlug: "globex",
  });
  expect(shared.actions.map((action) => action.type)).not.toContain("auth/resetOrganizationScope");
  expect(lost).not.toHaveBeenCalled();
  expect(api.takePendingOrganizationLost("user")).toBeNull();
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

it("rehydrate brings a reloaded tab back to its own organization, not the device's last one", async () => {
  writeLastOrganizationSlug("user", "globex");
  shared.refresh.mockResolvedValue(refreshResponse());
  const api = await import("@/config/api");
  expect(await api.rehydrateAuth()).toBe(true);
  expect(shared.refresh).toHaveBeenCalledWith({
    refreshToken: "first",
    organizationId: "org",
    organizationSlug: "acme",
  });
  expect(store.getState().auth).toMatchObject({
    currentOrganizationId: "org",
    currentOrganizationSlug: "acme",
  });
  expect(readLastOrganizationSlug("user")).toBe("globex");
});

it("rehydrate lands a fresh tab in the device's last organization", async () => {
  clearTabOrganization("user");
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
  expect(readTabOrganization("user")).toEqual({ id: "org-globex", slug: "globex" });
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
  const lost = vi.fn();
  window.addEventListener("uniffy:auth:org-lost", lost);
  const api = await import("@/config/api");
  expect(await api.rehydrateAuth()).toBe(true);
  expect(shared.refresh).toHaveBeenCalledWith({
    refreshToken: "first",
    organizationId: "org",
    organizationSlug: "acme",
  });
  expect(store.getState().auth).toMatchObject({
    isAuthenticated: true,
    currentOrganizationId: null,
    currentOrganizationSlug: null,
  });
  expect(shared.actions.map((action) => action.type)).not.toContain("auth/logout");
  expect(readTabOrganization("user")).toBeNull();
  expect(lost).toHaveBeenCalledOnce();
  // The shell mounts after the reload's refresh, so it takes the loss from here.
  expect(api.takePendingOrganizationLost("user")).toEqual({ organizationId: "org" });
});

it("rehydrate of a fresh tab refused its remembered organization announces the loss by slug", async () => {
  clearTabOrganization("user");
  writeLastOrganizationSlug("user", "globex");
  shared.refresh.mockResolvedValue(
    refreshResponse({ organizationId: "", organizationSlug: "", organizationRole: "" }),
  );
  const api = await import("@/config/api");
  expect(await api.rehydrateAuth()).toBe(true);
  expect(readLastOrganizationSlug("user")).toBeNull();
  expect(api.takePendingOrganizationLost("user")).toEqual({ organizationId: undefined });
});

it("a reload that finds the session dead drops the user's titles and filters on the device", async () => {
  shared.refresh.mockRejectedValue(new ConnectError("expired", Code.Unauthenticated));
  const userKeys = ["uniffy:recent-items:org:user", "uniffy-files-view:filter:org:user"];
  for (const key of [...userKeys, "uniffy:recent-items:org:other"]) localStorage.setItem(key, "[]");
  const api = await import("@/config/api");

  expect(await api.rehydrateAuth()).toBe(false);

  expect(readStoredAuth()).toBeNull();
  for (const key of userKeys) expect(localStorage.getItem(key)).toBeNull();
  expect(localStorage.getItem("uniffy:recent-items:org:other")).toBe("[]");
});

it("a reload that loses a rotation race keeps the device stores of the live session", async () => {
  shared.refresh.mockImplementation(async () => {
    writeStoredAuth({ ...readStoredAuth()!, refreshToken: "rotated-elsewhere" });
    return refreshResponse();
  });
  localStorage.setItem("uniffy:recent-items:org:user", "[]");
  const api = await import("@/config/api");

  expect(await api.rehydrateAuth()).toBe(false);

  expect(readStoredAuth()?.refreshToken).toBe("rotated-elsewhere");
  expect(localStorage.getItem("uniffy:recent-items:org:user")).toBe("[]");
});
