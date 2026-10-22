import { beforeEach, expect, it, vi } from "vitest";
import {
  combineReducers,
  configureStore,
  isAction,
  type Middleware,
  type Store,
} from "@reduxjs/toolkit";
import { Code, ConnectError } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import {
  MyInvitationSchema,
  MyOrganizationSchema,
} from "@uniffy/proto/organizations/v1/organizations_pb";
import type { AppDispatch, RootState } from "@/app/store";
import { withSessionScope } from "@/app/sessionScope";
import { sessionScopeMiddleware } from "@/app/sessionScopeMiddleware";
import { setStoreRef } from "@/app/storeRef";
import { setMemoryAccessToken } from "@/config/api";
import { resetOrganizationScope } from "@/features/auth/store/authActions";
import { authReducer, logout, setCredentials } from "@/features/auth/store/authSlice";
import { credentialMiddleware } from "@/features/auth/store/credentialMiddleware";
import {
  invitationsLoaded,
  invitationsReducer,
  selectPendingInvitationCount,
  summarizeInvitation,
} from "@/features/auth/store/invitationsSlice";
import {
  acceptInvitation,
  declineInvitation,
  fetchMyInvitations,
  refreshMyInvitationsQuietly,
} from "@/features/auth/store/invitationsThunks";
import {
  organizationsLoaded,
  organizationsReducer,
  summarizeOrganization,
} from "@/features/auth/store/organizationsSlice";
import { projectsUiReducer } from "@/features/projects/store/projectsUiSlice";

const shared = vi.hoisted(() => ({
  refresh: vi.fn(),
  listOrganizations: vi.fn(),
  listInvitations: vi.fn(),
  accept: vi.fn(),
  decline: vi.fn(),
}));
vi.mock("@connectrpc/connect", async (original) => ({
  ...(await original<typeof import("@connectrpc/connect")>()),
  createClient: () => ({
    refreshToken: shared.refresh,
    listMyOrganizations: shared.listOrganizations,
    listMyInvitations: shared.listInvitations,
    acceptMyInvitation: shared.accept,
    declineMyInvitation: shared.decline,
  }),
}));
vi.mock("@connectrpc/connect-web", () => ({ createConnectTransport: () => ({}) }));
vi.mock("@/config/env", () => ({ env: { apiBaseUrl: "http://test" } }));
vi.mock("@/shared/crypto/storageEncryption", () => ({ initStorageEncryption: vi.fn() }));
vi.mock("@/features/auth/hooks/useSignOut", () => ({ clearSessionCaches: vi.fn() }));

const EXPIRES_AT = new Date("2026-11-01T09:00:00.000Z");
const CREATED_AT = new Date("2026-10-20T09:00:00.000Z");

const globexInvitation = create(MyInvitationSchema, {
  id: "invite-globex",
  organization: { id: "org-globex", name: "Globex", slug: "globex" },
  role: OrganizationRole.ADMIN,
  inviterDisplayName: "Hank Scorpio",
  expiresAt: timestampFromDate(EXPIRES_AT),
  createdAt: timestampFromDate(CREATED_AT),
});
const initechInvitation = create(MyInvitationSchema, {
  id: "invite-initech",
  organization: { id: "org-initech", name: "Initech", slug: "initech" },
  role: OrganizationRole.MEMBER,
});
const acme = create(MyOrganizationSchema, {
  organization: { id: "org-acme", name: "Acme", slug: "acme" },
  role: OrganizationRole.OWNER,
});
const globexMembership = create(MyOrganizationSchema, {
  organization: { id: "org-globex", name: "Globex", slug: "globex" },
  role: OrganizationRole.ADMIN,
});
const globexMint = {
  accessToken: "access-globex",
  refreshToken: "second",
  organizationId: "org-globex",
  organizationSlug: "globex",
  organizationRole: "ADMIN",
  sessionId: "session",
  domainAdminDomains: [],
};

const rootReducer = combineReducers({
  auth: authReducer,
  organizations: organizationsReducer,
  invitations: invitationsReducer,
  projectsUi: projectsUiReducer,
});
const scopedReducer = withSessionScope<ReturnType<typeof rootReducer>>(rootReducer);

let actions: string[] = [];
let store = createStore();

function createStore() {
  const observer: Middleware = () => (next) => (action) => {
    if (isAction(action)) actions.push(action.type);
    return next(action);
  };
  return configureStore({
    reducer: scopedReducer,
    middleware: (defaults) =>
      defaults().prepend(sessionScopeMiddleware).concat(credentialMiddleware, observer),
  });
}

