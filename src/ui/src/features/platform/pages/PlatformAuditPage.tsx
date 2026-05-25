import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
    ClipboardText,
    MagnifyingGlass,
    Funnel,
} from '@phosphor-icons/react';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/components/ui/button';
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
import { formatProtoDateTime, formatRelativeTime } from '@/shared/utils/dateFormatting';
import { friendlyErrorMessage } from '@/config';
import { platformAuditApi } from '@/features/platform/api/platformAuditApi';
import {
    actionDomainColor,
    actionLabel,
} from '@/features/admin/pages/audit/actionCatalog';
import type { PlatformAuditEvent } from '@uniffy/proto/superadmin/v1/platform_audit_pb';

type ProtoTimestamp = { seconds: number | bigint; nanos: number };

const PAGE_SIZE = 50;

function protoToDate(ts: ProtoTimestamp | undefined): Date | undefined {
    if (!ts) return undefined;
    const ms = typeof ts.seconds === 'bigint' ? Number(ts.seconds) * 1000 : ts.seconds * 1000;
    return new Date(ms);
}

interface ActionEntry {
    action: string;
    group: string;
}

export function PlatformAuditPage() {
    useDocumentTitle('Platform Audit');
    const [rows, setRows] = useState<PlatformAuditEvent[]>([]);
    const [actions, setActions] = useState<ActionEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [selectedActions, setSelectedActions] = useState<Set<string>>(new Set());
    const [page, setPage] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    useEffect(() => {
        platformAuditApi
            .listActions({})
            .then((response) => {
                setActions(
                    response.actions.map((a) => ({ action: a.action, group: a.group })),
                );
            })
            .catch((error) => {
                const message = friendlyErrorMessage((error as Error).message);
                if (message) toast.error(message);
            });
    }, []);

    const fetchRows = useCallback(async () => {
        setLoading(true);
        try {
            const response = await platformAuditApi.listEvents({
                page,
                pageSize: PAGE_SIZE,
                actions: Array.from(selectedActions),
            });
            setRows(response.events);
            setTotalCount(response.totalCount);
        } catch (error) {
            const message = friendlyErrorMessage((error as Error).message);
            if (message) toast.error(message);
        } finally {
            setLoading(false);
        }
    }, [page, selectedActions]);

    useEffect(() => {
        fetchRows();
    }, [fetchRows]);

    const groupedActions = useMemo(() => {
        const groups = new Map<string, ActionEntry[]>();
        for (const entry of actions) {
            const list = groups.get(entry.group) ?? [];
            list.push(entry);
            groups.set(entry.group, list);
        }
        return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
    }, [actions]);

    const filteredRows = useMemo(() => {
        if (!search.trim()) return rows;
        const needle = search.trim().toLowerCase();
        return rows.filter(
            (row) =>
                row.action.toLowerCase().includes(needle) ||
                (row.organizationName ?? '').toLowerCase().includes(needle) ||
                (row.actorEmail ?? '').toLowerCase().includes(needle),
        );
    }, [rows, search]);

    const toggleAction = (action: string) => {
        const next = new Set(selectedActions);
        if (next.has(action)) next.delete(action);
        else next.add(action);
        setSelectedActions(next);
        setPage(0);
    };

    const clearFilters = () => {
        setSelectedActions(new Set());
        setSearch('');
        setPage(0);
    };

    const pageInfo = useMemo(() => {
        const start = page * PAGE_SIZE;
        const end = Math.min(start + filteredRows.length, totalCount);
        return totalCount > 0 ? `${start + 1}-${end} of ${totalCount}` : '0';
    }, [page, filteredRows.length, totalCount]);

    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

    return (
        <div className="flex flex-col gap-6 max-w-6xl w-full">
            <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                    <ClipboardText size={22} weight="duotone" className="text-primary" />
                </div>
                <div className="flex-1">
                    <h1 className="text-xl font-semibold text-foreground">Audit</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Platform-scope audit feed across every tenant. Tenant content
                        audit is excluded server-side by an action whitelist.
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
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search action, org, or actor email (filters current page)"
                        className="w-full bg-input border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </div>
                {(selectedActions.size > 0 || search) && (
                    <Button variant="ghost" size="sm" onClick={clearFilters}>
                        Clear filters
                    </Button>
                )}
            </div>

            <details className="rounded-lg border border-border bg-card">
                <summary className="px-4 py-2 cursor-pointer flex items-center gap-2 text-sm font-medium hover:bg-accent rounded-lg">
                    <Funnel size={14} weight="duotone" />
                    Filter by action ({selectedActions.size} selected)
                </summary>
                <div className="p-3 border-t border-border space-y-3">
                    {groupedActions.map(([group, entries]) => (
                        <div key={group}>
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                                {group}
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {entries.map((entry) => {
                                    const active = selectedActions.has(entry.action);
                                    return (
                                        <button
                                            key={entry.action}
                                            type="button"
                                            onClick={() => toggleAction(entry.action)}
                                            className={cn(
                                                'px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                                                active
                                                    ? actionDomainColor(entry.action)
                                                    : 'bg-muted text-muted-foreground hover:bg-accent',
                                            )}
                                        >
                                            {actionLabel(entry.action)}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </details>

            <Table>
                <TableHeader>
                    <TableRow hoverable={false}>
                        <TableHead>Action</TableHead>
                        <TableHead className="hidden md:table-cell">Organization</TableHead>
                        <TableHead className="hidden md:table-cell">Actor</TableHead>
                        <TableHead className="hidden lg:table-cell">When</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {loading ? (
                        <TableLoading colSpan={4} message="Loading audit events..." />
                    ) : filteredRows.length === 0 ? (
                        <TableEmpty
                            colSpan={4}
                            icon={<ClipboardText size={48} weight="duotone" />}
                            title="No audit events match"
                            description={
                                search || selectedActions.size > 0
                                    ? 'Try clearing filters'
                                    : 'No platform-scope audit events yet.'
                            }
                        />
                    ) : (
                        filteredRows.map((row) => {
                            const expanded = expandedId === row.id;
                            return (
                                <TableRow
                                    key={row.id}
                                    onClick={() => setExpandedId(expanded ? null : row.id)}
                                    className="cursor-pointer"
                                >
                                    <TableCell>
                                        <div className="space-y-1">
                                            <span
                                                className={cn(
                                                    'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                                                    actionDomainColor(row.action),
                                                )}
                                            >
                                                {actionLabel(row.action)}
                                            </span>
                                            {expanded && row.detailsJson && row.detailsJson !== '{}' && (
                                                <pre className="text-[10px] font-mono whitespace-pre-wrap break-all p-2 rounded-md bg-muted/50 text-muted-foreground mt-2 max-w-full overflow-x-auto">
                                                    {formatDetails(row.detailsJson)}
                                                </pre>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell text-muted-foreground truncate">
                                        {row.organizationName || (
                                            <span className="text-xs italic">(deployment)</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="hidden md:table-cell text-muted-foreground truncate">
                                        {row.actorEmail || (
                                            <span className="text-xs italic">(system)</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="hidden lg:table-cell text-muted-foreground text-xs">
                                        <div>
                                            {formatRelativeTime(
                                                protoToDate(row.createdAt)?.toISOString() ?? '',
                                            )}
                                        </div>
                                        <div className="text-[10px]">
                                            {formatProtoDateTime(row.createdAt)}
                                        </div>
                                    </TableCell>
                                </TableRow>
                            );
                        })
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
    );
}

function formatDetails(detailsJson: string): string {
    try {
        const parsed = JSON.parse(detailsJson);
        return JSON.stringify(parsed, null, 2);
    } catch {
        return detailsJson;
    }
}
