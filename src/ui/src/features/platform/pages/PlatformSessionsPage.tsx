import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle,
  Clock,
  Hourglass,
  Lifebuoy,
  MagnifyingGlass,
  Prohibit,
  XCircle,
} from "@phosphor-icons/react";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
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
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { friendlyErrorMessage } from "@/config";
import { getAvatarGradientStyle, getInitials } from "@/components/subject/utils";
import { SubjectAvatarById } from "@/components/subject";
import { supportSessionsApi } from "@/features/platform/api/supportSessionsApi";
import { PlatformSessionDetailDialog } from "@/features/platform/components/PlatformSessionDetailDialog";
import {
  SupportSessionScope,
  SupportSessionState,
  type SupportSession,
} from "@uniffy/proto/support/v1/support_consent_pb";

type ProtoTimestamp = { seconds: number | bigint; nanos: number };

const PAGE_SIZE = 50;

function protoToDate(ts: ProtoTimestamp | undefined): Date | undefined {
  if (!ts) return undefined;
  const ms = typeof ts.seconds === "bigint" ? Number(ts.seconds) * 1000 : ts.seconds * 1000;
  return new Date(ms);
}

type StateFilter = "all" | "pending" | "active" | "expired" | "revoked" | "rejected";

const STATE_FILTER_TO_PROTO: Record<StateFilter, SupportSessionState> = {
  all: SupportSessionState.UNSPECIFIED,
  pending: SupportSessionState.PENDING,
  active: SupportSessionState.ACTIVE,
  expired: SupportSessionState.EXPIRED,
  revoked: SupportSessionState.REVOKED,
  rejected: SupportSessionState.REJECTED,
};

const STATE_FILTERS: { id: StateFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending", label: "Pending" },
  { id: "active", label: "Active" },
  { id: "expired", label: "Expired" },
  { id: "revoked", label: "Revoked" },
  { id: "rejected", label: "Rejected" },
];

function StateBadge({ state }: { state: SupportSessionState }) {
  const map: Record<number, { label: string; cls: string; Icon: typeof CheckCircle }> = {
    [SupportSessionState.PENDING]: {
      label: "Pending",
      cls: "bg-gradient-to-r from-amber-100 to-amber-200 text-amber-700 dark:from-amber-950 dark:to-amber-900 dark:text-amber-300",
      Icon: Hourglass,
    },
    [SupportSessionState.ACTIVE]: {
      label: "Active",
      cls: "bg-gradient-to-r from-emerald-100 to-emerald-200 text-emerald-700 dark:from-emerald-950 dark:to-emerald-900 dark:text-emerald-300",
      Icon: CheckCircle,
    },
    [SupportSessionState.EXPIRED]: {
      label: "Expired",
      cls: "bg-muted text-muted-foreground",
      Icon: Clock,
    },
    [SupportSessionState.REVOKED]: {
      label: "Revoked",
      cls: "bg-gradient-to-r from-red-100 to-red-200 text-red-700 dark:from-red-950 dark:to-red-900 dark:text-red-300",
      Icon: Prohibit,
    },
    [SupportSessionState.REJECTED]: {
      label: "Rejected",
      cls: "bg-gradient-to-r from-red-100 to-red-200 text-red-700 dark:from-red-950 dark:to-red-900 dark:text-red-300",
      Icon: XCircle,
    },
  };
  const entry = map[state];
  if (!entry) return <span className="text-xs text-muted-foreground">-</span>;
  const Icon = entry.Icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        entry.cls,
      )}
    >
      <Icon size={12} weight="fill" />
      {entry.label}
    </span>
  );
}

interface SessionStats {
  active: number;
  pending: number;
  total: number;
}

