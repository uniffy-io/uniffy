/**
 * Sticky table header for the audit-logs table.
 *
 * The `time` header doubles as a sort toggle (server-side asc / desc).
 */

import { ArrowDown, ArrowUp } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import type { AuditSortDir } from '@/features/admin/store/auditSlice';

interface AuditTableHeaderProps {
    sortDir: AuditSortDir;
    onToggleSort: () => void;
    gridTemplate: string;
    showIp: boolean;
}

interface ColumnDef {
    key: string;
    label: string;
    sortable: boolean;
    onlyWithIp?: boolean;
}

const COLUMNS: readonly ColumnDef[] = [
    { key: 'expand', label: '', sortable: false },
    { key: 'time', label: 'Time', sortable: true },
    { key: 'actor', label: 'Actor', sortable: false },
    { key: 'action', label: 'Action', sortable: false },
    { key: 'target', label: 'Target', sortable: false },
    { key: 'ip', label: 'IP', sortable: false, onlyWithIp: true },
];

export function AuditTableHeader({
    sortDir,
    onToggleSort,
    gridTemplate,
    showIp,
}: AuditTableHeaderProps) {
    const visible = COLUMNS.filter((c) => !c.onlyWithIp || showIp);

    return (
        <div
            style={{ gridTemplateColumns: gridTemplate }}
            className={cn(
                'grid gap-3 px-3 md:px-4 lg:px-6 py-2.5 md:py-3 items-center',
                'text-xs font-semibold text-muted-foreground uppercase tracking-wider',
                'border-b border-border bg-muted/50',
            )}
        >
            {visible.map((column) => (
                <div key={column.key} className="min-w-0 flex items-center">
                    {column.sortable ? (
                        <button
                            type="button"
                            onClick={onToggleSort}
                            className={cn(
                                'inline-flex items-center gap-1 -mx-1 px-1 py-0.5 rounded',
                                'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                                'transition-colors',
                            )}
                            title={`Sort ${sortDir === 'desc' ? 'oldest first' : 'newest first'}`}
                        >
                            <span>{column.label}</span>
                            {sortDir === 'desc' ? (
                                <ArrowDown size={11} weight="bold" />
                            ) : (
                                <ArrowUp size={11} weight="bold" />
                            )}
                        </button>
                    ) : (
                        <span className="truncate">{column.label}</span>
                    )}
                </div>
            ))}
        </div>
    );
}
