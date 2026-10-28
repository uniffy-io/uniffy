import { describe, expect, it } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { decodeErrorReason } from "@core/api/errorInfo";
import { isSignInRequired, resolveAcceptState } from "@features/auth/acceptInviteState";

function errorInfo(reason: string, domain: string): Uint8Array {
  return new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string(reason)
    .tag(2, WireType.LengthDelimited)
    .string(domain)
    .finish();
}

function refusal(code: Code, detail?: Uint8Array): ConnectError {
  const error = new ConnectError("Sign in to accept this invitation", code);
  if (detail) error.details.push({ type: "google.rpc.ErrorInfo", value: detail });
  return error;
}

describe("resolveAcceptState", () => {
  it("offers the account form when the email has no account", () => {
    expect(resolveAcceptState({ accountExists: false, signInRequired: false })).toBe("form");
  });

  it("asks to sign in when the email already has an account", () => {
    expect(resolveAcceptState({ accountExists: true, signInRequired: false })).toBe("sign-in");
  });

  it("asks to sign in once the anonymous accept was refused for an existing account", () => {
    expect(resolveAcceptState({ accountExists: false, signInRequired: true })).toBe("sign-in");
  });
});

describe("decodeErrorReason", () => {
  it("reads the reason of a uniffy ErrorInfo detail whatever the code", () => {
    expect(
      decodeErrorReason(refusal(Code.FailedPrecondition, errorInfo("sign_in_required", "uniffy"))),
    ).toBe("sign_in_required");
    expect(
      decodeErrorReason(refusal(Code.PermissionDenied, errorInfo("membership_required", "uniffy"))),
    ).toBe("membership_required");
  });

  it("returns null without a readable uniffy reason", () => {
    expect(decodeErrorReason(refusal(Code.FailedPrecondition))).toBeNull();
    expect(
      decodeErrorReason(refusal(Code.FailedPrecondition, errorInfo("sign_in_required", "other"))),
    ).toBeNull();
    expect(decodeErrorReason(refusal(Code.FailedPrecondition, errorInfo("", "uniffy")))).toBeNull();
    expect(
      decodeErrorReason(refusal(Code.FailedPrecondition, new Uint8Array([0x0a, 0x7f]))),
    ).toBeNull();
    expect(decodeErrorReason(new Error("sign_in_required"))).toBeNull();
  });
});

describe("isSignInRequired", () => {
  it("recognises the sign-in reason only on a failed precondition", () => {
    expect(
      isSignInRequired(refusal(Code.FailedPrecondition, errorInfo("sign_in_required", "uniffy"))),
    ).toBe(true);
    expect(
      isSignInRequired(refusal(Code.PermissionDenied, errorInfo("sign_in_required", "uniffy"))),
    ).toBe(false);
    expect(
      isSignInRequired(refusal(Code.FailedPrecondition, errorInfo("invitation_expired", "uniffy"))),
    ).toBe(false);
    expect(
      isSignInRequired(refusal(Code.FailedPrecondition, errorInfo("sign_in_required", "other"))),
    ).toBe(false);
    expect(isSignInRequired(refusal(Code.FailedPrecondition))).toBe(false);
  });
});
