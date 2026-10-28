import { Code, ConnectError } from "@connectrpc/connect";
import { decodeErrorReason } from "@core/api/errorInfo";

/** What the accept screen offers a signed-out holder: the account form, or the way to sign in. */
export type AcceptInviteState = "form" | "sign-in";

export interface AcceptInviteInput {
  accountExists: boolean;
  /** The anonymous accept was refused because the email already has an account. */
  signInRequired: boolean;
}

export function resolveAcceptState({
  accountExists,
  signInRequired,
}: AcceptInviteInput): AcceptInviteState {
  return accountExists || signInRequired ? "sign-in" : "form";
}

const SIGN_IN_REQUIRED_REASON = "sign_in_required";

/** The anonymous accept refused an email that already has an account. */
export function isSignInRequired(err: unknown): boolean {
  return (
    err instanceof ConnectError &&
    err.code === Code.FailedPrecondition &&
    decodeErrorReason(err) === SIGN_IN_REQUIRED_REASON
  );
}
