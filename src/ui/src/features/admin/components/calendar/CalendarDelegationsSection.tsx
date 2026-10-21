import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Trash, UserSwitch } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { SubjectAvatar, SUBJECT_TYPE } from "@/components/subject";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
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
import { useAdminAccess } from "@/features/admin/hooks/useAdminHooks";
import { adminRevokeDelegation, fetchOrgDelegations } from "@/features/calendar/store";
import type { CalendarDelegationInfo } from "@/features/calendar/types";
import { delegationLevelLabel } from "@/features/calendar/utils/delegation";
import { formatDateShort } from "@/shared/utils/dateFormatting";

export function CalendarDelegationsSection() {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const { isOrgAdmin } = useAdminAccess();
  const [rows, setRows] = useState<CalendarDelegationInfo[]>([]);
  const [nextPageToken, setNextPageToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<CalendarDelegationInfo | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(
    () =>
      dispatch(fetchOrgDelegations({})).then((outcome) => {
        setLoading(false);
        if (fetchOrgDelegations.fulfilled.match(outcome)) {
          setRows(outcome.payload.items);
          setNextPageToken(outcome.payload.nextPageToken);
        } else {
          setLoadFailed(true);
        }
      }),
    [dispatch],
  );

  useEffect(() => {
    if (!organizationId || !isOrgAdmin) return;
    void load();
  }, [load, organizationId, isOrgAdmin]);

  const retry = () => {
    setLoadFailed(false);
    setLoading(true);
    void load();
  };

  const loadMore = async () => {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    const outcome = await dispatch(fetchOrgDelegations({ pageToken: nextPageToken }));
    setLoadingMore(false);
    if (fetchOrgDelegations.fulfilled.match(outcome)) {
      setRows((current) => [...current, ...outcome.payload.items]);
      setNextPageToken(outcome.payload.nextPageToken);
    }
  };

  const revoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    const outcome = await dispatch(adminRevokeDelegation(revokeTarget.id));
    setRevoking(false);
    if (adminRevokeDelegation.fulfilled.match(outcome)) {
      setRows((current) => current.filter((row) => row.id !== revokeTarget.id));
      toast.success("Delegation revoked");
    }
    setRevokeTarget(null);
  };

  if (!isOrgAdmin) return null;

  return (
    <section className="space-y-4 w-full mx-auto max-w-3xl">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <UserSwitch size={22} weight="duotone" className="text-primary shrink-0" />
          <h2 className="text-lg font-semibold">Calendar delegations</h2>
        </div>
        <p className="text-muted-foreground text-sm">
          Who can act on whose personal calendar. Revoking ends the delegate&apos;s access at once;
          it does not show you anything on the calendar.
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Delegation</TableHead>
            <TableHead className="hidden md:table-cell">Level</TableHead>
            <TableHead className="hidden md:table-cell">Since</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableLoading colSpan={4} message="Loading delegations..." />
          ) : loadFailed ? (
            <TableEmpty
              colSpan={4}
              title="Delegations could not be loaded"
              action={
                <Button variant="outline" size="sm" onClick={retry}>
                  Retry
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <TableEmpty
              colSpan={4}
              icon={<UserSwitch className="h-10 w-10" weight="duotone" />}
              title="No delegations"
              description="When a member makes a colleague their calendar delegate, it shows up here."
            />
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <SubjectAvatar
                      subject={{
                        id: row.grantorId,
                        name: row.grantorName,
                        type: SUBJECT_TYPE.USER,
                      }}
                      size="xs"
                    />
                    <span className="font-medium text-foreground">{row.grantorName}</span>
                    <ArrowRight className="h-3.5 w-3.5 text-subtle-foreground" />
                    <SubjectAvatar
                      subject={{
                        id: row.delegateId,
                        name: row.delegateName,
                        type: SUBJECT_TYPE.USER,
                      }}
                      size="xs"
                    />
                    <span className="text-foreground">{row.delegateName}</span>
                    {row.inactive && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground md:hidden">
                    {delegationLevelLabel(row.level)}
                  </p>
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                  {delegationLevelLabel(row.level)}
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                  {row.createdAt ? formatDateShort(row.createdAt) : "-"}
                </TableCell>
                <TableCell>
                  <button
                    type="button"
                    onClick={() => setRevokeTarget(row)}
                    className="rounded p-2 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500 focus-ring"
                    title="Revoke delegation"
                    aria-label={`Revoke ${row.delegateName}'s delegation for ${row.grantorName}`}
                  >
                    <Trash className="h-4 w-4" />
                  </button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {nextPageToken && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => void loadMore()} loading={loadingMore}>
            Load more
          </Button>
        </div>
      )}

      <ConfirmDialog
        isOpen={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        onConfirm={() => void revoke()}
        title="Revoke delegation?"
        message={`${revokeTarget?.delegateName} will immediately lose access to ${revokeTarget?.grantorName}'s calendar. Both of them are notified.`}
        confirmLabel="Revoke"
        variant="danger"
        loading={revoking}
      />
    </section>
  );
}
