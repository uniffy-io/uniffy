import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Clock,
  CheckCircle,
  XCircle,
  ArrowsClockwise,
  Trash,
  EnvelopeOpen,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableLoading,
  TableRow,
} from "@/components/ui/table";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/select";
import { invitationsApi } from "@/features/admin/api/invitationsApi";
import { InvitationStatus, type Invitation } from "@uniffy/proto/organizations/v1/organizations_pb";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import { formatProtoDateTime } from "@/shared/utils/dateFormatting";
import { friendlyErrorMessage } from "@/config";

interface InvitationsTableProps {
  organizationId: string;
  /** Bumps when the parent wants a forced refresh after sending a new invite. */
  refreshKey: number;
}

const STATUS_FILTER_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: String(InvitationStatus.PENDING), label: "Pending" },
  { value: String(InvitationStatus.ACCEPTED), label: "Accepted" },
  { value: String(InvitationStatus.REVOKED), label: "Revoked" },
  { value: String(InvitationStatus.EXPIRED), label: "Expired" },
];

function roleLabel(role: OrganizationRole): string {
  switch (role) {
    case OrganizationRole.OWNER:
      return "Owner";
    case OrganizationRole.ADMIN:
      return "Admin";
    case OrganizationRole.MEMBER:
      return "Member";
    default:
      return "Member";
  }
}

function StatusBadge({ status }: { status: InvitationStatus }) {
  if (status === InvitationStatus.ACCEPTED) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
                bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
      >
        <CheckCircle size={12} weight="fill" /> Accepted
      </span>
    );
  }
  if (status === InvitationStatus.REVOKED) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
                bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
      >
        <XCircle size={12} weight="fill" /> Revoked
      </span>
    );
  }
  if (status === InvitationStatus.EXPIRED) {
    return (
      <span
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
                bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
      >
        <Clock size={12} weight="fill" /> Expired
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium
            bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400"
    >
      <Clock size={12} weight="fill" /> Pending
    </span>
  );
}

interface InvitationRowProps {
  invitation: Invitation;
  onRevoke: (id: string) => Promise<void>;
  onResend: (id: string) => Promise<void>;
  busyId: string | null;
}

function InvitationRow({ invitation, onRevoke, onResend, busyId }: InvitationRowProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const isBusy = busyId === invitation.id;
  const isPending = invitation.status === InvitationStatus.PENDING;
  const isRevocable = isPending;
  const isResendable = isPending || invitation.status === InvitationStatus.EXPIRED;

  return (
    <>
      <TableRow className={isBusy ? "opacity-60" : ""}>
        <TableCell>
          <div>
            <p className="text-sm font-medium text-foreground">{invitation.email}</p>
            <p className="text-xs text-muted-foreground">
              Invited by {invitation.invitedByDisplayName || "Unknown"}
            </p>
          </div>
        </TableCell>
        <TableCell align="center" className="hidden md:table-cell text-sm">
          {roleLabel(invitation.role)}
        </TableCell>
        <TableCell align="center" className="hidden lg:table-cell text-xs text-muted-foreground">
          {formatProtoDateTime(invitation.expiresAt)}
        </TableCell>
        <TableCell align="center">
          <StatusBadge status={invitation.status} />
        </TableCell>
        <TableCell align="right">
          <div className="flex items-center justify-end gap-1">
            {isResendable && (
              <button
                type="button"
                onClick={() => onResend(invitation.id)}
                disabled={isBusy}
                title="Resend invitation"
                className="p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/60
                                    disabled:opacity-40"
              >
                <ArrowsClockwise size={16} />
              </button>
            )}
            {isRevocable && (
              <button
                type="button"
                onClick={() => setConfirmOpen(true)}
                disabled={isBusy}
                title="Revoke invitation"
                className="p-2 rounded-md text-muted-foreground hover-destructive
                                    disabled:opacity-40"
              >
                <Trash size={16} />
              </button>
            )}
          </div>
        </TableCell>
      </TableRow>
      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={async () => {
          await onRevoke(invitation.id);
          setConfirmOpen(false);
        }}
        title="Revoke invitation"
        message={`Revoke the pending invitation for ${invitation.email}? The link in their email will stop working.`}
        confirmLabel="Revoke"
        variant="danger"
      />
    </>
  );
}

export function InvitationsTable({ organizationId, refreshKey }: InvitationsTableProps) {
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await invitationsApi.list({ organizationId });
      setInvitations(response.invitations ?? []);
    } catch (err) {
      const friendly =
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
        "Could not load invitations";
      setError(friendly);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    // eslint-disable-next-line react/react-compiler -- fetch on mount and on every refreshKey bump; reload raises the loading flag before awaiting the API
    void reload();
  }, [reload, refreshKey]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return invitations;
    const status = Number(statusFilter) as InvitationStatus;
    return invitations.filter((inv) => inv.status === status);
  }, [invitations, statusFilter]);

  const handleRevoke = async (id: string) => {
    setBusyId(id);
    try {
      await invitationsApi.revoke({ invitationId: id });
      toast.success("Invitation revoked");
      await reload();
    } catch (err) {
      const friendly =
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
        "Could not revoke invitation";
      toast.error(friendly);
    } finally {
      setBusyId(null);
    }
  };

  const handleResend = async (id: string) => {
    setBusyId(id);
    try {
      await invitationsApi.resend({ invitationId: id });
      toast.success("Invitation resent");
      await reload();
    } catch (err) {
      const friendly =
        friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
        "Could not resend invitation";
      toast.error(friendly);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <EnvelopeOpen size={18} weight="duotone" className="text-muted-foreground" />
          <h2 className="text-sm font-semibold">Invitations</h2>
          <span className="text-xs text-muted-foreground">({invitations.length})</span>
        </div>
        <Select
          value={statusFilter}
          onChange={setStatusFilter}
          options={STATUS_FILTER_OPTIONS}
          size="sm"
        />
      </div>

      {error && (
        <div className="p-3 rounded-md border status-error">
          <p className="text-sm" style={{ color: "var(--status-error)" }}>
            {error}
          </p>
        </div>
      )}

      <Table>
        <TableHeader>
          <TableRow hoverable={false}>
            <TableHead>Recipient</TableHead>
            <TableHead align="center" className="hidden md:table-cell">
              Role
            </TableHead>
            <TableHead align="center" className="hidden lg:table-cell">
              Expires
            </TableHead>
            <TableHead align="center">Status</TableHead>
            <TableHead align="right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableLoading colSpan={5} message="Loading invitations..." />
          ) : filtered.length === 0 ? (
            <TableEmpty
              colSpan={5}
              icon={<EnvelopeOpen size={36} weight="duotone" />}
              title={
                statusFilter === "all" ? "No invitations yet" : "No invitations match this filter"
              }
            />
          ) : (
            filtered.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                onRevoke={handleRevoke}
                onResend={handleResend}
                busyId={busyId}
              />
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
