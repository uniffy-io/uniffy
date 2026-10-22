import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { create, toBinary } from "@bufbuild/protobuf";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { RefreshTokenResponseSchema } from "@uniffy/proto/auth/v1/auth_pb";

const secure = vi.hoisted(() => new Map<string, string>());
vi.mock("react-native", () => ({ Platform: { OS: "ios", Version: "18" } }));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "0" } } }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: async (key: string) => secure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    secure.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    secure.delete(key);
  },
}));

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

function refreshEndpoint(organizationId = "org") {
  const endpoint = { requests: 0 };
  secure.set("uniffy_refresh_token", "refresh");
  vi.stubGlobal("fetch", async () => {
    endpoint.requests += 1;
    const issued = create(RefreshTokenResponseSchema, {
      accessToken: `fresh-${endpoint.requests}`,
      refreshToken: `refresh-${endpoint.requests}`,
      organizationId,
      organizationSlug: "org",
    });
    return new Response(toBinary(RefreshTokenResponseSchema, issued), {
      status: 200,
      headers: { "Content-Type": "application/proto" },
    });
  });
  return endpoint;
}

async function interceptedCall(refuse: () => ConnectError) {
  const { createAuthInterceptor } = await import("@core/api/authInterceptor");
  const call = createAuthInterceptor({ retryOn401: true })(async () => {
    throw refuse();
  });
  return () => call({ header: new Headers() } as never);
}

beforeEach(() => {
  vi.resetModules();
  secure.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

it("recognises the membership reason only in a uniffy permission denial", async () => {
  const { isMembershipDenial } = await import("@core/api/authInterceptor");
  expect(isMembershipDenial(membershipRefusal())).toBe(true);
  expect(isMembershipDenial(refusal(Code.PermissionDenied))).toBe(false);
  expect(
    isMembershipDenial(refusal(Code.PermissionDenied, errorInfo("quota_exceeded", "uniffy"))),
  ).toBe(false);
  expect(
    isMembershipDenial(refusal(Code.PermissionDenied, errorInfo("membership_required", "other"))),
  ).toBe(false);
  expect(
    isMembershipDenial(refusal(Code.Unauthenticated, errorInfo("membership_required", "uniffy"))),
  ).toBe(false);
  expect(isMembershipDenial(refusal(Code.PermissionDenied, new Uint8Array([0x0a, 0x7f])))).toBe(
    false,
  );
  expect(isMembershipDenial(new Error("membership_required"))).toBe(false);
});

it("refreshes once per refused access token and still hands the refusal to the caller", async () => {
  const refresh = refreshEndpoint();
  const { getAccessToken, setAccessToken } = await import("@core/auth/auth");
  // Joining the refresh a refused token started resolves once that refresh is over.
  const { refreshAfterMembershipDenial } = await import("@core/auth/refresh");
  setAccessToken("token");
  const call = await interceptedCall(membershipRefusal);

  const outcomes = await Promise.allSettled([call(), call(), call()]);
  expect(outcomes.map((outcome) => outcome.status)).toEqual(["rejected", "rejected", "rejected"]);
  await refreshAfterMembershipDenial("token");
  expect(getAccessToken()).toBe("fresh-1");
  expect(refresh.requests).toBe(1);

  // The refreshed token kept the organization; a refusal of that token asks once more.
  const again = await Promise.allSettled([call(), call()]);
  expect(again.map((outcome) => outcome.status)).toEqual(["rejected", "rejected"]);
  await refreshAfterMembershipDenial("fresh-1");
  expect(getAccessToken()).toBe("fresh-2");
  expect(refresh.requests).toBe(2);
});

it("leaves a permission denial without the membership reason alone", async () => {
  const refresh = refreshEndpoint();
  (await import("@core/auth/auth")).setAccessToken("token");
  const call = await interceptedCall(() => refusal(Code.PermissionDenied));
  await expect(call()).rejects.toBeInstanceOf(ConnectError);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(refresh.requests).toBe(0);
});

async function interceptedStream(messages: AsyncIterable<unknown>) {
  const { createAuthInterceptor } = await import("@core/api/authInterceptor");
  const next = vi.fn(async () => ({
    stream: true,
    message: messages,
    header: new Headers(),
    trailer: new Headers(),
  }));
  const response = await createAuthInterceptor({ retryOn401: false })(next as never)({
    stream: true,
    header: new Headers(),
  } as never);
  if (!response.stream) throw new Error("Expected streaming response");
  return { iterator: response.message[Symbol.asyncIterator](), next };
}

it("refreshes and announces lost access when a running stream loses membership", async () => {
  const refresh = refreshEndpoint("");
  const { setAccessToken, setStoredOrgId, getStoredOrgId } = await import("@core/auth/auth");
  const { refreshAfterMembershipDenial } = await import("@core/auth/refresh");
  const { onOrganizationLost } = await import("@core/auth/sessionEvents");
  const lost = vi.fn();
  const unsubscribe = onOrganizationLost(lost);
  setAccessToken("token");
  await setStoredOrgId("org", "org");
  const error = membershipRefusal();
  const message = create(RefreshTokenResponseSchema);
  const closed = vi.fn();
  const stream = await interceptedStream(
    (async function* () {
      try {
        yield message;
        throw error;
      } finally {
        closed();
      }
    })(),
  );

  expect(await stream.iterator.next()).toEqual({ done: false, value: message });
  expect(refresh.requests).toBe(0);
  await expect(stream.iterator.next()).rejects.toBe(error);
  await refreshAfterMembershipDenial("token");
  expect(refresh.requests).toBe(1);
  expect(lost).toHaveBeenCalledOnce();
  expect(await getStoredOrgId()).toBeNull();
  expect(stream.next).toHaveBeenCalledOnce();
  expect(closed).toHaveBeenCalledOnce();
  unsubscribe();
});

it.each([Code.PermissionDenied, Code.Unauthenticated, Code.Unavailable, Code.Canceled])(
  "propagates stream error %s without refreshing or replaying the request",
  async (code) => {
    const refresh = refreshEndpoint();
    (await import("@core/auth/auth")).setAccessToken("token");
    const error = refusal(code);
    const stream = await interceptedStream(
      (async function* () {
        yield create(RefreshTokenResponseSchema);
        throw error;
      })(),
    );
    await stream.iterator.next();
    await expect(stream.iterator.next()).rejects.toBe(error);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(refresh.requests).toBe(0);
    expect(stream.next).toHaveBeenCalledOnce();
  },
);

it("closes the underlying stream when its consumer stops reading", async () => {
  const closed = vi.fn();
  const stream = await interceptedStream(
    (async function* () {
      try {
        yield create(RefreshTokenResponseSchema);
        yield create(RefreshTokenResponseSchema);
      } finally {
        closed();
      }
    })(),
  );
  await stream.iterator.next();
  await stream.iterator.return?.();
  expect(closed).toHaveBeenCalledOnce();
});
