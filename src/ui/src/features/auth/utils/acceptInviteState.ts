import { Code, ConnectError } from "@connectrpc/connect";
import { decodeErrorReason } from "@/config/api";
import { friendlyErrorMessage } from "@/config/errorMessages";

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

export interface InvitationHeading {
  title: string;
  /** Who invited whom, ending where the page appends the role. */
  invited: string;
}

/** The header addresses the invitee, and names them instead when another account is signed in. */
export function invitationHeading(
  invitation: { organizationName: string; email: string; inviterDisplayName?: string },
  state: AcceptInviteState,
): InvitationHeading {
  const inviter = invitation.inviterDisplayName;
  if (state === "mismatch") {
    return {
      title: `Invitation to ${invitation.organizationName}`,
      invited: inviter
        ? `${inviter} invited ${invitation.email}`
        : `${invitation.email} was invited`,
    };
  }
  return {
    title: `Join ${invitation.organizationName}`,
    invited: inviter ? `${inviter} invited you` : "You were invited",
  };
}

const INVITATION_NOT_FOUND =
  "No invitation matches this link. Check that the whole link was copied, or ask for a new invitation.";

/** A missing invitation gets its own copy; the generic not-found message reads like a missing page. */
export function invitationErrorMessage(err: unknown): string | null {
  if (err instanceof ConnectError && err.code === Code.NotFound) return INVITATION_NOT_FOUND;
  return friendlyErrorMessage(err instanceof Error ? err.message : "");
}

/** Router state the accept page hands to `/auth`, so sign-in can name the invitation and its email. */
export interface SignInInvitation {
  email: string;
  organizationName: string;
}

export function signInInvitationFrom(state: unknown): SignInInvitation | null {
  const invitation = (state as { invitation?: unknown } | null | undefined)?.invitation;
  if (!invitation || typeof invitation !== "object") return null;
  const { email, organizationName } = invitation as Record<string, unknown>;
  if (typeof email !== "string" || !email || typeof organizationName !== "string") return null;
  return { email, organizationName };
}
