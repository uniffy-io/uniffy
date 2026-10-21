import { beforeEach, expect, it, vi } from "vitest";
import { configureStore, type Middleware, type UnknownAction } from "@reduxjs/toolkit";
import { authReducer, setCredentials } from "@/features/auth/store/authSlice";
import { credentialMiddleware } from "@/features/auth/store/credentialMiddleware";
import {
  AUTH_STORAGE_KEY,
  readStoredAuth,
  writeStoredAuth,
} from "@/features/auth/store/credentialStorage";

const shared = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@connectrpc/connect", async (original) => ({
  ...(await original<typeof import("@connectrpc/connect")>()),
  createClient: () => ({ refreshToken: shared.refresh }),
}));
vi.mock("@connectrpc/connect-web", () => ({ createConnectTransport: () => ({}) }));
vi.mock("@/config/env", () => ({ env: { apiBaseUrl: "http://test" } }));
vi.mock("@/shared/crypto/storageEncryption", () => ({ initStorageEncryption: vi.fn() }));

const ORGANIZATION_IDS: Record<string, string> = { acme: "org-acme", globex: "org-globex" };

/** One browser tab: its own store and its own instance of the api module, sharing localStorage. */
async function openTab(slug: string) {
  const actions: UnknownAction[] = [];
  const recorder: Middleware = () => (next) => (action) => {
    actions.push(action as UnknownAction);
    return next(action);
  };
  const store = configureStore({
    reducer: { auth: authReducer },
    middleware: (getDefault) => getDefault().concat(credentialMiddleware, recorder),
  });
  store.dispatch(
    setCredentials({
      user: { id: "user" } as Parameters<typeof setCredentials>[0]["user"],
      accessToken: "access",
      refreshToken: "first",
      organizationId: ORGANIZATION_IDS[slug],
      organizationSlug: slug,
      organizationRole: "member",
      sessionId: "session",
    }),
  );
  actions.length = 0;
  vi.resetModules();
  vi.doMock("@/app/storeRef", () => ({ getStoreRef: () => store }));
  const api = await import("@/config/api");
  return { store, actions, api };
}

function storageEvent() {
  return Object.assign(new Event("storage"), { key: AUTH_STORAGE_KEY });
}

beforeEach(() => {
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
});

it("tabs in different organizations each refresh into their own organization", async () => {
  shared.refresh.mockImplementation(
    async ({
      refreshToken,
      organizationSlug,
    }: {
      refreshToken: string;
      organizationSlug: string;
    }) => ({
      accessToken: `access-${organizationSlug}`,
      refreshToken: `${refreshToken}-next`,
      organizationId: ORGANIZATION_IDS[organizationSlug],
      organizationSlug,
      organizationRole: "member",
      sessionId: "session",
      domainAdminDomains: [],
    }),
  );
  const acme = await openTab("acme");
  const globex = await openTab("globex");

  const tokens = await Promise.all([
    acme.api.refreshAccessToken(),
    globex.api.refreshAccessToken(),
  ]);

  expect(shared.refresh.mock.calls.map(([request]) => request)).toEqual([
    { refreshToken: "first", organizationSlug: "acme" },
    { refreshToken: "first-next", organizationSlug: "globex" },
  ]);
  expect(tokens).toEqual(["access-acme", "access-globex"]);
  expect(acme.api.getAccessToken()).toBe("access-acme");
  expect(globex.api.getAccessToken()).toBe("access-globex");
  expect(acme.store.getState().auth.currentOrganizationId).toBe("org-acme");
  expect(globex.store.getState().auth.currentOrganizationId).toBe("org-globex");
  expect(readStoredAuth()?.refreshToken).toBe("first-next-next");
  for (const tab of [acme, globex]) {
    expect(tab.actions.map((action) => action.type)).toEqual(["auth/setCredentials"]);
  }
});

it("another tab's organization in storage only syncs the shared refresh token", async () => {
  const acme = await openTab("acme");
  acme.api.setMemoryAccessToken("access-acme");
  const revoked = vi.fn();
  window.addEventListener("uniffy:auth:revoked", revoked);
  writeStoredAuth({
    ...readStoredAuth()!,
    refreshToken: "rotated",
    currentOrganizationId: "org-globex",
    currentOrganizationSlug: "globex",
  });

  window.dispatchEvent(storageEvent());

  expect(acme.actions).toEqual([{ type: "auth/syncRefreshToken", payload: "rotated" }]);
  expect(acme.store.getState().auth).toMatchObject({
    isAuthenticated: true,
    refreshToken: "rotated",
    currentOrganizationId: "org-acme",
    currentOrganizationSlug: "acme",
  });
  expect(acme.api.getAccessToken()).toBe("access-acme");
  expect(revoked).not.toHaveBeenCalled();
});

it("another session in storage signs this tab out without rewriting storage", async () => {
  const acme = await openTab("acme");
  acme.api.setMemoryAccessToken("access-acme");
  const revoked = vi.fn();
  window.addEventListener("uniffy:auth:revoked", revoked);
  writeStoredAuth({
    ...readStoredAuth()!,
    refreshToken: "other-login",
    currentSessionId: "other-session",
  });

  window.dispatchEvent(storageEvent());

  expect(acme.actions).toEqual([{ type: "auth/logout", meta: { external: true } }]);
  expect(acme.store.getState().auth.isAuthenticated).toBe(false);
  expect(acme.api.getAccessToken()).toBeNull();
  expect(revoked).toHaveBeenCalledOnce();
  expect(readStoredAuth()?.refreshToken).toBe("other-login");
});
