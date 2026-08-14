import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardText, Funnel, CaretDoubleLeft, CaretDoubleRight, X } from "@phosphor-icons/react";
import { useDocumentTitle } from "@/shared/hooks/useDocumentTitle";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { friendlyErrorMessage } from "@/config";
import { platformAuditApi } from "@/features/platform/api/platformAuditApi";
import { platformOrgsApi } from "@/features/platform/api/systemDirectoryApi";
import {
  AuditActionFilter,
  AuditEventTable,
  AuditFilterRail,
  EMPTY_AUDIT_FILTER,
  type ActionGroup,
  type AuditEvent,
  type AuditFilter,
  type AuditFilterFields,
  type OrganizationOption,
} from "@/components/audit";
import { actionLabel } from "@/features/admin/pages/audit/actionCatalog";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { PlatformAuditEvent } from "@uniffy/proto/superadmin/v1/platform_audit_pb";

type ProtoTimestamp = { seconds: number | bigint; nanos: number };

const PAGE_SIZE = 50;

const PLATFORM_FILTER_FIELDS: AuditFilterFields = {
  dateRange: true,
  actor: false,
  actions: false,
  resourceType: false,
  resourceUrn: false,
  organization: true,
};

const GROUP_LABELS: Record<string, string> = {
  auth: "Auth",
  user: "Users",
  organization: "Organizations",
  support_session: "Support sessions",
  system: "System",
  deployment: "Deployment",
  mail: "Mail",
};

function protoToIso(ts: ProtoTimestamp | undefined): string {
  if (!ts) return "";
  const ms = typeof ts.seconds === "bigint" ? Number(ts.seconds) * 1000 : ts.seconds * 1000;
  return new Date(ms).toISOString();
}

function toAuditEvent(row: PlatformAuditEvent): AuditEvent {
  return {
    id: row.id,
    createdAt: protoToIso(row.createdAt),
    action: row.action,
    actorUserId: row.actorUserId || null,
    actorEmail: row.actorEmail || null,
    actorOrgRole: row.actorOrgRole || null,
    organizationId: row.organizationId || null,
    organizationName: row.organizationName || null,
    resourceType: row.resourceType || null,
    resourceId: row.resourceId || null,
    detailsJson: row.detailsJson || "{}",
    ipAddress: null,
    userAgent: null,
    onBehalfOfUserId: null,
  };
}

