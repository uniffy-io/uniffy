import { beforeEach, expect, it, vi } from "vitest";
import {
  combineReducers,
  configureStore,
  isAction,
  type Middleware,
  type Store,
} from "@reduxjs/toolkit";
import { Code, ConnectError } from "@connectrpc/connect";
import type { AppDispatch, RootState } from "@/app/store";
import { sessionScopeMiddleware } from "@/app/sessionScopeMiddleware";
import { setStoreRef } from "@/app/storeRef";
import {
  ORGANIZATION_LOST_EVENT,
  setMemoryAccessToken,
  takePendingOrganizationLost,
} from "@/config/api";
import {
  leaveCurrentOrganizationScope,
  WELCOME_PATH,
} from "@/features/auth/components/leaveOrganizationScope";
import { clearSessionCaches } from "@/features/auth/hooks/useSignOut";
import { authReducer, setCredentials } from "@/features/auth/store/authSlice";
import { credentialMiddleware } from "@/features/auth/store/credentialMiddleware";
import { readTabOrganization } from "@/features/auth/store/tabOrganizationStorage";
import { purgeCleanSnapshots } from "@/features/realtime/persistence/encryptedYjsPersistence";

const shared = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("@connectrpc/connect", async (original) => ({
  ...(await original<typeof import("@connectrpc/connect")>()),
  createClient: () => ({ refreshToken: shared.refresh }),
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

let actions: string[] = [];
let store = createStore();

function createStore() {
  const observer: Middleware = () => (next) => (action) => {
    if (isAction(action)) actions.push(action.type);
    return next(action);
  };
  return configureStore({
    reducer: combineReducers({ auth: authReducer }),
    middleware: (defaults) =>
      defaults().prepend(sessionScopeMiddleware).concat(credentialMiddleware, observer),
  });
}

function dispatch() {
  return store.dispatch as AppDispatch;
}

beforeEach(() => {
  shared.refresh.mockReset();
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
  actions = [];
});

it("drops the organization's caches, lands org-less credentials and opens the welcome page", async () => {
  shared.refresh.mockResolvedValue(orgLessMint);
  const navigate = vi.fn();

  await leaveCurrentOrganizationScope(dispatch(), {
    organizationId: "org-acme",
    userId: "user",
    navigate,
  });

  expect(clearSessionCaches).toHaveBeenCalledWith(expect.any(Function), {
    reason: "lost-grant",
    organizationId: "org-acme",
    userId: "user",
    preserveCurrentScope: false,
  });
  expect(purgeCleanSnapshots).toHaveBeenCalledWith("user", "org-acme");
  expect(actions[0]).toBe("auth/resetOrganizationScope");
  expect(shared.refresh).toHaveBeenCalledWith(
    expect.objectContaining({ refreshToken: "first", organizationId: "org-acme" }),
  );
  expect(store.getState().auth.currentOrganizationId).toBeNull();
  expect(store.getState().auth.currentOrganizationRole).toBeNull();
  expect(readTabOrganization("user")).toBeNull();
  expect(navigate).toHaveBeenCalledWith(WELCOME_PATH, { replace: true });
  expect(navigate.mock.invocationCallOrder[0]).toBeGreaterThan(
    shared.refresh.mock.invocationCallOrder[0],
  );
});

it("takes the loss the refresh announces so no later mount replays it as a warning", async () => {
  shared.refresh.mockResolvedValue(orgLessMint);
  const announced = vi.fn();
  window.addEventListener(ORGANIZATION_LOST_EVENT, announced);

  await leaveCurrentOrganizationScope(dispatch(), {
    organizationId: "org-acme",
    userId: "user",
    navigate: vi.fn(),
  });

  expect(announced).toHaveBeenCalledOnce();
  expect(takePendingOrganizationLost("user")).toBeNull();
});

it("still leaves for the welcome page when the refresh fails", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  shared.refresh.mockRejectedValue(new ConnectError("offline", Code.Unavailable));
  const navigate = vi.fn();

  await leaveCurrentOrganizationScope(dispatch(), {
    organizationId: "org-acme",
    userId: "user",
    navigate,
  });

  expect(actions).toContain("auth/resetOrganizationScope");
  expect(navigate).toHaveBeenCalledWith(WELCOME_PATH, { replace: true });
});