export function PlatformSessionsPage() {
  useDocumentTitle("Platform Support Sessions");
  const [rows, setRows] = useState<SupportSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [selected, setSelected] = useState<SupportSession | null>(null);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const response = await supportSessionsApi.listAll({
        page,
        pageSize: PAGE_SIZE,
        state: STATE_FILTER_TO_PROTO[stateFilter],
        search,
      });
      setRows(response.sessions);
      setTotalCount(response.totalCount);
    } catch (error) {
      const message = friendlyErrorMessage((error as Error).message);
      if (message) toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [page, search, stateFilter]);

  const fetchStats = useCallback(async () => {
    try {
      const [active, pending, total] = await Promise.all([
        supportSessionsApi.listAll({
          page: 0,
          pageSize: 1,
          state: SupportSessionState.ACTIVE,
        }),
        supportSessionsApi.listAll({
          page: 0,
          pageSize: 1,
          state: SupportSessionState.PENDING,
        }),
        supportSessionsApi.listAll({ page: 0, pageSize: 1 }),
      ]);
      setStats({
        active: active.totalCount,
        pending: pending.totalCount,
        total: total.totalCount,
      });
    } catch {
      setStats(null);
    }
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const refreshAll = useCallback(() => {
    fetchRows();
    fetchStats();
  }, [fetchRows, fetchStats]);

  const pageInfo = useMemo(() => {
    const start = page * PAGE_SIZE;
    const end = Math.min(start + rows.length, totalCount);
    return totalCount > 0 ? `${start + 1}-${end} of ${totalCount}` : "0";
  }, [page, rows.length, totalCount]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Lifebuoy size={24} weight="duotone" className="text-primary shrink-0" />
          <h1 className="text-xl md:text-2xl font-bold">Support sessions</h1>
        </div>
        <p className="text-muted-foreground text-sm">
          Every time-bound operator grant across the deployment. Read-only metadata.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 md:gap-4">
        <div className="p-3 md:p-4 rounded-lg border border-border bg-card">
          <p className="text-xl md:text-2xl font-bold">{stats?.active ?? "-"}</p>
          <p className="text-xs md:text-sm text-muted-foreground">Active</p>
        </div>
        <div className="p-3 md:p-4 rounded-lg border border-border bg-card">
          <p className="text-xl md:text-2xl font-bold">{stats?.pending ?? "-"}</p>
          <p className="text-xs md:text-sm text-muted-foreground">Pending approval</p>
        </div>
        <div className="p-3 md:p-4 rounded-lg border border-border bg-card">
          <p className="text-xl md:text-2xl font-bold">{stats?.total ?? "-"}</p>
          <p className="text-xs md:text-sm text-muted-foreground">Total sessions</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2 md:gap-4">
        <div className="relative flex-1 max-w-sm">
          <MagnifyingGlass
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            placeholder="Search by org or operator email"
            className="w-full pl-9 pr-4 py-2 rounded-md border border-border bg-background
                            text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {STATE_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setStateFilter(f.id);
                setPage(0);
              }}
              className={cn(
                "px-3 py-1 rounded-full text-xs font-medium transition-colors",
                stateFilter === f.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow hoverable={false}>
            <TableHead>Organization</TableHead>
            <TableHead className="hidden md:table-cell">Operator</TableHead>
            <TableHead align="center" className="hidden sm:table-cell">
              Scope
            </TableHead>
            <TableHead align="center">State</TableHead>
            <TableHead className="hidden lg:table-cell">Requested</TableHead>
            <TableHead className="hidden lg:table-cell">Expires</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            <TableLoading colSpan={6} message="Loading support sessions..." />
          ) : rows.length === 0 ? (
            <TableEmpty
              colSpan={6}
              icon={<Lifebuoy size={48} weight="duotone" />}
              title="No support sessions match"
              description={
                search ? "Try a different search term" : "No operator has opened a session yet."
              }
            />
          ) : (
            rows.map((row) => (
              <TableRow key={row.id} onClick={() => setSelected(row)} className="cursor-pointer">
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-semibold text-white shrink-0"
                      style={getAvatarGradientStyle(row.organizationName)}
                    >
                      {getInitials(row.organizationName)}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">
                        {row.organizationName || "-"}
                      </p>
                      <code className="text-xs text-muted-foreground font-mono truncate block">
                        {row.organizationSlug}
                      </code>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <div className="flex items-center gap-2 min-w-0">
                    {row.supportUserId ? (
                      <SubjectAvatarById
                        userId={row.supportUserId}
                        displayName={row.supportUserFullName || row.supportUserEmail}
                        size="md"
                      />
                    ) : (
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium text-white shrink-0"
                        style={getAvatarGradientStyle(row.supportUserEmail)}
                      >
                        {getInitials(row.supportUserEmail)}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {row.supportUserFullName || row.supportUserEmail}
                      </p>
                      {row.supportUserFullName && (
                        <p className="text-xs text-muted-foreground truncate">
                          {row.supportUserEmail}
                        </p>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden sm:table-cell" align="center">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">
                    {row.scope === SupportSessionScope.READ_WRITE ? "Read-write" : "Read-only"}
                  </span>
                </TableCell>
                <TableCell align="center">
                  <StateBadge state={row.state} />
                </TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground text-xs">
                  {row.requestedAt
                    ? formatRelativeTime(protoToDate(row.requestedAt)?.toISOString() ?? "")
                    : "-"}
                </TableCell>
                <TableCell className="hidden lg:table-cell text-muted-foreground text-xs">
                  {row.expiresAt
                    ? formatRelativeTime(protoToDate(row.expiresAt)?.toISOString() ?? "")
                    : "-"}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{pageInfo}</span>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="xs"
            disabled={page <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Prev
          </Button>
          <span>
            Page {page + 1} / {totalPages}
          </span>
          <Button
            variant="ghost"
            size="xs"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      {selected && (
        <PlatformSessionDetailDialog
          session={selected}
          onClose={() => setSelected(null)}
          onChanged={refreshAll}
        />
      )}
    </div>
  );
}
