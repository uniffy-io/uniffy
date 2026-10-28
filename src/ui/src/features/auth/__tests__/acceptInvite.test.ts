import { describe, expect, it, vi } from "vitest";
import { Code, ConnectError } from "@connectrpc/connect";
import { BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { decodeErrorReason, decodeMembershipRequired } from "@/config/api";
import {
  invitationErrorMessage,
  invitationHeading,
  isSessionPending,
  isSignInRequired,
  resolveAcceptState,
  signInInvitationFrom,
  type AcceptInviteInput,
} from "@/features/auth/utils/acceptInviteState";

vi.mock("@connectrpc/connect-web", () => ({ createConnectTransport: () => ({}) }));
vi.mock("@/config/env", () => ({ env: { apiBaseUrl: "http://test" } }));
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
  const error = new ConnectError("Sign in to accept this invitation", code);
  if (detail) error.details.push({ type: "google.rpc.ErrorInfo", value: detail });
  return error;
}

function input(overrides: Partial<AcceptInviteInput>): AcceptInviteInput {
  return {
    isAuthenticated: false,
    userEmail: null,
    invitation: { email: "pat@example.com", accountExists: false },
    signInRequired: false,
    ...overrides,
  };
}

describe("resolveAcceptState", () => {
  it("offers the account form to a signed-out holder whose email has no account", () => {
    expect(resolveAcceptState(input({}))).toBe("form");
  });

  it("asks a signed-out holder to sign in when the email has an account", () => {
    expect(
      resolveAcceptState(input({ invitation: { email: "pat@example.com", accountExists: true } })),
    ).toBe("sign-in");
  });

  it("asks to sign in once the anonymous accept was refused for an existing account", () => {
    expect(resolveAcceptState(input({ signInRequired: true }))).toBe("sign-in");
  });

  it("offers the join when the signed-in email matches, whatever its case and spacing", () => {
    expect(
      resolveAcceptState(input({ isAuthenticated: true, userEmail: " Pat@Example.COM " })),
    ).toBe("join");
  });

  it("names the mismatch when another account is signed in", () => {
    expect(
      resolveAcceptState(
        input({ isAuthenticated: true, userEmail: "sam@example.com", signInRequired: true }),
      ),
    ).toBe("mismatch");
  });

  it("never offers the join without a signed-in email to compare", () => {
    expect(resolveAcceptState(input({ isAuthenticated: true, userEmail: null }))).toBe("mismatch");
    expect(
      resolveAcceptState(
        input({
          isAuthenticated: true,
          userEmail: "",
          invitation: { email: "", accountExists: true },
        }),
      ),
    ).toBe("mismatch");
  });
});

describe("isSessionPending", () => {
  it("waits while a stored session rehydrates or has not produced a sign-in yet", () => {
    expect(
      isSessionPending({ isAuthenticated: false, isRehydrating: true, refreshToken: "stored" }),
    ).toBe(true);
    expect(
      isSessionPending({ isAuthenticated: false, isRehydrating: false, refreshToken: "stored" }),
    ).toBe(true);
  });

  it("resolves at once for a visitor without a stored session and for a signed-in one", () => {
    expect(
      isSessionPending({ isAuthenticated: false, isRehydrating: false, refreshToken: null }),
    ).toBe(false);
    expect(
      isSessionPending({ isAuthenticated: true, isRehydrating: false, refreshToken: "stored" }),
    ).toBe(false);
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

  it("keeps the membership hint to a uniffy permission denial", () => {
    expect(
      decodeMembershipRequired(
        refusal(Code.PermissionDenied, errorInfo("membership_required", "uniffy")),
      ),
    ).toBe(true);
    expect(
      decodeMembershipRequired(
        refusal(Code.FailedPrecondition, errorInfo("membership_required", "uniffy")),
      ),
    ).toBe(false);
    expect(
      decodeMembershipRequired(
        refusal(Code.PermissionDenied, errorInfo("sign_in_required", "uniffy")),
      ),
    ).toBe(false);
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
    expect(isSignInRequired(refusal(Code.FailedPrecondition))).toBe(false);
  });
});

describe("invitationHeading", () => {
  const invitation = {
    organizationName: "Globex",
    email: "pat@example.com",
    inviterDisplayName: "Sam Admin",
  };

  it("addresses the invitee while the page can accept for them", () => {
    for (const state of ["form", "sign-in", "join"] as const) {
      expect(invitationHeading(invitation, state)).toEqual({
        title: "Join Globex",
        invited: "Sam Admin invited you",
      });
    }
    expect(invitationHeading({ ...invitation, inviterDisplayName: "" }, "join").invited).toBe(
      "You were invited",
    );
  });

  it("names the invitee when another account is signed in", () => {
    expect(invitationHeading(invitation, "mismatch")).toEqual({
      title: "Invitation to Globex",
      invited: "Sam Admin invited pat@example.com",
    });
    expect(invitationHeading({ ...invitation, inviterDisplayName: undefined }, "mismatch")).toEqual(
      {
        title: "Invitation to Globex",
        invited: "pat@example.com was invited",
      },
    );
  });
});

describe("invitationErrorMessage", () => {
  it("names a missing invitation instead of a missing page", () => {
    const message = invitationErrorMessage(new ConnectError("Invitation not found", Code.NotFound));
    expect(message).toMatch(/^No invitation matches this link\./);
  });

  it("names a suspended organization and an inactive account instead of a generic denial", () => {
    expect(
      invitationErrorMessage(
        new ConnectError("This organization is suspended", Code.PermissionDenied),
      ),
    ).toBe("This organization is suspended");
    expect(
      invitationErrorMessage(new ConnectError("Account is not active", Code.PermissionDenied)),
    ).toBe("Account is not active");
    expect(
      invitationErrorMessage(
        new ConnectError(
          "This invitation was sent to a different email address",
          Code.PermissionDenied,
        ),
      ),
    ).toBe("You do not have permission to perform this action.");
  });

  it("keeps the server's reason for an invitation that cannot be used", () => {
    expect(
      invitationErrorMessage(
        new ConnectError("Invitation has already been accepted", Code.FailedPrecondition),
      ),
    ).toBe("Invitation has already been accepted");
  });
});

describe("signInInvitationFrom", () => {
  it("reads the invitation the accept page handed to sign-in", () => {
    expect(
      signInInvitationFrom({
        from: { pathname: "/auth/accept-invite", search: "?token=abc" },
        invitation: { email: "pat@example.com", organizationName: "Globex" },
      }),
    ).toEqual({ email: "pat@example.com", organizationName: "Globex" });
  });

  it("ignores state without a usable invitation", () => {
    expect(signInInvitationFrom(null)).toBeNull();
    expect(signInInvitationFrom({ from: "/notes" })).toBeNull();
    expect(
      signInInvitationFrom({ invitation: { email: "", organizationName: "Globex" } }),
    ).toBeNull();
    expect(signInInvitationFrom({ invitation: { email: "pat@example.com" } })).toBeNull();
  });
});
