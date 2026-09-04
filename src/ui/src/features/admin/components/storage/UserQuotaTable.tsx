import { useState, useMemo } from "react";
import { MagnifyingGlass, ArrowsClockwise, PencilSimple } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { recalculateStorageUsage } from "@/features/admin/store/adminThunks";
import { StorageProgressBar } from "@/features/admin/components/storage/StorageProgressBar";
import { SetUserQuotaDialog } from "@/features/admin/components/storage/SetUserQuotaDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatFileSize } from "@/shared/utils/dateFormatting";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { cn } from "@/shared/utils/cn";
import type { SerializedStorageUsageInfo } from "@/features/admin/store/adminSlice";

type SortField = "userId" | "usedBytes" | "effectiveQuotaBytes" | "usagePercent";

export function UserQuotaTable() {
  const dispatch = useAppDispatch();
  const { isMobile } = useBreakpoint();
  const userUsageList = useAppSelector((state) => state.admin.userUsageList);
  const loading = useAppSelector((state) => state.admin.userUsageListLoading);
  const members = useAppSelector((state) => state.admin.members);

  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("usedBytes");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [editUser, setEditUser] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);

  const memberMap = useMemo(() => {
    const map: Record<string, { name: string; email: string }> = {};
    for (const m of members) {
      map[m.userId] = { name: m.displayName, email: m.email };
    }
    return map;
  }, [members]);

  const filteredAndSorted = useMemo(() => {
    let list = [...userUsageList];

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((u) => {
        const info = memberMap[u.userId];
        if (!info) return u.userId.toLowerCase().includes(q);
        return info.name.toLowerCase().includes(q) || info.email.toLowerCase().includes(q);
      });
    }

    list.sort((a, b) => {
      const aVal = a[sortField] ?? 0;
      const bVal = b[sortField] ?? 0;
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDir === "asc" ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });

    return list;
  }, [userUsageList, search, sortField, sortDir, memberMap]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  async function handleRecalculate() {
    setRecalculating(true);
    try {
      await dispatch(recalculateStorageUsage({})).unwrap();
    } finally {
      setRecalculating(false);
    }
  }

  if (loading && userUsageList.length === 0) {
    return (
      <div className="rounded-xl bg-surface shadow-edge p-6 animate-pulse">
        <div className="h-4 w-48 bg-muted rounded mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 bg-muted rounded" />
          ))}
        </div>
      </div>
    );
  }

  const emptyMessage = search
    ? "No users match the search."
    : "No active members in this organization.";

  return (
    <>
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-foreground">User Storage Usage</h3>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none sm:w-64">
              <MagnifyingGlass
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="text"
                placeholder="Search users..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 pr-3"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRecalculate}
              disabled={recalculating}
              title="Recalculate all usage from files"
            >
              <ArrowsClockwise
                size={16}
                weight="duotone"
                className={cn(recalculating && "animate-spin")}
              />
            </Button>
          </div>
        </div>

        {isMobile ? (
          <div className="rounded-xl bg-surface shadow-edge">
            {filteredAndSorted.length === 0 ? (
              <p className="p-8 text-center text-muted-foreground text-sm">{emptyMessage}</p>
            ) : (
              <MobileCards items={filteredAndSorted} memberMap={memberMap} onEdit={setEditUser} />
            )}
          </div>
        ) : (
          <DesktopTable
            items={filteredAndSorted}
            memberMap={memberMap}
            sortField={sortField}
            sortDir={sortDir}
            onSort={handleSort}
            onEdit={setEditUser}
            emptyMessage={emptyMessage}
          />
        )}
      </div>

      <SetUserQuotaDialog
        open={editUser !== null}
        userId={editUser}
        onClose={() => setEditUser(null)}
      />
    </>
  );
}

