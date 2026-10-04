import { useCallback, useEffect, useState } from "react";
import { LockSimple, ShareNetwork } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
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
import { fetchSharedCalendars, restrictCalendarToMembers } from "@/features/calendar/store";
import type { SharedCalendarSummaryInfo } from "@/features/calendar/types";
import { accessModeLabel } from "@/shared/utils/contentRoles";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";

const grantSummary = (row: SharedCalendarSummaryInfo): string => {
  const parts: string[] = [];
  if (row.userGrantCount) {
    parts.push(`${row.userGrantCount} ${row.userGrantCount === 1 ? "person" : "people"}`);
  }
  if (row.groupGrantCount) {
    parts.push(`${row.groupGrantCount} ${row.groupGrantCount === 1 ? "group" : "groups"}`);
  }
  return parts.length ? parts.join(", ") : "No named members";
};

export function SharedCalendarsSection() {
  const dispatch = useAppDispatch();
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const { isOrgAdmin } = useAdminAccess();
  const [rows, setRows] = useState<SharedCalendarSummaryInfo[]>([]);
  const [nextPageToken, setNextPageToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [restrictTarget, setRestrictTarget] = useState<SharedCalendarSummaryInfo | null>(null);
  const [restricting, setRestricting] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(
    () =>
      dispatch(fetchSharedCalendars({})).then((outcome) => {
        setLoading(false);
        if (fetchSharedCalendars.fulfilled.match(outcome)) {
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
    const outcome = await dispatch(fetchSharedCalendars({ pageToken: nextPageToken }));
    setLoadingMore(false);
    if (fetchSharedCalendars.fulfilled.match(outcome)) {
      setRows((current) => [...current, ...outcome.payload.items]);
      setNextPageToken(outcome.payload.nextPageToken);
    }
  };

  const restrict = async () => {
    if (!restrictTarget) return;
    setRestricting(true);
    const outcome = await dispatch(restrictCalendarToMembers(restrictTarget.calendarId));
    setRestricting(false);
    if (restrictCalendarToMembers.fulfilled.match(outcome)) {
      const updated = outcome.payload;
      setRows((current) =>
        current.map((row) => (row.calendarId === updated.calendarId ? updated : row)),
      );
      toast.success("Organization-wide access removed");
    }
    setRestrictTarget(null);
  };

  if (!isOrgAdmin) return null;

  return (
    <section className="space-y-4 w-full mx-auto max-w-3xl">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <ShareNetwork size={22} weight="duotone" className="text-primary shrink-0" />
          <h2 className="text-lg font-semibold">Shared calendars</h2>
        </div>
        <p className="text-muted-foreground text-sm">
          Calendars that reach beyond their owner. You see who a calendar is shared with, never what
          is on it. A calendar open to the whole organization can be pulled back to its named
          members; that only ever removes access.
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Calendar</TableHead>
            <TableHead className="hidden md:table-cell">Access</TableHead>
            <TableHead className="hidden md:table-cell">Named members</TableHead>
            <TableHead className="w-28" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableLoading colSpan={4} message="Loading shared calendars..." />
          ) : loadFailed ? (
            <TableEmpty
              colSpan={4}
              title="Shared calendars could not be loaded"
              action={
                <Button variant="outline" size="sm" onClick={retry}>
                  Retry
                </Button>
              }
            />
          ) : rows.length === 0 ? (
            <TableEmpty
              colSpan={4}
              icon={<ShareNetwork className="h-10 w-10" weight="duotone" />}
              title="No shared calendars"
              description="Every calendar in the organization is private to its owner."
            />
          ) : (
            rows.map((row) => {
              const orgWide = row.accessMode === AccessMode.OPEN_TO_ORG;
              return (
                <TableRow key={row.calendarId}>
                  <TableCell>
                    <p className="text-sm font-medium text-foreground">{row.name}</p>
                    <p className="text-xs text-muted-foreground">{row.ownerName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground md:hidden">
                      {accessModeLabel(row.accessMode)} - {grantSummary(row)}
                    </p>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <span
                      className={
                        orgWide
                          ? "rounded-full bg-yellow-100 px-2 py-0.5 text-xs text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                          : "rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
                      }
                    >
                      {accessModeLabel(row.accessMode)}
                    </span>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {grantSummary(row)}
                  </TableCell>
                  <TableCell>
                    {orgWide && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRestrictTarget(row)}
                        title="Remove organization-wide access"
                        aria-label={`Restrict ${row.name} to its named members`}
                      >
                        <LockSimple className="h-4 w-4" />
                        Restrict
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })
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
        isOpen={!!restrictTarget}
        onClose={() => setRestrictTarget(null)}
        onConfirm={() => void restrict()}
        title="Remove organization-wide access?"
        message={`"${restrictTarget?.name}" will stop being visible to everyone in the organization. People and groups it was shared with by name keep their access. The owner can share it again within the calendar policy.`}
        confirmLabel="Remove access"
        variant="warning"
        loading={restricting}
      />
    </section>
  );
}
