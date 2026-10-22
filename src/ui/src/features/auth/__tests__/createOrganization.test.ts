import { beforeEach, expect, it, vi } from "vitest";
import {
  combineReducers,
  configureStore,
  isAction,
  type Middleware,
  type Store,
} from "@reduxjs/toolkit";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import { MyOrganizationSchema } from "@uniffy/proto/organizations/v1/organizations_pb";
import type { AppDispatch, RootState } from "@/app/store";
import { sessionScopeMiddleware } from "@/app/sessionScopeMiddleware";
import { setStoreRef } from "@/app/storeRef";
import { getAccessToken, setMemoryAccessToken } from "@/config/api";
import { authReducer, setCredentials } from "@/features/auth/store/authSlice";
import { credentialMiddleware } from "@/features/auth/store/credentialMiddleware";
import { readStoredAuth, writeStoredAuth } from "@/features/auth/store/credentialStorage";
import { readLastOrganizationSlug } from "@/features/auth/store/lastOrganizationStorage";
import {
  organizationsLoaded,
  organizationsReducer,
  summarizeOrganization,
} from "@/features/auth/store/organizationsSlice";
import { createOrganization } from "@/features/auth/store/organizationsThunks";
import { readTabOrganization } from "@/features/auth/store/tabOrganizationStorage";

const shared = vi.hoisted(() => ({ refresh: vi.fn(), list: vi.fn(), create: vi.fn() }));
vi.mock("@connectrpc/connect", async (original) => ({
  ...(await original<typeof import("@connectrpc/connect")>()),
  createClient: () => ({
    refreshToken: shared.refresh,
    listMyOrganizations: shared.list,
    createOrganization: shared.create,
  }),
}));
vi.mock("@connectrpc/connect-web", () => ({ createConnectTransport: () => ({}) }));
vi.mock("@/config/env", () => ({ env: { apiBaseUrl: "http://test" } }));
vi.mock("@/shared/crypto/storageEncryption", () => ({ initStorageEncryption: vi.fn() }));
vi.mock("@/features/auth/hooks/useSignOut", () => ({ clearSessionCaches: vi.fn() }));

const acme = create(MyOrganizationSchema, {
  organization: { id: "org-acme", name: "Acme", slug: "acme" },
  role: OrganizationRole.MEMBER,
});

function createdMembership(slug: string) {
  return create(MyOrganizationSchema, {
    organization: { id: "org-initech", name: "Initech", slug },
    role: OrganizationRole.OWNER,
  });
}

function mint(slug: string) {
  return {
    accessToken: "access-initech",
    refreshToken: "second",
    organizationId: "org-initech",
    organizationSlug: slug,
    organizationRole: "OWNER",
    sessionId: "session",
    domainAdminDomains: [],
  };
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

function dispatch() {
  return store.dispatch as AppDispatch;
}

beforeEach(() => {
  shared.refresh.mockReset();
  shared.list.mockReset();
  shared.create.mockReset();
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
  store.dispatch(organizationsLoaded([summarizeOrganization(acme)], true));
  setMemoryAccessToken("access-acme");
  actions = [];
});

it("creates the organization, switches this tab into it and resolves its name", async () => {
  shared.create.mockResolvedValue({ organization: createdMembership("initech") });
  shared.refresh.mockResolvedValue(mint("initech"));

  await expect(
    dispatch()(createOrganization({ name: "Initech", slug: "initech" })),
  ).resolves.toEqual({ organizationId: "org-initech", slug: "initech", name: "Initech" });

  expect(shared.create).toHaveBeenCalledWith({ name: "Initech", slug: "initech" });
  expect(shared.refresh).toHaveBeenCalledWith({
    refreshToken: "first",
    organizationId: "org-initech",
    organizationSlug: "initech",
  });
  // The list learns of the organization before the switch ends the scope that could add it.
  expect(actions.indexOf("organizations/organizationAdded")).toBeLessThan(
    actions.indexOf("auth/resetOrganizationScope"),
  );
  expect(store.getState().organizations.items.map((item) => [item.slug, item.role])).toEqual([
    ["acme", OrganizationRole.MEMBER],
    ["initech", OrganizationRole.OWNER],
  ]);
  expect(store.getState().auth).toMatchObject({
    currentOrganizationId: "org-initech",
    currentOrganizationSlug: "initech",
    refreshToken: "second",
  });
  expect(getAccessToken()).toBe("access-initech");
  expect(readLastOrganizationSlug("user")).toBe("initech");
  expect(readTabOrganization("user")).toEqual({ id: "org-initech", slug: "initech" });
});

it("leaves the slug to the server when none is given and switches to the one it assigned", async () => {
  shared.create.mockResolvedValue({ organization: createdMembership("initech-2") });
  shared.refresh.mockResolvedValue(mint("initech-2"));

  await expect(dispatch()(createOrganization({ name: "Initech", slug: "" }))).resolves.toEqual({
    organizationId: "org-initech",
    slug: "initech-2",
    name: "Initech",
  });

  expect(shared.create).toHaveBeenCalledWith({ name: "Initech", slug: undefined });
  expect(shared.refresh).toHaveBeenCalledWith(
    expect.objectContaining({ organizationSlug: "initech-2" }),
  );
  expect(store.getState().auth.currentOrganizationSlug).toBe("initech-2");
});

it("surfaces a refused create as its ConnectError and leaves the tab and the list as they were", async () => {
  const refusal = new ConnectError(
    "Validation error on 'slug': Slug is already in use",
    Code.InvalidArgument,
  );
  shared.create.mockRejectedValue(refusal);

  const rejection = dispatch()(createOrganization({ name: "Initech", slug: "acme" }));

  await expect(rejection).rejects.toBe(refusal);
  expect(shared.refresh).not.toHaveBeenCalled();
  // No rejected action, so the global error toast stays quiet and the form shows the message.
  expect(actions).toEqual([]);
  expect(store.getState().auth).toMatchObject({
    currentOrganizationId: "org-acme",
    currentOrganizationSlug: "acme",
    refreshToken: "first",
  });
  expect(store.getState().organizations.items.map((item) => item.slug)).toEqual(["acme"]);
  expect(getAccessToken()).toBe("access-acme");
});

it("keeps the created organization listed when the switch into it is refused", async () => {
  shared.create.mockResolvedValue({ organization: createdMembership("initech") });
  shared.refresh.mockImplementation(async () => {
    writeStoredAuth({ ...readStoredAuth()!, refreshToken: "other-tab" });
    return mint("initech");
  });

  const rejection = dispatch()(createOrganization({ name: "Initech", slug: "initech" }));

  await expect(rejection).rejects.toBe("Session changed");
  expect(actions).toContain("organizations/switchOrganization/rejected");
  expect(store.getState().auth.currentOrganizationId).toBe("org-acme");
  expect(store.getState().organizations.items.map((item) => item.slug)).toEqual([
    "acme",
    "initech",
  ]);
});
