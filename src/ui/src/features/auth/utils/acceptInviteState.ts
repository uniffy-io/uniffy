import { Code, ConnectError } from "@connectrpc/connect";
import { decodeErrorReason } from "@/config/api";

/**
 * What the accept page offers: the account form, a sign-in that keeps the token, a signed-in
 * join, or the note that another account is signed in.
 */
export type AcceptInviteState = "form" | "sign-in" | "join" | "mismatch";

export interface AcceptInviteInput {
  isAuthenticated: boolean;
  userEmail: string | null | undefined;
  invitation: { email: string; accountExists: boolean };
  /** The anonymous accept was refused because the email already has an active account. */
  signInRequired: boolean;
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

export function resolveAcceptState({
  isAuthenticated,
  userEmail,
  invitation,
  signInRequired,
}: AcceptInviteInput): AcceptInviteState {
  if (isAuthenticated) {
    const signedIn = normalizeEmail(userEmail);
    return signedIn !== "" && signedIn === normalizeEmail(invitation.email) ? "join" : "mismatch";
  }
  return invitation.accountExists || signInRequired ? "sign-in" : "form";
}

const SIGN_IN_REQUIRED_REASON = "sign_in_required";

/** The anonymous accept refused an email that already has an active account. */
export function isSignInRequired(err: unknown): boolean {
  return (
    err instanceof ConnectError &&
    err.code === Code.FailedPrecondition &&
    decodeErrorReason(err) === SIGN_IN_REQUIRED_REASON
  );
}