function DesktopTable({
  items,
  memberMap,
  sortField,
  sortDir,
  onSort,
  onEdit,
  emptyMessage,
}: {
  items: SerializedStorageUsageInfo[];
  memberMap: Record<string, { name: string; email: string }>;
  sortField: SortField;
  sortDir: string;
  onSort: (field: SortField) => void;
  onEdit: (userId: string) => void;
  emptyMessage: string;
}) {
  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return "";
    return sortDir === "asc" ? " ^" : " v";
  };

  return (
    <Table>
      <TableHeader>
        <TableRow hoverable={false}>
          <TableHead>User</TableHead>
          <TableHead
            align="right"
            className="cursor-pointer hover:text-foreground"
            onClick={() => onSort("usedBytes")}
          >
            Used{sortIndicator("usedBytes")}
          </TableHead>
          <TableHead
            align="right"
            className="cursor-pointer hover:text-foreground hidden lg:table-cell"
            onClick={() => onSort("effectiveQuotaBytes")}
          >
            Quota{sortIndicator("effectiveQuotaBytes")}
          </TableHead>
          <TableHead className="hidden md:table-cell">Usage</TableHead>
          <TableHead
            align="right"
            className="cursor-pointer hover:text-foreground"
            onClick={() => onSort("usagePercent")}
          >
            %{sortIndicator("usagePercent")}
          </TableHead>
          <TableHead align="right">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.length === 0 ? (
          <TableEmpty colSpan={6} title={emptyMessage} />
        ) : (
          items.map((usage) => {
            const info = memberMap[usage.userId];
            return (
              <TableRow key={usage.userId}>
                <TableCell>
                  <div>
                    <p className="font-medium text-foreground">{info?.name || "Unknown"}</p>
                    <p className="text-xs text-muted-foreground">{info?.email || ""}</p>
                  </div>
                </TableCell>
                <TableCell align="right" className="text-foreground">
                  {formatFileSize(usage.usedBytes)}
                </TableCell>
                <TableCell align="right" className="text-foreground hidden lg:table-cell">
                  <span className="flex items-center justify-end gap-1.5">
                    {usage.hasOverride ? (
                      usage.effectiveQuotaBytes !== null ? (
                        formatFileSize(usage.effectiveQuotaBytes)
                      ) : (
                        "Unlimited"
                      )
                    ) : (
                      <span className="text-muted-foreground">
                        Default (
                        {usage.effectiveQuotaBytes !== null
                          ? formatFileSize(usage.effectiveQuotaBytes)
                          : "Unlimited"}
                        )
                      </span>
                    )}
                    {usage.hasOverride && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                        Custom
                      </span>
                    )}
                  </span>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <StorageProgressBar
                    usedBytes={usage.usedBytes}
                    quotaBytes={usage.effectiveQuotaBytes}
                    showLabels={false}
                    size="sm"
                  />
                </TableCell>
                <TableCell align="right" className="text-foreground">
                  {usage.effectiveQuotaBytes !== null ? `${usage.usagePercent.toFixed(1)}%` : "-"}
                </TableCell>
                <TableCell align="right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(usage.userId)}
                    title="Set quota override"
                  >
                    <PencilSimple size={16} weight="duotone" />
                  </Button>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

function MobileCards({
  items,
  memberMap,
  onEdit,
}: {
  items: SerializedStorageUsageInfo[];
  memberMap: Record<string, { name: string; email: string }>;
  onEdit: (userId: string) => void;
}) {
  return (
    <div className="divide-y divide-border">
      {items.map((usage) => {
        const info = memberMap[usage.userId];
        return (
          <div key={usage.userId} className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="font-medium text-foreground text-sm">{info?.name || "Unknown"}</p>
                <p className="text-xs text-muted-foreground">{info?.email || ""}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => onEdit(usage.userId)}>
                <PencilSimple size={16} weight="duotone" />
              </Button>
            </div>
            <StorageProgressBar
              usedBytes={usage.usedBytes}
              quotaBytes={usage.effectiveQuotaBytes}
              showLabels={true}
              size="sm"
            />
            {usage.hasOverride && (
              <span className="mt-1 inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                Custom quota
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
