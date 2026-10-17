import { beforeEach, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { authReducer, setCredentials } from "@/features/auth/store/authSlice";
import { credentialMiddleware } from "@/features/auth/store/credentialMiddleware";
import { writeStoredAuth, readStoredAuth } from "@/features/auth/store/credentialStorage";

const shared = vi.hoisted(() => ({ refresh: vi.fn(), store: null as unknown }));
vi.mock("@connectrpc/connect", async (original) => ({
  ...(await original<typeof import("@connectrpc/connect")>()),
  createClient: () => ({ refreshToken: shared.refresh }),
}));
vi.mock("@connectrpc/connect-web", () => ({ createConnectTransport: () => ({}) }));
vi.mock("@/config/env", () => ({ env: { apiBaseUrl: "http://test" } }));
vi.mock("@/app/storeRef", () => ({ getStoreRef: () => shared.store }));
vi.mock("@/shared/crypto/storageEncryption", () => ({ initStorageEncryption: vi.fn() }));

beforeEach(() => {
  vi.resetModules();
  shared.refresh.mockReset();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
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
  const store = configureStore({
    reducer: { auth: authReducer },
    middleware: (getDefault) => getDefault().concat(credentialMiddleware),
  });
  shared.store = store;
  store.dispatch(
    setCredentials({
      user: { id: "user" } as Parameters<typeof setCredentials>[0]["user"],
      accessToken: "access",
      refreshToken: "first",
      organizationId: "org",
      sessionId: "session",
    }),
  );
});

it("independent tab refreshes read the rotated credential after acquiring shared lock", async () => {
  shared.refresh.mockImplementation(async ({ refreshToken }: { refreshToken: string }) => ({
    accessToken: `access-${refreshToken}`,
    refreshToken: `${refreshToken}-next`,
    organizationId: "org",
    sessionId: "session",
    domainAdminDomains: [],
  }));
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