function dispatch() {
  return store.dispatch as AppDispatch;
}

function invitations() {
  return store.getState().invitations;
}

beforeEach(() => {
  for (const mock of Object.values(shared)) mock.mockReset();
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
      user: { id: "user", email: "pat@example.com" } as Parameters<
        typeof setCredentials
      >[0]["user"],
      accessToken: "access-acme",
      refreshToken: "first",
      organizationId: "org-acme",
      organizationSlug: "acme",
      sessionId: "session",
    }),
  );
  store.dispatch(organizationsLoaded([summarizeOrganization(acme)]));
  setMemoryAccessToken("access-acme");
  actions = [];
});

it("loads the invitations addressed to the user", async () => {
  shared.listInvitations.mockResolvedValueOnce({
    invitations: [globexInvitation, initechInvitation],
  });

  await dispatch()(fetchMyInvitations()).unwrap();

  expect(invitations().status).toBe("ready");
  expect(invitations().items).toEqual([
    {
      id: "invite-globex",
      organizationId: "org-globex",
      organizationName: "Globex",
      organizationSlug: "globex",
      role: OrganizationRole.ADMIN,
      inviterDisplayName: "Hank Scorpio",
      expiresAt: EXPIRES_AT.toISOString(),
      createdAt: CREATED_AT.toISOString(),
    },
    {
      id: "invite-initech",
      organizationId: "org-initech",
      organizationName: "Initech",
      organizationSlug: "initech",
      role: OrganizationRole.MEMBER,
      inviterDisplayName: null,
      expiresAt: "",
      createdAt: "",
    },
  ]);
  expect(selectPendingInvitationCount(store.getState())).toBe(2);
});

it("keeps the last list when a reload fails", async () => {
  shared.listInvitations.mockResolvedValueOnce({ invitations: [globexInvitation] });
  await dispatch()(fetchMyInvitations()).unwrap();

  shared.listInvitations.mockRejectedValueOnce(new Error("network unavailable"));
  await expect(dispatch()(fetchMyInvitations()).unwrap()).rejects.toBe("network unavailable");

  expect(invitations().status).toBe("error");
  expect(invitations().items.map((item) => item.id)).toEqual(["invite-globex"]);
});

it("reloads quietly and keeps the list and its status when the reload fails", async () => {
  shared.listInvitations.mockResolvedValueOnce({ invitations: [globexInvitation] });
  await dispatch()(fetchMyInvitations()).unwrap();

  shared.listInvitations.mockRejectedValueOnce(new Error("network unavailable"));
  await expect(dispatch()(refreshMyInvitationsQuietly()).unwrap()).resolves.toBeNull();

  // No rejected action, so errorToastMiddleware has nothing to toast.
  expect(actions.some((type) => type.endsWith("/rejected"))).toBe(false);
  expect(invitations().status).toBe("ready");
  expect(invitations().items.map((item) => item.id)).toEqual(["invite-globex"]);

  shared.listInvitations.mockResolvedValueOnce({ invitations: [initechInvitation] });
  await dispatch()(refreshMyInvitationsQuietly()).unwrap();
  expect(invitations().items.map((item) => item.id)).toEqual(["invite-initech"]);
});

it("skips a load while one is running", async () => {
  let reply!: (response: unknown) => void;
  shared.listInvitations.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );

  const first = dispatch()(fetchMyInvitations());
  void dispatch()(fetchMyInvitations());
  void dispatch()(refreshMyInvitationsQuietly());
  reply({ invitations: [globexInvitation] });
  await first;

  expect(shared.listInvitations).toHaveBeenCalledOnce();
  expect(invitations().items.map((item) => item.id)).toEqual(["invite-globex"]);
});

it("accepts from the list, drops the row and switches into the organization", async () => {
  store.dispatch(invitationsLoaded([globexInvitation, initechInvitation].map(summarizeInvitation)));
  shared.accept.mockResolvedValue({ organization: globexMembership });
  shared.refresh.mockResolvedValue(globexMint);

  await expect(dispatch()(acceptInvitation({ invitationId: "invite-globex" }))).resolves.toEqual({
    organizationId: "org-globex",
    organizationName: "Globex",
    slug: "globex",
  });

  expect(shared.accept).toHaveBeenCalledWith({
    lookup: { case: "invitationId", value: "invite-globex" },
  });
  // The organization is listed before the switch, so the mint asks for it by id.
  expect(shared.refresh).toHaveBeenCalledWith({
    refreshToken: "first",
    organizationId: "org-globex",
    organizationSlug: "globex",
  });
  expect(actions).toContain("auth/resetOrganizationScope");
  expect(store.getState().auth.currentOrganizationId).toBe("org-globex");
  expect(store.getState().organizations.items.map((item) => item.slug)).toEqual(["acme", "globex"]);
  // The rest of the list belongs to the user and outlives the switch.
  expect(invitations().items.map((item) => item.id)).toEqual(["invite-initech"]);
  expect(invitations().actingId).toBeNull();
});

