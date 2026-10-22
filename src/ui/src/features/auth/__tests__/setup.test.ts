import { beforeEach, expect, it, vi } from "vitest";
import { combineReducers, configureStore, isAction, type Middleware } from "@reduxjs/toolkit";
import { Code, ConnectError } from "@connectrpc/connect";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import type { AppDispatch } from "@/app/store";
import { sessionScopeMiddleware } from "@/app/sessionScopeMiddleware";
import { getAccessToken, setMemoryAccessToken } from "@/config/api";
import { authReducer } from "@/features/auth/store/authSlice";
import { credentialMiddleware } from "@/features/auth/store/credentialMiddleware";
import { organizationsReducer } from "@/features/auth/store/organizationsSlice";
import {
  readSetupRequired,
  setUpDeployment,
  type DeploymentSetupForm,
} from "@/features/auth/store/setupThunks";
import { readTabOrganization } from "@/features/auth/store/tabOrganizationStorage";

const shared = vi.hoisted(() => ({
  config: vi.fn(),
  setup: vi.fn(),
  me: vi.fn(),
  refresh: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@connectrpc/connect", async (original) => ({
  ...(await original<typeof import("@connectrpc/connect")>()),
  createClient: () => ({
    getAuthConfig: shared.config,
    setupDeployment: shared.setup,
    getCurrentUser: shared.me,
    refreshToken: shared.refresh,
    listMyOrganizations: shared.list,
    getCacheKeySeed: async () => ({ cacheKeySeed: new Uint8Array() }),
  }),
}));
vi.mock("@connectrpc/connect-web", () => ({ createConnectTransport: () => ({}) }));
vi.mock("@/config/env", () => ({ env: { apiBaseUrl: "http://test" } }));
vi.mock("@/shared/crypto/storageEncryption", () => ({ initStorageEncryption: vi.fn() }));

const form: DeploymentSetupForm = {
  fullName: "  Ada Operator ",
  email: " ada@example.com ",
  password: "correct horse battery",
  organizationName: " Acme Inc ",
  organizationSlug: "acme-inc-",
};

function refusal(message: string, code: Code, reason?: string): ConnectError {
  const error = new ConnectError(message, code);
  if (reason) {
    const value = new BinaryWriter()
      .tag(1, WireType.LengthDelimited)
      .string(reason)
      .tag(2, WireType.LengthDelimited)
      .string("uniffy")
      .finish();
    error.details.push({ type: "google.rpc.ErrorInfo", value });
  }
  return error;
}

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

function runSetup() {
  return (store.dispatch as AppDispatch)(setUpDeployment(form));
}

beforeEach(() => {
  for (const mock of Object.values(shared)) mock.mockReset();
  shared.me.mockResolvedValue({
    id: "operator",
    email: "ada@example.com",
    username: "ada",
    fullName: "Ada Operator",
    isActive: true,
    isSystemAdmin: true,
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

it("sends the visitor to sign in once the deployment is set up", async () => {
  shared.config.mockResolvedValueOnce({ publicRegistrationEnabled: true, setupRequired: false });
  await expect(readSetupRequired()).resolves.toBe(false);

  shared.config.mockResolvedValueOnce({ publicRegistrationEnabled: false, setupRequired: true });
  await expect(readSetupRequired()).resolves.toBe(true);
});

it("keeps the visitor on the page when the config call fails", async () => {
  shared.config.mockRejectedValue(new ConnectError("offline", Code.Unavailable));

  await expect(readSetupRequired()).resolves.toBeNull();
});

it("signs the operator into the first organization on the session setup returns", async () => {
  shared.setup.mockResolvedValue({
    authResult: {
      accessToken: "setup-access",
      refreshToken: "setup-refresh",
      organizationId: "org-acme",
      organizationSlug: "acme-inc",
      organizationRole: "OWNER",
      sessionId: "session",
      domainAdminDomains: [],
    },
  });

  await expect(runSetup()).resolves.toEqual({ status: "signed-in" });

  expect(shared.setup).toHaveBeenCalledWith({
    email: "ada@example.com",
    password: "correct horse battery",
    fullName: "Ada Operator",
    organizationName: "Acme Inc",
    organizationSlug: "acme-inc",
  });
  expect(actions).toContain("auth/completeSignIn/fulfilled");
  // The session already names the organization, so no second mint runs.
  expect(shared.refresh).not.toHaveBeenCalled();
  expect(shared.list).not.toHaveBeenCalled();
  expect(store.getState().auth).toMatchObject({
    isAuthenticated: true,
    currentOrganizationId: "org-acme",
    currentOrganizationSlug: "acme-inc",
    currentOrganizationRole: "OWNER",
    refreshToken: "setup-refresh",
  });
  expect(store.getState().auth.user?.isSystemAdmin).toBe(true);
  expect(getAccessToken()).toBe("setup-access");
  expect(readTabOrganization("operator")).toEqual({ id: "org-acme", slug: "acme-inc" });
});

it("reports a deployment someone else already set up without signing in", async () => {
  shared.setup.mockRejectedValue(
    refusal("Setup is already complete", Code.FailedPrecondition, "setup_completed"),
  );

  await expect(runSetup()).resolves.toEqual({
    status: "already-set-up",
    message: "Setup is already complete",
  });
  expect(actions).not.toContain("auth/completeSignIn/pending");
  expect(store.getState().auth.isAuthenticated).toBe(false);
});

it("keeps the form on any other failed precondition", async () => {
  shared.setup.mockRejectedValue(
    refusal("The deployment is not ready for setup", Code.FailedPrecondition),
  );

  await expect(runSetup()).resolves.toEqual({
    status: "failed",
    message: "The deployment is not ready for setup",
  });
  shared.setup.mockRejectedValue(
    refusal("Encryption is not configured", Code.FailedPrecondition, "encryption_unavailable"),
  );
  await expect(runSetup()).resolves.toMatchObject({ status: "failed" });
});

it("keeps the form on a refused field with the server's message", async () => {
  shared.setup.mockRejectedValue(
    new ConnectError(
      "Validation error on 'password': Password must be at least 12 characters",
      Code.InvalidArgument,
    ),
  );

  await expect(runSetup()).resolves.toEqual({
    status: "failed",
    message: "Password must be at least 12 characters",
  });
  expect(store.getState().auth.isAuthenticated).toBe(false);
  expect(getAccessToken()).toBeNull();
});
