import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
    Lifebuoy,
    MagnifyingGlass,
    CheckCircle,
    Clock,
    Prohibit,
    XCircle,
    Hourglass,
} from '@phosphor-icons/react';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/components/ui/button';
import { Drawer } from '@/components/ui/drawer';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import {
    Table,
    TableBody,
    TableCell,
    TableEmpty,
    TableHead,
    TableHeader,
    TableLoading,
    TableRow,
} from '@/components/ui/table';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';
import { friendlyErrorMessage } from '@/config';
import { supportSessionsApi } from '@/features/platform/api/supportSessionsApi';
import { PlatformSessionDetailPanel } from '@/features/platform/components/PlatformSessionDetailPanel';
import {
    SupportSessionState,
    type SupportSession,
} from '@uniffy/proto/superadmin/v1/support_session_pb';

type ProtoTimestamp = { seconds: number | bigint; nanos: number };

const PAGE_SIZE = 50;

function protoToDate(ts: ProtoTimestamp | undefined): Date | undefined {
    if (!ts) return undefined;
    const ms = typeof ts.seconds === 'bigint' ? Number(ts.seconds) * 1000 : ts.seconds * 1000;
    return new Date(ms);
}

type StateFilter = 'all' | 'pending' | 'active' | 'expired' | 'revoked' | 'rejected';

const STATE_FILTER_TO_PROTO: Record<StateFilter, SupportSessionState> = {
    all: SupportSessionState.UNSPECIFIED,
    pending: SupportSessionState.PENDING,
    active: SupportSessionState.ACTIVE,
    expired: SupportSessionState.EXPIRED,
    revoked: SupportSessionState.REVOKED,
    rejected: SupportSessionState.REJECTED,
};

const STATE_FILTERS: { id: StateFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'active', label: 'Active' },
    { id: 'expired', label: 'Expired' },
    { id: 'revoked', label: 'Revoked' },
    { id: 'rejected', label: 'Rejected' },
];

function StateBadge({ state }: { state: SupportSessionState }) {
    const map: Record<number, { label: string; cls: string; Icon: typeof CheckCircle }> = {
        [SupportSessionState.PENDING]: {
            label: 'Pending',
            cls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
            Icon: Hourglass,
        },
        [SupportSessionState.ACTIVE]: {
            label: 'Active',
            cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
            Icon: CheckCircle,
        },
        [SupportSessionState.EXPIRED]: {
            label: 'Expired',
            cls: 'bg-muted text-muted-foreground',
            Icon: Clock,
        },
        [SupportSessionState.REVOKED]: {
            label: 'Revoked',
            cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
            Icon: Prohibit,
        },
        [SupportSessionState.REJECTED]: {
            label: 'Rejected',
            cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
            Icon: XCircle,
        },
    };
    const entry = map[state];
    if (!entry) return <span className="text-xs text-muted-foreground">-</span>;
    const Icon = entry.Icon;
    return (
        <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', entry.cls)}>
            <Icon size={10} weight="duotone" />
            {entry.label}
        </span>
    );
}

export function PlatformSessionsPage() {
    useDocumentTitle('Platform Support Sessions');
    const { isMobileOrTablet } = useBreakpoint();
    const [rows, setRows] = useState<SupportSession[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [stateFilter, setStateFilter] = useState<StateFilter>('all');
    const [page, setPage] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
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

    useEffect(() => {
        fetchRows();
    }, [fetchRows]);

    const pageInfo = useMemo(() => {
        const start = page * PAGE_SIZE;
        const end = Math.min(start + rows.length, totalCount);
        return totalCount > 0 ? `${start + 1}-${end} of ${totalCount}` : '0';
    }, [page, rows.length, totalCount]);

    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

    const showInlinePanel = !!selected && !isMobileOrTablet;
    const showDrawerPanel = !!selected && isMobileOrTablet;

    return (
        <div className="flex gap-4 lg:gap-6 min-w-0">
            <div className="flex-1 min-w-0 flex flex-col gap-6">
                <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-primary/10">
                        <Lifebuoy size={22} weight="duotone" className="text-primary" />
                    </div>
                    <div className="flex-1">
                        <h1 className="text-xl font-semibold text-foreground">Support sessions</h1>
                        <p className="text-sm text-muted-foreground mt-1">
                            Every time-bound operator grant across the deployment. Read-only metadata.
                        </p>
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 relative">
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
                            className="w-full bg-input border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                        />
                    </div>
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
                                'px-3 py-1 rounded-full text-xs font-medium transition-colors',
                                stateFilter === f.id
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-muted text-muted-foreground hover:bg-accent',
                            )}
                        >
                            {f.label}
                        </button>
                    ))}
                </div>

                <Table>
                    <TableHeader>
                        <TableRow hoverable={false}>
                            <TableHead>Organization</TableHead>
                            <TableHead className="hidden md:table-cell">Operator</TableHead>
                            <TableHead align="center" className="hidden sm:table-cell">Scope</TableHead>
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
                                    search
                                        ? 'Try a different search term'
                                        : 'No operator has opened a session yet.'
                                }
                            />
                        ) : (
                            rows.map((row) => (
                                <TableRow
                                    key={row.id}
                                    onClick={() => setSelected(row)}
                                    className="cursor-pointer"
                                >
                                    <TableCell>
                                        <div className="min-w-0">
                                            <div className="font-semibold text-foreground truncate">
                                                {row.organizationName || '-'}
                                            </div>
                                            <code className="text-xs text-muted-foreground font-mono truncate block">
                                                {row.organizationSlug}
                                            </code>
                                        </div>
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell text-muted-foreground truncate">
                                        {row.supportUserEmail}
                                    </TableCell>
                                    <TableCell className="hidden sm:table-cell" align="center">
                                        <span className="text-xs uppercase tracking-wider text-muted-foreground">
                                            Read-only
                                        </span>
                                    </TableCell>
                                    <TableCell align="center">
                                        <StateBadge state={row.state} />
                                    </TableCell>
                                    <TableCell className="hidden lg:table-cell text-muted-foreground text-xs">
                                        {row.requestedAt
                                            ? formatRelativeTime(
                                                  protoToDate(row.requestedAt)?.toISOString() ?? '',
                                              )
                                            : '-'}
                                    </TableCell>
                                    <TableCell className="hidden lg:table-cell text-muted-foreground text-xs">
                                        {row.expiresAt
                                            ? formatRelativeTime(
                                                  protoToDate(row.expiresAt)?.toISOString() ?? '',
                                              )
                                            : '-'}
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
            </div>

            {showInlinePanel && (
                <aside className="w-[400px] xl:w-[440px] shrink-0">
                    <div className="sticky top-0 h-[calc(100dvh-12rem)] rounded-lg border border-border overflow-hidden">
                        <PlatformSessionDetailPanel
                            session={selected}
                            onClose={() => setSelected(null)}
                            onChanged={fetchRows}
                        />
                    </div>
                </aside>
            )}

            {showDrawerPanel && (
                <Drawer
                    open
                    onClose={() => setSelected(null)}
                    side="right"
                    className="w-full sm:w-[400px]"
                    showClose={false}
                    ariaLabel="Session details"
                >
                    <PlatformSessionDetailPanel
                        session={selected}
                        onClose={() => setSelected(null)}
                        onChanged={fetchRows}
                    />
                </Drawer>
            )}
        </div>
    );
}