export function PlatformAuditPage() {
  useDocumentTitle("Platform Audit");
  const { isMobileOrTablet } = useBreakpoint();
  const [rows, setRows] = useState<PlatformAuditEvent[]>([]);
  const [actionGroups, setActionGroups] = useState<ActionGroup[]>([]);
  const [orgOptions, setOrgOptions] = useState<OrganizationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<AuditFilter>(EMPTY_AUDIT_FILTER);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.localStorage.getItem("platform-audit:sidebar-collapsed") !== "1";
  });
  const sidebarInline = !isMobileOrTablet;

  const toggleSidebar = useCallback(() => {
    setSidebarExpanded((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem("platform-audit:sidebar-collapsed", next ? "0" : "1");
      } catch {
        // localStorage unavailable
      }
      return next;
    });
  }, []);

  useEffect(() => {
    platformAuditApi
      .listActions({})
      .then((response) => {
        const map = new Map<string, ActionGroup>();
        for (const entry of response.actions) {
          let group = map.get(entry.group);
          if (!group) {
            group = {
              domain: entry.group,
              label: GROUP_LABELS[entry.group] ?? humanize(entry.group),
              actions: [],
            };
            map.set(entry.group, group);
          }
          group.actions.push({
            value: entry.action,
            label: actionLabel(entry.action),
          });
        }
        setActionGroups(Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label)));
      })
      .catch((error) => {
        const message = friendlyErrorMessage((error as Error).message);
        if (message) toast.error(message);
      });
  }, []);

  useEffect(() => {
    platformOrgsApi
      .list({ page: 0, pageSize: 200, search: "", includeDeleted: true, onlySuspended: false })
      .then((response) => {
        setOrgOptions(
          response.organizations.map((o) => ({
            id: o.id,
            name: o.name,
            slug: o.slug,
          })),
        );
      })
      .catch(() => {
        // Org filter is optional; ignore errors silently.
      });
  }, []);

  const fetchRows = useCallback(async () => {
    setLoading(true);
    try {
      const response = await platformAuditApi.listEvents({
        page,
        pageSize: PAGE_SIZE,
        actions: filter.actions,
        organizationId: filter.organizationId ?? "",
        actorUserId: filter.actorUserId ?? "",
        fromTs: filter.fromTime ? timestampFromDate(new Date(filter.fromTime)) : undefined,
        toTs: filter.toTime ? timestampFromDate(new Date(filter.toTime)) : undefined,
      });
      setRows(response.events);
      setTotalCount(response.totalCount);
    } catch (error) {
      const message = friendlyErrorMessage((error as Error).message);
      if (message) toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const events = useMemo(() => rows.map(toAuditEvent), [rows]);
  const activeFilterChips = useMemo(
    () => describeFilterChips(filter, orgOptions),
    [filter, orgOptions],
  );
  const activeFilterCount = activeFilterChips.length;

  const handleFilterChange = (next: AuditFilter) => {
    setFilter(next);
    setPage(0);
  };

  const clearFilters = () => {
    setFilter(EMPTY_AUDIT_FILTER);
    setPage(0);
  };

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const pageInfo =
    totalCount > 0
      ? `${page * PAGE_SIZE + 1}-${Math.min((page + 1) * PAGE_SIZE, totalCount)} of ${totalCount}`
      : "0";

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10 shrink-0">
          <ClipboardText size={22} weight="duotone" className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-semibold text-foreground">Audit</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Platform-scope audit feed across every tenant. Tenant content audit is excluded
            server-side by an action whitelist.
          </p>
        </div>
        {!sidebarInline && (
          <Button
            variant={activeFilterCount > 0 ? "default" : "secondary"}
            size="md"
            onClick={() => setFilterDrawerOpen(true)}
          >
            <Funnel size={14} weight="duotone" />
            <span className="hidden sm:inline">
              Filters
              {activeFilterCount > 0 && ` (${activeFilterCount})`}
            </span>
          </Button>
        )}
      </div>

      <AuditActionFilter filter={filter} onChange={handleFilterChange} groups={actionGroups} />

      {activeFilterChips.length > 0 && (
        <ActiveFilterBar
          chips={activeFilterChips}
          onRemove={(key) => handleFilterChange(removeChip(filter, key))}
          onClear={clearFilters}
        />
      )}

      <div className="flex gap-6">
        <div className="flex-1 min-w-0 rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <AuditEventTable
            events={events}
            loading={loading}
            showOrganization
            emptyDescription="No platform-scope audit events yet."
            hasActiveFilters={activeFilterCount > 0}
          />
          <div className="flex items-center justify-between px-3 py-2 border-t border-border text-xs text-muted-foreground">
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
                      onClick={clearFilters}
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
                  onChange={handleFilterChange}
                  fields={PLATFORM_FILTER_FIELDS}
                  actionGroups={actionGroups}
                  organizationOptions={orgOptions}
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
                title={activeFilterCount > 0 ? `Filters (${activeFilterCount})` : "Filters"}
              >
                <div className="relative">
                  <Funnel
                    size={20}
                    weight="duotone"
                    className={cn(activeFilterCount > 0 ? "text-primary" : "text-muted-foreground")}
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
            onChange={handleFilterChange}
            fields={PLATFORM_FILTER_FIELDS}
            actionGroups={actionGroups}
            organizationOptions={orgOptions}
            compact
          />
        </Drawer>
      )}
    </div>
  );
}

type FilterChipKey = "fromTime" | "toTime" | "organization" | `action:${string}`;

interface FilterChip {
  key: FilterChipKey;
  label: string;
  value: string;
}

function describeFilterChips(filter: AuditFilter, orgs: OrganizationOption[]): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filter.fromTime) {
    chips.push({ key: "fromTime", label: "From", value: filter.fromTime.slice(0, 10) });
  }
  if (filter.toTime) {
    chips.push({ key: "toTime", label: "To", value: filter.toTime.slice(0, 10) });
  }
  if (filter.organizationId) {
    const org = orgs.find((o) => o.id === filter.organizationId);
    chips.push({
      key: "organization",
      label: "Org",
      value: org?.name ?? filter.organizationId.slice(0, 8) + "...",
    });
  }
  for (const action of filter.actions) {
    chips.push({
      key: `action:${action}` as const,
      label: "Action",
      value: actionLabel(action),
    });
  }
  return chips;
}

function removeChip(filter: AuditFilter, key: FilterChipKey): AuditFilter {
  if (key === "fromTime") return { ...filter, fromTime: null };
  if (key === "toTime") return { ...filter, toTime: null };
  if (key === "organization") return { ...filter, organizationId: null };
  if (key.startsWith("action:")) {
    const target = key.slice("action:".length);
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
      <span className="text-xs uppercase tracking-wider text-muted-foreground">Filters</span>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onRemove(chip.key)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs",
            "border border-border bg-muted/60 text-foreground",
            "hover:bg-muted hover:border-border/80 transition-colors",
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

function humanize(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
