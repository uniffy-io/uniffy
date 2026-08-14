import { Funnel } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { actionDomainColor, actionLabel } from "@/features/admin/pages/audit/actionCatalog";
import type { ActionGroup, AuditFilter } from "@/components/audit/types";

export interface AuditActionFilterProps {
  filter: AuditFilter;
  onChange: (next: AuditFilter) => void;
  groups: ActionGroup[];
}

export function AuditActionFilter({ filter, onChange, groups }: AuditActionFilterProps) {
  const toggle = (value: string) => {
    const next = filter.actions.includes(value)
      ? filter.actions.filter((a) => a !== value)
      : [...filter.actions, value];
    onChange({ ...filter, actions: next });
  };

  if (groups.length === 0) return null;

  return (
    <details className="rounded-lg border border-border bg-card">
      <summary className="px-4 py-2 cursor-pointer flex items-center gap-2 text-sm font-medium hover:bg-accent rounded-lg select-none">
        <Funnel size={14} weight="duotone" />
        Filter by action ({filter.actions.length} selected)
      </summary>
      <div className="p-3 border-t border-border space-y-3">
        {groups.map((group) => (
          <div key={group.domain}>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
              {group.label}
            </div>
            <div className="flex flex-wrap gap-1">
              {group.actions.map((entry) => {
                const active = filter.actions.includes(entry.value);
                return (
                  <button
                    key={entry.value}
                    type="button"
                    onClick={() => toggle(entry.value)}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                      active
                        ? actionDomainColor(entry.value)
                        : "bg-muted text-muted-foreground hover:bg-accent",
                    )}
                  >
                    {actionLabel(entry.value)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}
