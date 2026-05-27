import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import {
    CaretDoubleLeft,
    CaretDoubleRight,
    ClipboardText,
    DownloadSimple,
    Funnel,
    SlidersHorizontal,
    X,
} from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Drawer } from '@/components/ui/drawer';
import { useAdminAccess } from '@/features/admin/hooks/useAdminHooks';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { cn } from '@/shared/utils/cn';
import { friendlyErrorMessage } from '@/config';
import { auditApi } from '@/features/admin/api/auditApi';
import { exportCurrentView } from '@/features/admin/pages/audit/exportClient';
import {
    ACTION_GROUPS,
    RESOURCE_TYPES,
    actionLabel,
} from '@/features/admin/pages/audit/actionCatalog';
import {
    AuditActionFilter,
    AuditEventTable,
    AuditFilterRail,
    EMPTY_AUDIT_FILTER,
    type ActionGroup,
    type AuditEvent,
    type AuditFilter,
    type AuditFilterFields,
} from '@/components/audit';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { SortOrder, type AuditEvent as ProtoAuditEvent } from '@uniffy/proto/audit/v1/audit_pb';
import { toast } from 'sonner';

const PAGE_SIZE = 50;
const DEFAULT_LOOKBACK_DAYS = 7;

const ORG_FILTER_FIELDS: AuditFilterFields = {
    dateRange: true,
    actor: true,
    actions: false,
    resourceType: true,
    resourceUrn: true,
    organization: false,
};

const ORG_ACTION_GROUPS: ActionGroup[] = ACTION_GROUPS.map((g) => ({
    domain: g.domain,
    label: g.label,
    actions: g.actions.map((a) => ({ value: a.value, label: a.label })),
}));

type ProtoTimestamp = { seconds: number | bigint; nanos: number };

function protoToIso(ts: ProtoTimestamp | undefined): string {
    if (!ts) return '';
    const ms = typeof ts.seconds === 'bigint' ? Number(ts.seconds) * 1000 : ts.seconds * 1000;
    return new Date(ms).toISOString();
}

function toAuditEvent(row: ProtoAuditEvent): AuditEvent {
    return {
        id: row.id,
        createdAt: protoToIso(row.createdAt),
        action: row.action,
        actorUserId: row.actorUserId ?? null,
        actorEmail: null,
        actorOrgRole: row.actorOrgRole ?? null,
        organizationId: row.organizationId || null,
        organizationName: null,
        resourceType: row.resourceType ?? null,
        resourceId: row.resourceId ?? null,
        detailsJson: row.detailsJson || '{}',
        ipAddress: row.ipAddress ?? null,
        userAgent: row.userAgent ?? null,
        onBehalfOfUserId: row.onBehalfOfUserId ?? null,
    };
}

const PARAM = {
    ACTOR: 'actor',
    ACTIONS: 'actions',
    RESOURCE_TYPE: 'resourceType',
    RESOURCE_ID: 'resourceId',
    FROM: 'from',
    TO: 'to',
} as const;

function filterToSearchParams(filter: AuditFilter): URLSearchParams {
    const params = new URLSearchParams();
    if (filter.actorUserId) params.set(PARAM.ACTOR, filter.actorUserId);
    if (filter.actions.length > 0) params.set(PARAM.ACTIONS, filter.actions.join(','));
    if (filter.resourceType) params.set(PARAM.RESOURCE_TYPE, filter.resourceType);
    if (filter.resourceId) params.set(PARAM.RESOURCE_ID, filter.resourceId);
    if (filter.fromTime) params.set(PARAM.FROM, filter.fromTime);
    if (filter.toTime) params.set(PARAM.TO, filter.toTime);
    return params;
}

