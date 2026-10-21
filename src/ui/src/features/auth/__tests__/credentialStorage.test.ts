import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { authReducer, setCredentials, logout } from "@/features/auth/store/authSlice";
import { credentialMiddleware } from "@/features/auth/store/credentialMiddleware";
import {
  AUTH_STORAGE_KEY,
  credentialSafeStorage,
  readStoredAuth,
  writeStoredAuth,
} from "@/features/auth/store/credentialStorage";
import {
  readTabOrganization,
  writeTabOrganization,
} from "@/features/auth/store/tabOrganizationStorage";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
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
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("sessionStorage", memoryStorage());
  vi.stubGlobal("window", new EventTarget());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function credentials(refreshToken: string, organizationId: string | null = "org") {
  return setCredentials({
    user: { id: "user" } as Parameters<typeof setCredentials>[0]["user"],
    accessToken: "memory-only",
    refreshToken,
    organizationId: organizationId ?? undefined,
    organizationSlug: organizationId ? `${organizationId}-slug` : undefined,
    organizationRole: organizationId ? "member" : undefined,
    sessionId: "session",
    domainAdminDomains: organizationId ? [1] : [],
  });
}

function createStore() {
  return configureStore({
    reducer: { auth: authReducer },
    middleware: (getDefault) => getDefault().concat(credentialMiddleware),
  });
}

it("stale tab persistence cannot restore a rotated token or write an access token", async () => {
  const first = createStore();
  const second = createStore();
  first.dispatch(credentials("initial"));
  second.dispatch(credentials("rotated"));
  await credentialSafeStorage.setItem(
    "persist:root",
    JSON.stringify({ auth: JSON.stringify(first.getState().auth), theme: "dark" }),
  );
  expect(readStoredAuth()?.refreshToken).toBe("rotated");
  expect(localStorage.getItem("persist:root")).not.toContain("initial");
  expect(localStorage.getItem(AUTH_STORAGE_KEY)).not.toContain("memory-only");
  expect(
    JSON.parse(JSON.parse((await credentialSafeStorage.getItem("persist:root"))!).auth)
      .refreshToken,
  ).toBe("rotated");
  first.dispatch(logout());
  expect(readStoredAuth()?.refreshToken).toBe("rotated");
});

it("migrates persisted auth once and a signed-out tombstone prevents resurrection", () => {
  const state = authReducer(undefined, credentials("initial"));
  localStorage.setItem("persist:root", JSON.stringify({ auth: JSON.stringify(state) }));
  expect(readStoredAuth()?.refreshToken).toBe("initial");
  expect(JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!)).not.toHaveProperty(
    "currentOrganizationId",
  );
  writeStoredAuth(null);
  expect(readStoredAuth()).toBeNull();
});

it("keeps the organization out of the shared record and in the tab", () => {
  const store = createStore();
  store.dispatch(credentials("first", "org-a"));

  const stored = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY)!);
  for (const field of [
    "currentOrganizationId",
    "currentOrganizationSlug",
    "currentOrganizationRole",
    "domainAdminDomains",
  ]) {
    expect(stored).not.toHaveProperty(field);
  }
  expect(readStoredAuth()).toMatchObject({
    refreshToken: "first",
    currentOrganizationId: null,
    currentOrganizationSlug: null,
    currentOrganizationRole: null,
    domainAdminDomains: [],
  });
  expect(readTabOrganization("user")).toEqual({ id: "org-a", slug: "org-a-slug" });
});

it("ignores organization fields a stored record still carries", () => {
  localStorage.setItem(
    AUTH_STORAGE_KEY,
    JSON.stringify({ refreshToken: "first", currentOrganizationId: "org-stale" }),
  );
  expect(readStoredAuth()?.currentOrganizationId).toBeNull();
});

it("forgets the tab organization on an org-less refresh and on sign-out", () => {
  const store = createStore();
  store.dispatch(credentials("first", "org-a"));
  store.dispatch(credentials("second", null));
  expect(readTabOrganization("user")).toBeNull();

  store.dispatch(credentials("third", "org-a"));
  store.dispatch(logout());
  expect(readTabOrganization("user")).toBeNull();
});

it("forgets the tab organization when another tab signs out", () => {
  const store = createStore();
  store.dispatch(credentials("first", "org-a"));
  writeStoredAuth(null);
  store.dispatch({ ...logout(), meta: { external: true } });
  expect(readTabOrganization("user")).toBeNull();
});

it("rehydrates the tab's organization, not the last one any tab refreshed into", async () => {
  const store = createStore();
  store.dispatch(credentials("first", "org-b"));
  writeTabOrganization("user", { id: "org-a", slug: "acme" });

  const root = JSON.parse((await credentialSafeStorage.getItem("persist:root"))!);
  expect(JSON.parse(root.auth)).toMatchObject({
    refreshToken: "first",
    currentOrganizationId: "org-a",
    currentOrganizationSlug: "acme",
    currentOrganizationRole: null,
  });
});

it("publishes workspace credentials before telling sockets to reconnect", () => {
  const store = createStore();
  const seen: Array<[string | null | undefined, string | undefined]> = [];
  window.addEventListener("uniffy:auth:refreshed", () =>
    seen.push([readStoredAuth()?.refreshToken, readTabOrganization("user")?.id]),
  );
  store.dispatch(credentials("switched", "next-org"));
  expect(seen).toEqual([["switched", "next-org"]]);
});

it("writes only the slices this tab changed into the shared persisted blob", async () => {
  const tabA = credentialSafeStorage;
  vi.resetModules();
  const { credentialSafeStorage: tabB } = await import("@/features/auth/store/credentialStorage");
  localStorage.setItem("persist:root", JSON.stringify({ theme: '"light"', chatUi: '"default"' }));

  await tabA.getItem("persist:root");
  await tabB.getItem("persist:root");
  await tabA.setItem("persist:root", JSON.stringify({ theme: '"light"', chatUi: '"compact"' }));
  await tabB.setItem("persist:root", JSON.stringify({ theme: '"dark"', chatUi: '"default"' }));

  expect(JSON.parse(localStorage.getItem("persist:root")!)).toEqual({
    theme: '"dark"',
    chatUi: '"compact"',
  });
});
