import { beforeEach, expect, it, vi } from "vitest";
import { combineReducers, configureStore, isAction, type Middleware } from "@reduxjs/toolkit";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import { ResolveContentOrganizationResponseSchema } from "@uniffy/proto/organizations/v1/organizations_pb";
import { sessionScopeMiddleware } from "@/app/sessionScopeMiddleware";
import { organizationsApi } from "@/features/auth/api/organizationsApi";
import { useContentOrganizationResolver } from "@/features/auth/hooks/useContentOrganizationResolver";
import { authReducer, setCredentials } from "@/features/auth/store/authSlice";
import { organizationsReducer } from "@/features/auth/store/organizationsSlice";
import { buildUrn, UrnType } from "@/shared/utils/urn";

// A minimal hook runtime: state and refs live in call-order slots, and an effect runs when its
// dependencies change, which is all the resolver relies on.
const runtime = vi.hoisted(() => ({
  slots: [] as unknown[],
  queued: [] as Array<() => void>,
  cursor: 0,
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = runtime.cursor++;
    if (!(index in runtime.slots)) runtime.slots[index] = initial;
    return [
      runtime.slots[index],
      (next: unknown) => {
        runtime.slots[index] = next;
      },
    ];
  },
  useRef: (current: unknown) => {
    const index = runtime.cursor++;
    if (!(index in runtime.slots)) runtime.slots[index] = { current };
    return runtime.slots[index];
  },
  useEffect: (effect: () => void, deps?: readonly unknown[]) => {
    const index = runtime.cursor++;
    const previous = runtime.slots[index] as readonly unknown[] | undefined;
    const unchanged =
      previous !== undefined &&
      deps !== undefined &&
      previous.length === deps.length &&
      previous.every((value, position) => Object.is(value, deps[position]));
    if (unchanged) return;
    runtime.slots[index] = deps;
    runtime.queued.push(effect);
  },
}));

const harness = vi.hoisted(() => ({
  store: null as unknown as ReturnType<typeof createStore>,
}));

vi.mock("@/app/hooks", () => ({
  useAppDispatch: () => harness.store.dispatch,
  useAppSelector: (selector: (state: unknown) => unknown) => selector(harness.store.getState()),
}));
vi.mock("@/features/auth/api/organizationsApi", () => ({
  organizationsApi: { listMyOrganizations: vi.fn(), resolveContentOrganization: vi.fn() },
}));
vi.mock("@connectrpc/connect-web", () => ({ createConnectTransport: () => ({}) }));
vi.mock("@/config/env", () => ({ env: { apiBaseUrl: "http://test" } }));
vi.mock("@/shared/crypto/storageEncryption", () => ({ initStorageEncryption: vi.fn() }));
vi.mock("@/features/auth/hooks/useSignOut", () => ({ clearSessionCaches: vi.fn() }));

const NOTE_URN = buildUrn(UrnType.NOTE, "note-1");
const resolveRpc = vi.mocked(organizationsApi.resolveContentOrganization);

let actions: string[] = [];

function createStore() {
  const observer: Middleware = () => (next) => (action) => {
    if (isAction(action)) actions.push(action.type);
    return next(action);
  };
  return configureStore({
    reducer: combineReducers({ auth: authReducer, organizations: organizationsReducer }),
    middleware: (defaults) => defaults().prepend(sessionScopeMiddleware).concat(observer),
  });
}

function render(urn: string | null, failed: boolean) {
  runtime.cursor = 0;
  // The React lifecycle is replaced by the runtime above for this test.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const lookup = useContentOrganizationResolver(urn, failed);
  for (const effect of runtime.queued.splice(0)) effect();
  return lookup;
}

async function renderSettled(urn: string | null, failed: boolean) {
  render(urn, failed);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return render(urn, failed);
}

function resolvesTo(id: string, name: string, slug: string) {
  resolveRpc.mockResolvedValue(
    create(ResolveContentOrganizationResponseSchema, {
      organization: { id, name, slug },
      role: OrganizationRole.MEMBER,
    }),
  );
}

beforeEach(() => {
  runtime.slots = [];
  runtime.queued = [];
  resolveRpc.mockReset();
  harness.store = createStore();
  harness.store.dispatch(
    setCredentials({
      user: { id: "user" } as Parameters<typeof setCredentials>[0]["user"],
      accessToken: "access-acme",
      refreshToken: "refresh",
      organizationId: "org-acme",
      organizationSlug: "acme",
      sessionId: "session",
    }),
  );
  actions = [];
});

it("asks nothing while the page's own load has not failed", async () => {
  expect(render(NOTE_URN, false)).toEqual({ match: null, status: "idle" });
  expect(await renderSettled(NOTE_URN, false)).toEqual({ match: null, status: "idle" });

  expect(resolveRpc).not.toHaveBeenCalled();
});

it("offers the other organization that holds the item, asking once", async () => {
  resolvesTo("org-globex", "Globex", "globex");

  expect(render(NOTE_URN, true)).toEqual({ match: null, status: "resolving" });
  const lookup = await renderSettled(NOTE_URN, true);

  expect(lookup).toEqual({
    match: { id: "org-globex", name: "Globex", slug: "globex", role: OrganizationRole.MEMBER },
    status: "done",
  });
  expect(resolveRpc).toHaveBeenCalledOnce();
  expect(resolveRpc).toHaveBeenCalledWith({ urn: "urn:uniffy:content:NOTE:note-1" });

  render(NOTE_URN, false);
  expect(render(NOTE_URN, true)).toEqual(lookup);
  expect(resolveRpc).toHaveBeenCalledOnce();
});

it("finds nothing to offer when the tab's own organization holds the item", async () => {
  resolvesTo("org-acme", "Acme", "acme");

  expect(await renderSettled(NOTE_URN, true)).toEqual({ match: null, status: "done" });
  expect(resolveRpc).toHaveBeenCalledOnce();
});

it("treats NOT_FOUND as an answer, so nothing rejects and nothing toasts", async () => {
  resolveRpc.mockRejectedValue(new ConnectError("Content not found", Code.NotFound));

  expect(await renderSettled(NOTE_URN, true)).toEqual({ match: null, status: "done" });
  expect(actions).toContain("organizations/resolveContentOrganization/fulfilled");
  expect(actions).not.toContain("organizations/resolveContentOrganization/rejected");
});

it("settles with nothing to offer when the lookup itself fails", async () => {
  resolveRpc.mockRejectedValue(new ConnectError("Internal server error", Code.Internal));

  expect(await renderSettled(NOTE_URN, true)).toEqual({ match: null, status: "done" });
  expect(actions).toContain("organizations/resolveContentOrganization/rejected");
});

it("asks nothing for a malformed reference", async () => {
  expect(await renderSettled("not-a-urn", true)).toEqual({ match: null, status: "idle" });
  expect(resolveRpc).not.toHaveBeenCalled();
});
