import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ConnectError } from "@connectrpc/connect";
import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { friendlyErrorMessage } from "@/config/errorMessages";
import { OrganizationAvatar } from "@/features/auth/components/OrganizationList";
import { useSwitchOrganization } from "@/features/auth/hooks/useSwitchOrganization";
import {
  selectInvitationActingId,
  selectPendingInvitations,
  selectPendingInvitationsStatus,
  type PendingInvitation,
} from "@/features/auth/store/invitationsSlice";
import {
  acceptInvitation,
  declineInvitation,
  fetchMyInvitations,
  refreshMyInvitationsQuietly,
} from "@/features/auth/store/invitationsThunks";
import { getRoleLabel } from "@/features/auth/utils/organizationRoles";
import { useRefreshOnReturn } from "@/shared/hooks/useRefreshOnReturn";
import { cn } from "@/shared/utils/cn";

function invitedAs(invitation: PendingInvitation): string {
  const role = getRoleLabel(invitation.role);
  return invitation.inviterDisplayName
    ? `Invited as ${role} by ${invitation.inviterDisplayName}`
    : `Invited as ${role}`;
}

function toastFailure(error: unknown): void {
  const message = friendlyErrorMessage(error instanceof Error ? error.message : "");
  if (message) toast.error(message);
}

/** Invitations addressed to the signed-in user; renders nothing until one is there to act on. */
export function PendingInvitations({ className }: { className?: string }) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const invitations = useAppSelector(selectPendingInvitations);
  const status = useAppSelector(selectPendingInvitationsStatus);
  const actingId = useAppSelector(selectInvitationActingId);
  const { guardSwitch, isSwitching, confirmDialog } = useSwitchOrganization();
  const [decliningId, setDecliningId] = useState<string | null>(null);

  // Invitations arrive while the app is open, so every mount reloads and every return to the tab
  // reloads quietly; a load that a switch interrupted settles back to idle and runs again.
  useEffect(() => {
    void dispatch(fetchMyInvitations());
  }, [dispatch]);
  const reloadInvitations = useCallback(
    () => void dispatch(refreshMyInvitationsQuietly()),
    [dispatch],
  );
  useRefreshOnReturn(reloadInvitations);
  useEffect(() => {
    if (status === "idle") void dispatch(fetchMyInvitations());
  }, [dispatch, status]);

  if (invitations.length === 0) return null;

  const busy = actingId !== null || isSwitching;

  // Accepting moves this tab into the organization, so the switch confirmation runs first.
  const handleAccept = (invitation: PendingInvitation) =>
    guardSwitch(async () => {
      try {
        const accepted = await dispatch(acceptInvitation({ invitationId: invitation.id }));
        toast.success(`Welcome to ${accepted.organizationName}`);
        navigate("/", { replace: true });
      } catch (error) {
        // A failed switch toasted already; the membership stands and the organization is listed.
        if (error instanceof ConnectError) toastFailure(error);
      }
    });

  const handleDecline = async (invitation: PendingInvitation) => {
    setDecliningId(invitation.id);
    try {
      await dispatch(declineInvitation({ invitationId: invitation.id }));
      toast.success("Invitation declined.");
    } catch (error) {
      toastFailure(error);
    } finally {
      setDecliningId(null);
    }
  };

  return (
    <section aria-labelledby="pending-invitations-title" className={cn("space-y-2", className)}>
      {confirmDialog}
      <h2
        id="pending-invitations-title"
        className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
      >
        Invitations
      </h2>
      <ul className="flex flex-col gap-2">
        {invitations.map((invitation) => {
          const acting = actingId === invitation.id;
          const declining = acting && decliningId === invitation.id;
          return (
            <li
              key={invitation.id}
              className="flex flex-col gap-3 rounded-xl bg-primary/5 p-3 shadow-edge-primary sm:flex-row sm:items-center sm:gap-4"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <OrganizationAvatar
                  name={invitation.organizationName}
                  className="h-9 w-9 rounded-lg text-xs"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    {invitation.organizationName}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {invitedAs(invitation)}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="ghost"
                  size="md"
                  className="max-md:h-11 max-sm:flex-1"
                  disabled={busy}
                  loading={declining}
                  onClick={() => void handleDecline(invitation)}
                >
                  Decline
                </Button>
                <Button
                  size="md"
                  className="max-md:h-11 max-sm:flex-1"
                  disabled={busy}
                  loading={acting && !declining}
                  onClick={() => void handleAccept(invitation)}
                >
                  Accept
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
