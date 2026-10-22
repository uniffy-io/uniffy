import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authApi } from "@core/auth/authApi";
import { useAuth } from "@core/providers/AuthContext";
import { userFacingError } from "@shared/lib/userFacingError";
import type { InvitationAction, PendingInvitationAction } from "@features/auth/invitationRows";
import {
  toInvitationSummaries,
  type InvitationSummary,
} from "@features/auth/organizationSerializer";
import { claimOrganizationSwitch } from "@features/auth/organizationSwitchGuard";
import { MY_ORGANIZATIONS_QUERY_KEY } from "@features/auth/useMyOrganizations";

export const MY_INVITATIONS_QUERY_KEY = ["invitations", "mine"];

const ACCEPT_FAILED_MESSAGE = "Could not accept the invitation. Try again.";
const DECLINE_FAILED_MESSAGE = "Could not decline the invitation. Try again.";

export function useMyInvitations() {
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: MY_INVITATIONS_QUERY_KEY,
    queryFn: authApi.listMyInvitations,
    select: toInvitationSummaries,
    enabled: isAuthenticated,
  });
}

export function useInvitationActions() {
  const { selectOrganization } = useAuth();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingInvitationAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (
    invitation: InvitationSummary,
    action: InvitationAction,
    work: () => Promise<void>,
  ) => {
    const release = claimOrganizationSwitch();
    if (!release) return;
    setPending({ invitationId: invitation.id, action });
    setError(null);
    try {
      await work();
    } finally {
      release();
      setPending(null);
    }
  };

  const accept = (invitation: InvitationSummary) =>
    run(invitation, "accept", async () => {
      const joined = await authApi.acceptMyInvitation({ invitationId: invitation.id }).then(
        ({ organization }) =>
          organization?.organization ?? {
            id: invitation.organizationId,
            slug: invitation.organizationSlug,
          },
        (err: unknown) => {
          setError(userFacingError(err, ACCEPT_FAILED_MESSAGE));
          return null;
        },
      );
      // A refused accept refreshes too: an expired, revoked or used invitation leaves the list.
      void queryClient.invalidateQueries({ queryKey: MY_INVITATIONS_QUERY_KEY });
      if (!joined) return;
      void queryClient.invalidateQueries({ queryKey: MY_ORGANIZATIONS_QUERY_KEY });
      try {
        await selectOrganization(joined.slug, joined.id);
      } catch (err) {
        setError(
          userFacingError(
            err,
            `You joined ${invitation.organizationName} but it could not be opened. Pick it from the list.`,
          ),
        );
      }
    });

  const decline = (invitation: InvitationSummary) =>
    run(invitation, "decline", async () => {
      try {
        await authApi.declineMyInvitation({ invitationId: invitation.id });
      } catch (err) {
        setError(userFacingError(err, DECLINE_FAILED_MESSAGE));
      }
      void queryClient.invalidateQueries({ queryKey: MY_INVITATIONS_QUERY_KEY });
    });

  return { accept, decline, pending, error };
}
