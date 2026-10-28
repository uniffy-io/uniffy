import { beforeEach, expect, it, vi } from "vitest";
import { Code, ConnectError, type Interceptor } from "@connectrpc/connect";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { configureStore } from "@reduxjs/toolkit";
import { authReducer, setCredentials } from "@/features/auth/store/authSlice";
import { credentialMiddleware } from "@/features/auth/store/credentialMiddleware";

const shared = vi.hoisted(() => ({
  refresh: vi.fn(),
  interceptors: [] as Interceptor[],
  store: null as unknown,
}));
vi.mock("@connectrpc/connect", async (original) => ({
  ...(await original<typeof import("@connectrpc/connect")>()),
  createClient: () => ({
    refreshToken: shared.refresh,
    getCacheKeySeed: async () => ({ cacheKeySeed: new Uint8Array() }),
  }),
}));
vi.mock("@connectrpc/connect-web", () => ({
  createConnectTransport: ({ interceptors }: { interceptors?: Interceptor[] }) => {
    shared.interceptors.push(...(interceptors ?? []));
    return {};
  },
}));
vi.mock("@/config/env", () => ({ env: { apiBaseUrl: "http://test" } }));
vi.mock("@/app/storeRef", () => ({ getStoreRef: () => shared.store }));
vi.mock("@/shared/crypto/storageEncryption", () => ({ initStorageEncryption: vi.fn() }));

function errorInfo(reason: string, domain: string): Uint8Array {
  return new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string(reason)
    .tag(2, WireType.LengthDelimited)
    .string(domain)
    .finish();
}

function refusal(code: Code, detail?: Uint8Array): ConnectError {
  const error = new ConnectError("Permission denied: Requires organization membership", code);
  if (detail) error.details.push({ type: "google.rpc.ErrorInfo", value: detail });
  return error;
}

const membershipRefusal = () =>
  refusal(Code.PermissionDenied, errorInfo("membership_required", "uniffy"));

const TOKEN_EXPIRY = Math.floor(Date.now() / 1000) + 3600;

/** An access token far from expiry, so the interceptor sends it without refreshing first. */
function accessToken(name: string): string {
  const payload = btoa(JSON.stringify({ exp: TOKEN_EXPIRY, name }));
  return `header.${payload}.signature`;
}

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

async function loadApi() {
  const api = await import("@/config/api");
  const interceptor = shared.interceptors[0];
  if (!interceptor) throw new Error("the transport carries no interceptor");
  return { api, interceptor };
}

/** One RPC through the auth interceptor that the server answers with `refuse()`. */
function refusedCall(interceptor: Interceptor, refuse: () => ConnectError) {
  const call = interceptor(async () => {
    throw refuse();
  });
  return () =>
    call({ url: "http://test/notes.v1.NotesService/ListNotes", header: new Headers() } as never);
}

beforeEach(() => {
  vi.resetModules();
  shared.refresh.mockReset();
  shared.interceptors = [];
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
  const store = configureStore({
    reducer: { auth: authReducer },
    middleware: (getDefault) => getDefault().concat(credentialMiddleware),
  });
  store.dispatch(
    setCredentials({
      user: { id: "user" } as Parameters<typeof setCredentials>[0]["user"],
      accessToken: "unused",
      refreshToken: "first",
      organizationId: "org",
      organizationSlug: "acme",
      sessionId: "session",
    }),
  );
  shared.store = store;
  let minted = 0;
  shared.refresh.mockImplementation(async () => ({
    accessToken: accessToken(`fresh-${++minted}`),
    refreshToken: `refresh-${minted}`,
    organizationId: "org",
    organizationSlug: "acme",
    organizationRole: "member",
    sessionId: "session",
    domainAdminDomains: [],
  }));
});

it("recognises the membership reason only in a uniffy permission denial", async () => {
  const { api } = await loadApi();
  expect(api.decodeMembershipRequired(membershipRefusal())).toBe(true);
  expect(api.decodeMembershipRequired(refusal(Code.PermissionDenied))).toBe(false);
  expect(
    api.decodeMembershipRequired(
      refusal(Code.PermissionDenied, errorInfo("quota_exceeded", "uniffy")),
    ),
  ).toBe(false);
  expect(
    api.decodeMembershipRequired(
      refusal(Code.PermissionDenied, errorInfo("membership_required", "other")),
    ),
  ).toBe(false);
  expect(
    api.decodeMembershipRequired(
      refusal(Code.Unauthenticated, errorInfo("membership_required", "uniffy")),
    ),
  ).toBe(false);
  expect(
    api.decodeMembershipRequired(refusal(Code.PermissionDenied, new Uint8Array([0x0a, 0x7f]))),
  ).toBe(false);
  expect(api.decodeMembershipRequired(new Error("membership_required"))).toBe(false);
});

it("refreshes once per refused access token and still hands the refusal to the caller", async () => {
  const { api, interceptor } = await loadApi();
  api.setMemoryAccessToken(accessToken("first"));
  const call = refusedCall(interceptor, membershipRefusal);

  const outcomes = await Promise.allSettled([call(), call(), call()]);
  expect(outcomes.map((outcome) => outcome.status)).toEqual(["rejected", "rejected", "rejected"]);
  await vi.waitFor(() => expect(api.getAccessToken()).toBe(accessToken("fresh-1")));
  expect(shared.refresh).toHaveBeenCalledOnce();
  expect(shared.refresh).toHaveBeenCalledWith({
    refreshToken: "first",
    organizationId: "org",
    organizationSlug: "acme",
  });

  // The refreshed token kept the organization; a refusal of that token asks once more. Its round
  // trip cannot come back before the first refresh settles.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.allSettled([call(), call()]);
  await vi.waitFor(() => expect(api.getAccessToken()).toBe(accessToken("fresh-2")));
  expect(shared.refresh).toHaveBeenCalledTimes(2);
});

it("leaves a permission denial without the membership reason alone", async () => {
  const { api, interceptor } = await loadApi();
  api.setMemoryAccessToken(accessToken("first"));
  await expect(
    refusedCall(interceptor, () => refusal(Code.PermissionDenied))(),
  ).rejects.toBeInstanceOf(ConnectError);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(shared.refresh).not.toHaveBeenCalled();
});
