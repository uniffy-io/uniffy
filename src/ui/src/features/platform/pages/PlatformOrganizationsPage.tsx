import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
    Buildings,
    MagnifyingGlass,
    Trash,
    ArrowCounterClockwise,
    Prohibit,
    Lifebuoy,
    DotsThreeVertical,
    Clock,
    ShieldWarning,
    CheckCircle,
} from '@phosphor-icons/react';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Drawer } from '@/components/ui/drawer';
import { PortalMenu } from '@/components/ui/portal-menu';
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
import { platformOrgsApi } from '@/features/platform/api/systemDirectoryApi';
import { PlatformOrgDetailPanel } from '@/features/platform/components/PlatformOrgDetailPanel';
import { RequestSupportSessionDialog } from '@/features/platform/components/RequestSupportSessionDialog';
import { ReasonDialog } from '@/components/ui/reason-dialog';
import type { PlatformOrganizationSummary } from '@uniffy/proto/superadmin/v1/system_directory_pb';

type PendingOrgRowAction = {
    kind: 'suspend' | 'unsuspend' | 'restore' | 'delete';
    org: PlatformOrganizationSummary;
};

type ProtoTimestamp = { seconds: number | bigint; nanos: number };

const PAGE_SIZE = 50;

function protoToDate(ts: ProtoTimestamp | undefined): Date | undefined {
    if (!ts) return undefined;
    const ms = typeof ts.seconds === 'bigint' ? Number(ts.seconds) * 1000 : ts.seconds * 1000;
    return new Date(ms);
}

function MailSourceBadge({ source }: { source: string }) {
    const map: Record<string, { label: string; cls: string }> = {
        per_org: {
            label: 'Per-org',
            cls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
        },
        deployment: {
            label: 'Deployment',
            cls: 'bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400',
        },
        env: {
            label: 'Env',
            cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400',
        },
        none: {
            label: 'Not configured',
            cls: 'bg-muted text-muted-foreground',
        },
    };
    const entry = map[source] ?? map.none;
    return (
        <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', entry.cls)}>
            {entry.label}
        </span>
    );
}

function StatusBadge({ org }: { org: PlatformOrganizationSummary }) {
    if (org.deletedAt) {
        const purge = protoToDate(org.purgeAt);
        const purgeLabel = purge ? formatRelativeTime(purge.toISOString()) : 'soon';
        return (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                <Trash size={10} weight="duotone" />
                Deleted - purge {purgeLabel}
            </span>
        );
    }
    if (org.isSuspended) {
        return (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                <ShieldWarning size={10} weight="duotone" />
                Suspended
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
            <CheckCircle size={10} weight="duotone" />
            Active
        </span>
    );
}

interface RowActionsProps {
    org: PlatformOrganizationSummary;
    onSuspend: () => void;
    onUnsuspend: () => void;
    onRestore: () => void;
    onDelete: () => void;
    onSupport: () => void;
}

function RowActions({ org, onSuspend, onUnsuspend, onRestore, onDelete, onSupport }: RowActionsProps) {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    return (
        <>
            <Button
                ref={triggerRef}
                variant="ghost"
                size="xs"
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen((v) => !v);
                }}
                aria-label="Row actions"
            >
                <DotsThreeVertical size={16} weight="bold" />
            </Button>
            <PortalMenu open={open} onClose={() => setOpen(false)} triggerRef={triggerRef}>
                <button
                    type="button"
                    className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"
                    onClick={(e) => {
                        e.stopPropagation();
                        setOpen(false);
                        onSupport();
                    }}
                >
                    <Lifebuoy size={14} weight="duotone" /> Enter support session
                </button>
                {org.deletedAt ? (
                    <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-emerald-700 dark:text-emerald-400"
                        onClick={(e) => {
                            e.stopPropagation();
                            setOpen(false);
                            onRestore();
                        }}
                    >
                        <ArrowCounterClockwise size={14} weight="duotone" /> Restore
                    </button>
                ) : org.isSuspended ? (
                    <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2"
                        onClick={(e) => {
                            e.stopPropagation();
                            setOpen(false);
                            onUnsuspend();
                        }}
                    >
                        <ArrowCounterClockwise size={14} weight="duotone" /> Unsuspend
                    </button>
                ) : (
                    <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-amber-700 dark:text-amber-400"
                        onClick={(e) => {
                            e.stopPropagation();
                            setOpen(false);
                            onSuspend();
                        }}
                    >
                        <Prohibit size={14} weight="duotone" /> Suspend
                    </button>
                )}
                {!org.deletedAt && (
                    <button
                        type="button"
                        className="w-full text-left px-3 py-1.5 hover:bg-accent flex items-center gap-2 text-red-700 dark:text-red-400"
                        onClick={(e) => {
                            e.stopPropagation();
                            setOpen(false);
                            onDelete();
                        }}
                    >
                        <Trash size={14} weight="duotone" /> Delete
                    </button>
                )}
            </PortalMenu>
        </>
    );
}

