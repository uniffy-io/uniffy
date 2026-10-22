import {
  organizationRoleLabel,
  type InvitationSummary,
} from "@features/auth/organizationSerializer";

export type InvitationAction = "accept" | "decline";

export type PendingInvitationAction = { invitationId: string; action: InvitationAction };

export type InvitationRowState = { accepting: boolean; declining: boolean; disabled: boolean };

/** One action runs at a time: accepting switches the session, so every other row waits. */
export function invitationRowState(
  pending: PendingInvitationAction | null,
  invitationId: string,
): InvitationRowState {
  const action = pending?.invitationId === invitationId ? pending.action : null;
  return {
    accepting: action === "accept",
    declining: action === "decline",
    disabled: pending !== null,
  };
}

export function invitationSubtitle({
  role,
  inviterDisplayName,
}: Pick<InvitationSummary, "role" | "inviterDisplayName">): string {
  const invitedAs = `Invited as ${organizationRoleLabel(role)}`;
  return inviterDisplayName ? `${invitedAs} by ${inviterDisplayName}` : invitedAs;
}
