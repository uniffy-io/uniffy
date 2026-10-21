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

/** The auth server behind the refresh endpoint; every answer keeps the organization. */
function refreshEndpoint() {
  const endpoint = { requests: 0 };
  secure.set("uniffy_refresh_token", "refresh");
  vi.stubGlobal("fetch", async () => {
    endpoint.requests += 1;
    const issued = create(RefreshTokenResponseSchema, {
      accessToken: `fresh-${endpoint.requests}`,
      refreshToken: `refresh-${endpoint.requests}`,
      organizationId: "org",
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