function searchParamsToFilter(params: URLSearchParams): AuditFilter {
    const actions = params.get(PARAM.ACTIONS);
    return {
        ...EMPTY_AUDIT_FILTER,
        actorUserId: params.get(PARAM.ACTOR) || null,
        actions: actions ? actions.split(',').filter(Boolean) : [],
        resourceType: params.get(PARAM.RESOURCE_TYPE) || null,
        resourceId: params.get(PARAM.RESOURCE_ID) || null,
        fromTime: params.get(PARAM.FROM) || null,
        toTime: params.get(PARAM.TO) || null,
    };
}

export function AuditLogsPage() {
    useDocumentTitle('Audit Log');
    const { canAccessAdmin } = useAdminAccess();
    const { isDesktop, isWide } = useBreakpoint();
    const sidebarInline = isDesktop || isWide;
    const [searchParams, setSearchParams] = useSearchParams();
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const organizationSlug = useAppSelector((state) => state.auth.currentOrganizationSlug);

    const filter = useMemo(() => searchParamsToFilter(searchParams), [searchParams]);

    const initializedRef = useRef(false);
    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;
        if (searchParams.toString() !== '') return;
        const start = new Date();
        start.setDate(start.getDate() - DEFAULT_LOOKBACK_DAYS);
        const seeded: AuditFilter = {
            ...EMPTY_AUDIT_FILTER,
            fromTime: start.toISOString(),
        };
        setSearchParams(filterToSearchParams(seeded), { replace: true });
    }, [searchParams, setSearchParams]);

    const [events, setEvents] = useState<ProtoAuditEvent[]>([]);
    const [loading, setLoading] = useState(true);
    const [pageTokens, setPageTokens] = useState<(string | null)[]>([null]);
    const [pageIndex, setPageIndex] = useState(0);
    const [nextToken, setNextToken] = useState<string | null>(null);
    const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
    const [jumpDate, setJumpDate] = useState('');
    const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);
    const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(() => {
        if (typeof window === 'undefined') return true;
        return window.localStorage.getItem('audit:sidebar-collapsed') !== '1';
    });

    const toggleSidebar = useCallback(() => {
        setSidebarExpanded((prev) => {
            const next = !prev;
            try {
                window.localStorage.setItem(
                    'audit:sidebar-collapsed',
                    next ? '0' : '1',
                );
            } catch {
                // localStorage unavailable - non-fatal
            }
            return next;
        });
    }, []);

    const fetchPage = useCallback(
        async (token: string | null) => {
            if (!organizationId) return;
            setLoading(true);
            try {
                const response = await auditApi.listEvents({
                    organizationId,
                    actorUserId: filter.actorUserId ?? undefined,
                    actions: filter.actions,
                    resourceType: filter.resourceType ?? undefined,
                    resourceId: filter.resourceId ?? undefined,
                    fromTime: filter.fromTime
                        ? timestampFromDate(new Date(filter.fromTime))
                        : undefined,
                    toTime: filter.toTime
                        ? timestampFromDate(new Date(filter.toTime))
                        : undefined,
                    pageSize: PAGE_SIZE,
                    pageToken: token ?? undefined,
                    order: SortOrder.TIME_DESC,
                });
                setEvents(response.events);
                setNextToken(response.nextPageToken ?? null);
            } catch (error) {
                const message = friendlyErrorMessage((error as Error).message);
                if (message) toast.error(message);
            } finally {
                setLoading(false);
            }
        },
        [organizationId, filter],
    );

    useEffect(() => {
        setPageTokens([null]);
        setPageIndex(0);
        fetchPage(null);
    }, [fetchPage]);

    const auditEvents = useMemo(() => events.map(toAuditEvent), [events]);
    const activeFilterChips = useMemo(() => describeFilterChips(filter), [filter]);
    const activeFilterCount = activeFilterChips.length;

    const applyFilter = useCallback(
        (next: AuditFilter) => {
            setSearchParams(filterToSearchParams(next), { replace: false });
        },
        [setSearchParams],
    );

    const clearFilter = useCallback(() => {
        applyFilter({ ...EMPTY_AUDIT_FILTER });
    }, [applyFilter]);

    const handleNext = () => {
        if (!nextToken) return;
        const newIndex = pageIndex + 1;
        setPageTokens((prev) => {
            const copy = prev.slice(0, newIndex);
            copy.push(nextToken);
            return copy;
        });
        setPageIndex(newIndex);
        fetchPage(nextToken);
    };

    const handlePrev = () => {
        if (pageIndex <= 0) return;
        const newIndex = pageIndex - 1;
        setPageIndex(newIndex);
        fetchPage(pageTokens[newIndex] ?? null);
    };

    const handleJumpToDate = () => {
        if (!jumpDate) return;
        const toTime = new Date(`${jumpDate}T23:59:59`).toISOString();
        applyFilter({ ...filter, toTime });
    };

    const handleExport = useCallback(
        async (format: 'csv' | 'json') => {
            if (!organizationId) return;
            setExporting(format);
            try {
                await exportCurrentView({
                    organizationId,
                    organizationSlug: organizationSlug ?? 'org',
                    filter,
                    format,
                });
            } finally {
                setExporting(null);
            }
        },
        [filter, organizationId, organizationSlug],
    );

    if (!canAccessAdmin) {
        return <Navigate to="/" replace />;
    }

    const showFiltersButton = !sidebarInline;

    return (
        <div className="space-y-6 pb-12">
            <PageHeader
                jumpDate={jumpDate}
                onJumpDateChange={setJumpDate}
                onJumpToDate={handleJumpToDate}
                onExport={handleExport}
                exporting={exporting}
                onOpenFilters={() => setFilterDrawerOpen(true)}
                activeFilterCount={activeFilterCount}
                showFiltersButton={showFiltersButton}
            />

            <AuditActionFilter
                filter={filter}
                onChange={applyFilter}
                groups={ORG_ACTION_GROUPS}
            />

            {activeFilterChips.length > 0 && (
                <ActiveFilterBar
                    chips={activeFilterChips}
                    onRemove={(key) => applyFilter(removeChip(filter, key))}
                    onClear={clearFilter}
                />
            )}

            <div className="flex gap-6">
                <div className="flex-1 min-w-0 rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                    <AuditEventTable
                        events={auditEvents}
                        loading={loading}
                        emptyDescription="No audit events recorded yet."
                        filteredEmptyDescription="Adjust filters to surface more activity."
                        hasActiveFilters={activeFilterCount > 0}
                    />
                    <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs text-muted-foreground">
                        <span>
                            {events.length > 0
                                ? `Showing ${events.length} on page ${pageIndex + 1}`
                                : '0'}
                        </span>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="xs"
                                disabled={pageIndex <= 0}
                                onClick={handlePrev}
                            >
                                Prev
                            </Button>
                            <span>Page {pageIndex + 1}</span>
                            <Button
                                variant="ghost"
                                size="xs"
                                disabled={!nextToken}
                                onClick={handleNext}
                            >
                                Next
                            </Button>
                        </div>
                    </div>
                </div>

                {sidebarInline && sidebarExpanded && (
                    <aside className="w-80 shrink-0">
                        <div className="sticky top-4 rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-muted/40">
                                <div className="flex items-center gap-2">
                                    <Funnel size={14} weight="duotone" className="text-primary" />
                                    <h2 className="text-sm font-semibold">Filters</h2>
                                </div>
                                <div className="flex items-center gap-2">
                                    {activeFilterCount > 0 && (
                                        <button
                                            type="button"
                                            onClick={clearFilter}
                                            className="text-xs text-muted-foreground hover:text-foreground"
                                        >
                                            Clear all
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        onClick={toggleSidebar}
                                        className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                        title="Collapse filters"
                                        aria-label="Collapse filters"
                                    >
                                        <CaretDoubleRight size={14} weight="bold" />
                                    </button>
                                </div>
                            </div>
                            <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto">
                                <AuditFilterRail
                                    filter={filter}
                                    onChange={applyFilter}
                                    fields={ORG_FILTER_FIELDS}
                                    actionGroups={ORG_ACTION_GROUPS}
                                    resourceTypes={RESOURCE_TYPES}
                                />
                            </div>
                        </div>
                    </aside>
                )}

                {sidebarInline && !sidebarExpanded && (
                    <aside className="w-12 shrink-0">
                        <div className="sticky top-4 rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                            <button
                                type="button"
                                onClick={toggleSidebar}
                                className="w-full p-2 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors border-b border-border"
                                title="Expand filters"
                                aria-label="Expand filters"
                            >
                                <CaretDoubleLeft size={14} weight="bold" />
                            </button>
                            <button
                                type="button"
                                onClick={toggleSidebar}
                                className="w-full p-3 flex flex-col items-center gap-2 hover:bg-muted/60 transition-colors"
                                title={
                                    activeFilterCount > 0
                                        ? `Filters (${activeFilterCount})`
                                        : 'Filters'
                                }
                            >
                                <div className="relative">
                                    <Funnel
                                        size={20}
                                        weight="duotone"
                                        className={cn(
                                            activeFilterCount > 0
                                                ? 'text-primary'
                                                : 'text-muted-foreground',
                                        )}
                                    />
                                    {activeFilterCount > 0 && (
                                        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-[10px] font-semibold text-primary-foreground flex items-center justify-center">
                                            {activeFilterCount}
                                        </span>
                                    )}
                                </div>
                                <span className="text-[10px] uppercase tracking-wider text-muted-foreground [writing-mode:vertical-rl] rotate-180">
                                    Filters
                                </span>
                            </button>
                        </div>
                    </aside>
                )}
            </div>

            {!sidebarInline && (
                <Drawer
                    open={filterDrawerOpen}
                    onClose={() => setFilterDrawerOpen(false)}
                    side="right"
                    className="w-96"
                    ariaLabel="Audit log filters"
                >
                    <div className="px-4 pt-12 pb-3 border-b border-border">
                        <div className="flex items-center gap-2">
                            <Funnel size={16} weight="duotone" className="text-primary" />
                            <h2 className="text-base font-semibold">Filters</h2>
                        </div>
                    </div>
                    <AuditFilterRail
                        filter={filter}
                        onChange={applyFilter}
                        fields={ORG_FILTER_FIELDS}
                        actionGroups={ORG_ACTION_GROUPS}
                        resourceTypes={RESOURCE_TYPES}
                        compact
                    />
                </Drawer>
            )}
        </div>
    );
}

interface PageHeaderProps {
    jumpDate: string;
    onJumpDateChange: (value: string) => void;
    onJumpToDate: () => void;
    onExport: (format: 'csv' | 'json') => void;
    exporting: 'csv' | 'json' | null;
    onOpenFilters: () => void;
    activeFilterCount: number;
    showFiltersButton: boolean;
}

function PageHeader({
    jumpDate,
    onJumpDateChange,
    onJumpToDate,
    onExport,
    exporting,
    onOpenFilters,
    activeFilterCount,
    showFiltersButton,
}: PageHeaderProps) {
    const [exportOpen, setExportOpen] = useState(false);

    return (
        <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
                <ClipboardText size={24} weight="duotone" className="text-primary shrink-0" />
                <h1 className="text-2xl font-bold truncate">Audit Log</h1>
            </div>

            <div className="flex items-center gap-2 shrink-0">
                {showFiltersButton && (
                    <Button
                        variant={activeFilterCount > 0 ? 'default' : 'secondary'}
                        size="md"
                        onClick={onOpenFilters}
                    >
                        <Funnel size={14} weight="duotone" />
                        <span className="hidden sm:inline">
                            Filters
                            {activeFilterCount > 0 && ` (${activeFilterCount})`}
                        </span>
                    </Button>
                )}

                <div className="hidden md:flex items-center gap-1.5">
                    <DatePicker
                        value={jumpDate}
                        onChange={onJumpDateChange}
                        placeholder="Jump to date"
                        className="w-44"
                    />
                    <Button
                        variant="secondary"
                        size="md"
                        onClick={onJumpToDate}
                        disabled={!jumpDate}
                    >
                        <SlidersHorizontal size={14} weight="duotone" />
                        <span className="hidden lg:inline">Jump</span>
                    </Button>
                </div>

                <div className="relative">
                    <Button
                        variant="default"
                        size="md"
                        onClick={() => setExportOpen((open) => !open)}
                        loading={exporting !== null}
                    >
                        <DownloadSimple size={14} weight="duotone" />
                        <span className="hidden sm:inline">Export</span>
                    </Button>
                    {exportOpen && (
                        <div className="absolute right-0 top-full mt-1 z-20 rounded-lg border border-border bg-card shadow-lg w-48 py-1">
                            <button
                                type="button"
                                onClick={() => {
                                    setExportOpen(false);
                                    onExport('csv');
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60"
                            >
                                Download as CSV
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setExportOpen(false);
                                    onExport('json');
                                }}
                                className="w-full text-left px-3 py-2 text-sm hover:bg-muted/60"
                            >
                                Download as JSON
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

type FilterChipKey =
    | 'actor'
    | 'fromTime'
    | 'toTime'
    | 'resourceType'
    | 'resourceId'
    | `action:${string}`;

interface FilterChip {
    key: FilterChipKey;
    label: string;
    value: string;
}

function describeFilterChips(filter: AuditFilter): FilterChip[] {
    const chips: FilterChip[] = [];
    if (filter.actorUserId) {
        chips.push({
            key: 'actor',
            label: 'Actor',
            value: `${filter.actorUserId.slice(0, 8)}...`,
        });
    }
    if (filter.fromTime) {
        chips.push({ key: 'fromTime', label: 'From', value: filter.fromTime.slice(0, 10) });
    }
    if (filter.toTime) {
        chips.push({ key: 'toTime', label: 'To', value: filter.toTime.slice(0, 10) });
    }
    if (filter.resourceType) {
        chips.push({
            key: 'resourceType',
            label: 'Resource type',
            value: filter.resourceType,
        });
    }
    if (filter.resourceId) {
        chips.push({
            key: 'resourceId',
            label: 'Resource id',
            value: filter.resourceId.slice(0, 8) + '...',
        });
    }
    for (const action of filter.actions) {
        chips.push({
            key: `action:${action}` as const,
            label: 'Action',
            value: actionLabel(action),
        });
    }
    return chips;
}

function removeChip(filter: AuditFilter, key: FilterChipKey): AuditFilter {
    if (key === 'actor') return { ...filter, actorUserId: null };
    if (key === 'fromTime') return { ...filter, fromTime: null };
    if (key === 'toTime') return { ...filter, toTime: null };
    if (key === 'resourceType') return { ...filter, resourceType: null };
    if (key === 'resourceId') return { ...filter, resourceId: null };
    if (key.startsWith('action:')) {
        const target = key.slice('action:'.length);
        return { ...filter, actions: filter.actions.filter((a) => a !== target) };
    }
    return filter;
}

function ActiveFilterBar({
    chips,
    onRemove,
    onClear,
}: {
    chips: FilterChip[];
    onRemove: (key: FilterChipKey) => void;
    onClear: () => void;
}) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">
                Filters
            </span>
            {chips.map((chip) => (
                <button
                    key={chip.key}
                    type="button"
                    onClick={() => onRemove(chip.key)}
                    className={cn(
                        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
                        'border border-border bg-muted/60 text-foreground',
                        'hover:bg-muted hover:border-border/80 transition-colors',
                    )}
                >
                    <span className="font-medium text-muted-foreground">{chip.label}</span>
                    <span className="text-foreground">{chip.value}</span>
                    <X size={10} weight="bold" />
                </button>
            ))}
            <button
                type="button"
                onClick={onClear}
                className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            >
                Clear all
            </button>
        </div>
    );
}
