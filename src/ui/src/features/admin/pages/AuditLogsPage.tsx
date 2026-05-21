/**
 * AuditLogsPage
 *
 * Org-admin facing view of the central audit log. Two-column layout
 * mirroring `/files` and `/notes`: full-width table card on the left,
 * inline right filter sidebar on lg+, Drawer on tablet / mobile.
 * Virtualized infinite scroll, inline row expansion, CSV / JSON export.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    CaretDoubleLeft,
    CaretDoubleRight,
    ClipboardText,
    DownloadSimple,
    Funnel,
    SlidersHorizontal,
    X,
} from '@phosphor-icons/react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Drawer } from '@/components/ui/drawer';
import { useAdminAccess } from '@/features/admin/hooks/useAdminHooks';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { cn } from '@/shared/utils/cn';
import {
    fetchNewestEvents,
    fetchOlderEvents,
    jumpToDate,
    setFilter,
    type AuditFilter,
    type AuditSortDir,
    type SerializedAuditEvent,
} from '@/features/admin/store/auditSlice';
import { AuditFilterRail } from '@/features/admin/pages/audit/AuditFilterRail';
import { AuditEventRow } from '@/features/admin/pages/audit/AuditEventRow';
import { AuditTableHeader } from '@/features/admin/pages/audit/AuditTableHeader';
import {
    auditGridTemplate,
} from '@/features/admin/pages/audit/columnWidths';
import {
    DEFAULT_LOOKBACK_DAYS,
    defaultAuditFilter,
    filterToSearchParams,
    searchParamsToFilter,
} from '@/features/admin/pages/audit/filterUrl';
import { actionLabel } from '@/features/admin/pages/audit/actionCatalog';
import { exportCurrentView } from '@/features/admin/pages/audit/exportClient';

interface VirtuosoTableContext {
    sortDir: AuditSortDir;
    onToggleSort: () => void;
    gridTemplate: string;
    showIp: boolean;
    loadingOlder: boolean;
    hasMore: boolean;
    fromTime: string | null;
    onExtendRange: () => void;
}

function VirtuosoStickyHeader({ context }: { context?: VirtuosoTableContext }) {
    if (!context) return null;
    return (
        <div className="sticky top-0 z-10 bg-card">
            <AuditTableHeader
                sortDir={context.sortDir}
                onToggleSort={context.onToggleSort}
                gridTemplate={context.gridTemplate}
                showIp={context.showIp}
            />
        </div>
    );
}

function VirtuosoFooter({ context }: { context?: VirtuosoTableContext }) {
    if (!context) return null;
    if (context.loadingOlder) {
        return (
            <div className="py-6 text-center text-xs text-muted-foreground">
                Loading older events...
            </div>
        );
    }
    if (!context.hasMore) {
        if (context.fromTime) {
            const since = new Date(context.fromTime).toLocaleDateString();
            return (
                <div className="py-6 flex flex-col items-center gap-2">
                    <p className="text-xs text-muted-foreground">
                        End of window (showing events since {since})
                    </p>
                    <button
                        type="button"
                        onClick={context.onExtendRange}
                        className={cn(
                            'inline-flex items-center gap-1 px-3 py-1.5 rounded-md',
                            'text-xs font-medium border border-border',
                            'text-foreground bg-muted/40 hover:bg-muted hover:border-border/80',
                            'transition-colors',
                        )}
                    >
                        Load {DEFAULT_LOOKBACK_DAYS} more days
                    </button>
                </div>
            );
        }
        return (
            <div className="py-6 text-center text-xs text-muted-foreground">
                End of audit log
            </div>
        );
    }
    return null;
}

export function AuditLogsPage() {
    useDocumentTitle('Audit Log');
    const dispatch = useAppDispatch();
    const { canAccessAdmin } = useAdminAccess();
    const { isMobile, isDesktop, isWide } = useBreakpoint();
    const sidebarInline = isDesktop || isWide;
    const showIp = !isMobile;
    const [searchParams, setSearchParams] = useSearchParams();
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const organizationSlug = useAppSelector(
        (state) => state.auth.currentOrganizationSlug,
    );
    const events = useAppSelector((state) => state.audit.events);
    const hasMore = useAppSelector((state) => state.audit.hasMore);
    const loading = useAppSelector((state) => state.audit.loading);
    const error = useAppSelector((state) => state.audit.error);
    const filter = useAppSelector((state) => state.audit.filter);

    const virtuosoRef = useRef<VirtuosoHandle>(null);
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
    const [jumpDate, setJumpDate] = useState('');
    const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);
    const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(() => {
        if (typeof window === 'undefined') return true;
        return window.localStorage.getItem('audit:sidebar-collapsed') !== '1';
    });
    const gridTemplate = useMemo(() => auditGridTemplate(showIp), [showIp]);

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

    const urlFilter = useMemo(() => searchParamsToFilter(searchParams), [searchParams]);
    const activeFilterChips = useMemo(() => describeFilterChips(filter), [filter]);

    useEffect(() => {
        if (!organizationId) return;
        if (!canAccessAdmin) return;
        dispatch(setFilter(urlFilter));
        dispatch(fetchNewestEvents({ organizationId, filter: urlFilter }));
    }, [dispatch, organizationId, canAccessAdmin, urlFilter]);

    const applyFilter = useCallback(
        (next: AuditFilter) => {
            const params = filterToSearchParams(next);
            setSearchParams(params, { replace: false });
            setExpanded(new Set());
        },
        [setSearchParams],
    );

    const clearFilter = useCallback(() => {
        applyFilter(defaultAuditFilter());
    }, [applyFilter]);

    const extendRange = useCallback(() => {
        const anchor = filter.fromTime ? new Date(filter.fromTime) : new Date();
        anchor.setDate(anchor.getDate() - DEFAULT_LOOKBACK_DAYS);
        applyFilter({ ...filter, fromTime: anchor.toISOString() });
    }, [applyFilter, filter]);

    const handleToggleSort = useCallback(() => {
        const nextDir: 'desc' | 'asc' = filter.sortDir === 'desc' ? 'asc' : 'desc';
        applyFilter({ ...filter, sortDir: nextDir });
    }, [applyFilter, filter]);

    const handleLoadOlder = useCallback(() => {
        if (loading !== 'idle' || !hasMore) return;
        dispatch(fetchOlderEvents());
    }, [dispatch, hasMore, loading]);

    const handleJumpToDate = useCallback(() => {
        if (!jumpDate || !organizationId) return;
        const toTime = new Date(`${jumpDate}T23:59:59`).toISOString();
        dispatch(jumpToDate({ organizationId, filter, toTime }));
        virtuosoRef.current?.scrollToIndex({ index: 0 });
    }, [dispatch, jumpDate, organizationId, filter]);

    const toggleExpanded = useCallback((id: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            } else {
                next.add(id);
            }
            return next;
        });
    }, []);

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

    return (
        <div className="space-y-6 pb-12">
            <PageHeader
                jumpDate={jumpDate}
                onJumpDateChange={setJumpDate}
                onJumpToDate={handleJumpToDate}
                onExport={handleExport}
                exporting={exporting}
                onOpenFilters={() => setFilterDrawerOpen(true)}
                activeFilterCount={activeFilterChips.length}
                showFiltersButton={!sidebarInline}
            />

            {activeFilterChips.length > 0 && (
                <ActiveFilterBar
                    chips={activeFilterChips}
                    onRemove={(key) =>
                        applyFilter(removeChip(filter, key))
                    }
                    onClear={clearFilter}
                />
            )}

            <div className="flex gap-6">
                <div className="flex-1 min-w-0 rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                    {loading === 'fetching-newest' && events.length === 0 ? (
                        <>
                            <AuditTableHeader
                                sortDir={filter.sortDir}
                                onToggleSort={handleToggleSort}
                                gridTemplate={gridTemplate}
                                showIp={showIp}
                            />
                            <LoadingState />
                        </>
                    ) : error ? (
                        <>
                            <AuditTableHeader
                                sortDir={filter.sortDir}
                                onToggleSort={handleToggleSort}
                                gridTemplate={gridTemplate}
                                showIp={showIp}
                            />
                            <ErrorState message={error} />
                        </>
                    ) : events.length === 0 ? (
                        <>
                            <AuditTableHeader
                                sortDir={filter.sortDir}
                                onToggleSort={handleToggleSort}
                                gridTemplate={gridTemplate}
                                showIp={showIp}
                            />
                            <EmptyState
                                onClear={clearFilter}
                                hasFilter={activeFilterChips.length > 0}
                            />
                        </>
                    ) : (
                        <Virtuoso<SerializedAuditEvent, VirtuosoTableContext>
                            ref={virtuosoRef}
                            data={events}
                            style={{
                                height: 'calc(100dvh - 16rem)',
                                minHeight: '480px',
                            }}
                            endReached={handleLoadOlder}
                            overscan={400}
                            context={{
                                sortDir: filter.sortDir,
                                onToggleSort: handleToggleSort,
                                gridTemplate,
                                showIp,
                                loadingOlder: loading === 'fetching-older',
                                hasMore,
                                fromTime: filter.fromTime,
                                onExtendRange: extendRange,
                            }}
                            itemContent={(_, event) => (
                                <AuditEventRow
                                    event={event}
                                    expanded={expanded.has(event.id)}
                                    onToggleExpanded={() => toggleExpanded(event.id)}
                                    gridTemplate={gridTemplate}
                                    showIp={showIp}
                                />
                            )}
                            components={{
                                Header: VirtuosoStickyHeader,
                                Footer: VirtuosoFooter,
                            }}
                        />
                    )}
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
                                    {activeFilterChips.length > 0 && (
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
                                <AuditFilterRail filter={filter} onChange={applyFilter} />
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
                                    activeFilterChips.length > 0
                                        ? `Filters (${activeFilterChips.length})`
                                        : 'Filters'
                                }
                            >
                                <div className="relative">
                                    <Funnel
                                        size={20}
                                        weight="duotone"
                                        className={cn(
                                            activeFilterChips.length > 0
                                                ? 'text-primary'
                                                : 'text-muted-foreground',
                                        )}
                                    />
                                    {activeFilterChips.length > 0 && (
                                        <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-primary text-[10px] font-semibold text-primary-foreground flex items-center justify-center">
                                            {activeFilterChips.length}
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
                    <AuditFilterRail filter={filter} onChange={applyFilter} compact />
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

interface ActiveFilterBarProps {
    chips: FilterChip[];
    onRemove: (key: FilterChipKey) => void;
    onClear: () => void;
}

function ActiveFilterBar({ chips, onRemove, onClear }: ActiveFilterBarProps) {
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
        chips.push({
            key: 'fromTime',
            label: 'From',
            value: filter.fromTime.slice(0, 10),
        });
    }
    if (filter.toTime) {
        chips.push({
            key: 'toTime',
            label: 'To',
            value: filter.toTime.slice(0, 10),
        });
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

function LoadingState() {
    return (
        <div className="flex flex-col items-center justify-center py-16 gap-2">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
            <p className="text-sm text-muted-foreground">Loading audit events...</p>
        </div>
    );
}

interface EmptyStateProps {
    onClear: () => void;
    hasFilter: boolean;
}

function EmptyState({ onClear, hasFilter }: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <ClipboardText
                size={48}
                weight="duotone"
                className="text-muted-foreground/50"
            />
            <p className="text-sm font-medium text-foreground">
                No events match the current filters
            </p>
            <p className="text-xs text-muted-foreground">
                Adjust the date range, actor, or action filter to surface more activity.
            </p>
            {hasFilter && (
                <Button variant="secondary" size="sm" onClick={onClear}>
                    Clear filters
                </Button>
            )}
        </div>
    );
}

function ErrorState({ message }: { message: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
            <p className="text-sm font-medium text-destructive">
                Could not load audit events
            </p>
            <p className="text-xs text-muted-foreground">{message}</p>
        </div>
    );
}