export function PlatformOrganizationsPage() {
    useDocumentTitle('Platform Organizations');
    const { isMobileOrTablet } = useBreakpoint();
    const [rows, setRows] = useState<PlatformOrganizationSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [includeDeleted, setIncludeDeleted] = useState(false);
    const [onlySuspended, setOnlySuspended] = useState(false);
    const [page, setPage] = useState(0);
    const [totalCount, setTotalCount] = useState(0);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [supportTarget, setSupportTarget] = useState<{ id: string; name: string } | null>(null);
    const [pending, setPending] = useState<PendingOrgRowAction | null>(null);
    const [pendingBusy, setPendingBusy] = useState(false);

    const fetchRows = useCallback(async () => {
        setLoading(true);
        try {
            const response = await platformOrgsApi.list({
                page,
                pageSize: PAGE_SIZE,
                search,
                includeDeleted,
                onlySuspended,
            });
            setRows(response.organizations);
            setTotalCount(response.totalCount);
        } catch (error) {
            const message = friendlyErrorMessage((error as Error).message);
            if (message) toast.error(message);
        } finally {
            setLoading(false);
        }
    }, [page, search, includeDeleted, onlySuspended]);

    useEffect(() => {
        fetchRows();
    }, [fetchRows]);

    const handleSuspend = (org: PlatformOrganizationSummary) =>
        setPending({ kind: 'suspend', org });
    const handleUnsuspend = (org: PlatformOrganizationSummary) =>
        setPending({ kind: 'unsuspend', org });
    const handleRestore = (org: PlatformOrganizationSummary) =>
        setPending({ kind: 'restore', org });
    const handleDelete = (org: PlatformOrganizationSummary) =>
        setPending({ kind: 'delete', org });

    const runPending = async (reason: string) => {
        if (!pending) return;
        const { kind, org } = pending;
        setPendingBusy(true);
        try {
            if (kind === 'suspend') {
                await platformOrgsApi.suspend({ organizationId: org.id, reason });
                toast.success(`Suspended ${org.name}`);
            } else if (kind === 'unsuspend') {
                await platformOrgsApi.unsuspend({ organizationId: org.id, reason });
                toast.success(`Unsuspended ${org.name}`);
            } else if (kind === 'restore') {
                await platformOrgsApi.restore({ organizationId: org.id, reason });
                toast.success(`Restored ${org.name}`);
            } else {
                await platformOrgsApi.delete({
                    organizationId: org.id,
                    confirmSlug: org.slug,
                    reason,
                });
                toast.success(`Deleted ${org.name}. Owners notified.`);
            }
            setPending(null);
            fetchRows();
        } catch (error) {
            const message = friendlyErrorMessage((error as Error).message);
            if (message) toast.error(message);
        } finally {
            setPendingBusy(false);
        }
    };

    const handleSupport = (org: PlatformOrganizationSummary) => {
        setSupportTarget({ id: org.id, name: org.name });
    };

    const pageInfo = useMemo(() => {
        const start = page * PAGE_SIZE;
        const end = Math.min(start + rows.length, totalCount);
        return totalCount > 0 ? `${start + 1}-${end} of ${totalCount}` : '0';
    }, [page, rows.length, totalCount]);

    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

    const showInlinePanel = !!selectedId && !isMobileOrTablet;
    const showDrawerPanel = !!selectedId && isMobileOrTablet;

    return (
        <div className="flex gap-4 lg:gap-6 min-w-0">
            <div className="flex-1 min-w-0 flex flex-col gap-6">
            <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                    <Buildings size={22} weight="duotone" className="text-primary" />
                </div>
                <div className="flex-1">
                    <h1 className="text-xl font-semibold text-foreground">Organizations</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Cross-tenant directory. Metadata only - tenant content is unreachable from here.
                    </p>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 relative">
                    <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setPage(0);
                        }}
                        placeholder="Search by name or slug"
                        className="w-full bg-input border border-border rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </div>
                <Checkbox
                    label="Suspended only"
                    checked={onlySuspended}
                    onChange={(e) => {
                        setOnlySuspended(e.target.checked);
                        setPage(0);
                    }}
                />
                <Checkbox
                    label="Include deleted"
                    checked={includeDeleted}
                    onChange={(e) => {
                        setIncludeDeleted(e.target.checked);
                        setPage(0);
                    }}
                />
            </div>

            <Table>
                <TableHeader>
                    <TableRow hoverable={false}>
                        <TableHead>Name</TableHead>
                        <TableHead className="hidden lg:table-cell">Slug</TableHead>
                        <TableHead align="center">Members</TableHead>
                        <TableHead className="hidden md:table-cell">Mail</TableHead>
                        <TableHead className="hidden md:table-cell" align="center">DEK</TableHead>
                        <TableHead className="hidden lg:table-cell">Last activity</TableHead>
                        <TableHead align="center">Status</TableHead>
                        <TableHead align="right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {loading ? (
                        <TableLoading colSpan={8} message="Loading organizations..." />
                    ) : rows.length === 0 ? (
                        <TableEmpty
                            colSpan={8}
                            icon={<Buildings size={48} weight="duotone" />}
                            title="No organizations match"
                            description={
                                search
                                    ? 'Try a different search term'
                                    : 'No organizations have been created yet.'
                            }
                        />
                    ) : (
                        rows.map((org) => (
                            <TableRow
                                key={org.id}
                                onClick={() => setSelectedId(org.id)}
                                className="cursor-pointer"
                            >
                                <TableCell>
                                    <div className="flex items-center gap-3">
                                        <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-blue-500/20 to-blue-600/20 flex items-center justify-center border border-blue-500/30 shrink-0">
                                            <Buildings
                                                size={18}
                                                weight="duotone"
                                                className="text-blue-600 dark:text-blue-400"
                                            />
                                        </div>
                                        <div className="min-w-0">
                                            <div className="font-semibold text-foreground truncate">{org.name}</div>
                                            <div className="text-xs text-muted-foreground capitalize">{org.plan}</div>
                                        </div>
                                    </div>
                                </TableCell>
                                <TableCell className="hidden lg:table-cell">
                                    <code className="px-2 py-1 rounded bg-muted text-xs font-mono">{org.slug}</code>
                                </TableCell>
                                <TableCell align="center">
                                    <span className="inline-flex items-center justify-center min-w-7 h-7 rounded-full bg-primary/10 text-primary text-xs font-semibold px-2">
                                        {org.memberCount}
                                    </span>
                                </TableCell>
                                <TableCell className="hidden md:table-cell">
                                    <MailSourceBadge source={org.mailConfigSource} />
                                </TableCell>
                                <TableCell className="hidden md:table-cell" align="center">
                                    {org.encryptionVersion > 0 ? (
                                        <span className="text-xs font-mono">v{org.encryptionVersion}</span>
                                    ) : (
                                        <span className="text-xs text-muted-foreground">-</span>
                                    )}
                                </TableCell>
                                <TableCell className="hidden lg:table-cell text-muted-foreground">
                                    {org.lastActivityAt ? (
                                        <span className="inline-flex items-center gap-1 text-xs">
                                            <Clock size={12} weight="duotone" />
                                            {formatRelativeTime(
                                                protoToDate(org.lastActivityAt)?.toISOString() ?? '',
                                            )}
                                        </span>
                                    ) : (
                                        <span className="text-xs">-</span>
                                    )}
                                </TableCell>
                                <TableCell align="center">
                                    <StatusBadge org={org} />
                                </TableCell>
                                <TableCell align="right">
                                    <RowActions
                                        org={org}
                                        onSuspend={() => handleSuspend(org)}
                                        onUnsuspend={() => handleUnsuspend(org)}
                                        onRestore={() => handleRestore(org)}
                                        onDelete={() => handleDelete(org)}
                                        onSupport={() => handleSupport(org)}
                                    />
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
                        <PlatformOrgDetailPanel
                            organizationId={selectedId}
                            onClose={() => setSelectedId(null)}
                            onChanged={fetchRows}
                        />
                    </div>
                </aside>
            )}

            {showDrawerPanel && (
                <Drawer
                    open
                    onClose={() => setSelectedId(null)}
                    side="right"
                    className="w-full sm:w-[400px]"
                    showClose={false}
                    ariaLabel="Organization details"
                >
                    <PlatformOrgDetailPanel
                        organizationId={selectedId}
                        onClose={() => setSelectedId(null)}
                        onChanged={fetchRows}
                    />
                </Drawer>
            )}

            {supportTarget && (
                <RequestSupportSessionDialog
                    organizationId={supportTarget.id}
                    organizationName={supportTarget.name}
                    onClose={() => setSupportTarget(null)}
                    onCreated={fetchRows}
                />
            )}

            <ReasonDialog
                isOpen={!!pending}
                onClose={() => {
                    if (!pendingBusy) setPending(null);
                }}
                onConfirm={runPending}
                title={
                    !pending
                        ? ''
                        : pending.kind === 'suspend'
                          ? `Suspend ${pending.org.name}?`
                          : pending.kind === 'unsuspend'
                            ? `Unsuspend ${pending.org.name}?`
                            : pending.kind === 'restore'
                              ? `Restore ${pending.org.name}?`
                              : `Delete ${pending.org.name}?`
                }
                description={
                    pending?.kind === 'suspend'
                        ? 'Bumps token_version for every member. Existing JWTs invalidated; new logins blocked.'
                        : pending?.kind === 'unsuspend'
                          ? 'Members can log in again. Their JWTs were invalidated at suspend time.'
                          : pending?.kind === 'restore'
                            ? 'Clears the scheduled purge. The workspace becomes accessible again.'
                            : pending?.kind === 'delete'
                              ? 'Soft-deletes the workspace. Restorable for 30 days; owners are notified.'
                              : undefined
                }
                confirmSlug={
                    pending?.kind === 'delete'
                        ? {
                              slug: pending.org.slug,
                              helperText: 'Workspace stays restorable for 30 days after this point.',
                          }
                        : undefined
                }
                confirmLabel={
                    pending?.kind === 'suspend'
                        ? 'Suspend'
                        : pending?.kind === 'unsuspend'
                          ? 'Unsuspend'
                          : pending?.kind === 'restore'
                            ? 'Restore'
                            : 'Delete'
                }
                variant={
                    pending?.kind === 'unsuspend' || pending?.kind === 'restore'
                        ? 'warning'
                        : 'danger'
                }
                loading={pendingBusy}
            />
        </div>
    );
}