it("accepts a mail link by token and drops the row from that organization", async () => {
  store.dispatch(invitationsLoaded([globexInvitation, initechInvitation].map(summarizeInvitation)));
  shared.accept.mockResolvedValue({ organization: globexMembership });
  shared.refresh.mockResolvedValue(globexMint);

  await dispatch()(acceptInvitation({ token: "mail-token" }));

  expect(shared.accept).toHaveBeenCalledWith({ lookup: { case: "token", value: "mail-token" } });
  expect(invitations().items.map((item) => item.id)).toEqual(["invite-initech"]);
  expect(store.getState().auth.currentOrganizationSlug).toBe("globex");
});

it("rejects a refused accept with its ConnectError and keeps the row", async () => {
  store.dispatch(invitationsLoaded([summarizeInvitation(globexInvitation)]));
  const refusal = new ConnectError("Invitation is for another email", Code.PermissionDenied);
  shared.accept.mockRejectedValue(refusal);

  await expect(dispatch()(acceptInvitation({ invitationId: "invite-globex" }))).rejects.toBe(
    refusal,
  );

  expect(shared.refresh).not.toHaveBeenCalled();
  // No rejected action, so the caller owns the message and no global toast doubles it.
  expect(actions.some((type) => type.endsWith("/rejected"))).toBe(false);
  expect(invitations().items.map((item) => item.id)).toEqual(["invite-globex"]);
  expect(invitations().actingId).toBeNull();
  expect(store.getState().auth.currentOrganizationId).toBe("org-acme");
});

it("does not switch when the account signed out while the accept was out", async () => {
  store.dispatch(invitationsLoaded([summarizeInvitation(globexInvitation)]));
  shared.accept.mockImplementation(async () => {
    store.dispatch(logout());
    return { organization: globexMembership };
  });

  await expect(
    dispatch()(acceptInvitation({ invitationId: "invite-globex" })),
  ).rejects.toMatchObject({ code: Code.Unauthenticated });

  expect(shared.refresh).not.toHaveBeenCalled();
  expect(store.getState().organizations.items).toEqual([]);
});

it("declines and drops the row", async () => {
  store.dispatch(invitationsLoaded([globexInvitation, initechInvitation].map(summarizeInvitation)));
  shared.decline.mockResolvedValue({});

  await dispatch()(declineInvitation({ invitationId: "invite-globex" }));

  expect(shared.decline).toHaveBeenCalledWith({ invitationId: "invite-globex" });
  expect(invitations().items.map((item) => item.id)).toEqual(["invite-initech"]);
  expect(invitations().actingId).toBeNull();
});

it("keeps the row when a decline is refused", async () => {
  store.dispatch(invitationsLoaded([summarizeInvitation(globexInvitation)]));
  const refusal = new ConnectError("Invitation is no longer pending", Code.FailedPrecondition);
  shared.decline.mockRejectedValue(refusal);

  await expect(dispatch()(declineInvitation({ invitationId: "invite-globex" }))).rejects.toBe(
    refusal,
  );

  expect(invitations().items.map((item) => item.id)).toEqual(["invite-globex"]);
  expect(invitations().actingId).toBeNull();
});

it("clears the list on sign-out and keeps it across an organization switch", () => {
  store.dispatch(invitationsLoaded([summarizeInvitation(globexInvitation)]));

  store.dispatch(resetOrganizationScope());
  expect(invitations()).toMatchObject({ status: "ready", items: [{ id: "invite-globex" }] });

  store.dispatch(logout());
  expect(invitations()).toEqual({ items: [], status: "idle", actingId: null });
});

it("lets a load that a switch interrupted run again", async () => {
  let replyStale!: (response: unknown) => void;
  shared.listInvitations.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        replyStale = resolve;
      }),
  );
  const interrupted = dispatch()(fetchMyInvitations());
  expect(invitations().status).toBe("loading");

  store.dispatch(resetOrganizationScope());
  await expect(interrupted.unwrap()).rejects.toMatchObject({ name: "AbortError" });
  replyStale({ invitations: [globexInvitation] });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(invitations()).toMatchObject({ status: "idle", items: [] });
});
