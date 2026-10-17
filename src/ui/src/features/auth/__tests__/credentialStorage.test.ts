import { beforeEach, expect, it, vi } from "vitest";
import { configureStore } from "@reduxjs/toolkit";
import { authReducer, setCredentials, logout } from "@/features/auth/store/authSlice";
import { credentialMiddleware } from "@/features/auth/store/credentialMiddleware";
import {
  AUTH_STORAGE_KEY,
  credentialSafeStorage,
  readStoredAuth,
  writeStoredAuth,
} from "@/features/auth/store/credentialStorage";

beforeEach(() => {
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
});

function credentials(refreshToken: string, organizationId = "org") {
  return setCredentials({
    user: { id: "user" } as Parameters<typeof setCredentials>[0]["user"],
    accessToken: "memory-only",
    refreshToken,
    organizationId,
    sessionId: "session",
  });
}

it("stale tab persistence cannot restore a rotated token or write an access token", async () => {
  const first = configureStore({
    reducer: { auth: authReducer },
    middleware: (getDefault) => getDefault().concat(credentialMiddleware),
  });
  const second = configureStore({
    reducer: { auth: authReducer },
    middleware: (getDefault) => getDefault().concat(credentialMiddleware),
  });
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
  writeStoredAuth(null);
  expect(readStoredAuth()).toBeNull();
});

it("publishes workspace credentials before telling sockets to reconnect", () => {
  const store = configureStore({
    reducer: { auth: authReducer },
    middleware: (getDefault) => getDefault().concat(credentialMiddleware),
  });
  const seen: Array<string | null | undefined> = [];
  window.addEventListener("uniffy:auth:refreshed", () =>
    seen.push(readStoredAuth()?.currentOrganizationId),
  );
  store.dispatch(credentials("switched", "next-org"));
  expect(seen).toEqual(["next-org"]);
});
