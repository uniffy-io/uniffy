import type { ReactNode } from "react";
import type { Icon } from "@phosphor-icons/react";
import { WarningCircle } from "@phosphor-icons/react";
import { useProjectNames } from "@/features/dashboard/hooks/useProjectNames";
import { WidgetCard, WidgetSkeleton } from "@/features/dashboard/components/widgets/WidgetCard";
import type { DashboardWidget } from "@/features/dashboard/types";
import { describeFilters } from "@/features/dashboard/utils/layout";

interface MetricWidgetCardProps {
  widget: DashboardWidget;
  title: string;
  icon: Icon;
  colSpan?: 1 | 2 | 3 | 4;
  loading: boolean;
  failed: boolean;
  /** Headline number beside the title. */
  count?: number;
  footer?: ReactNode;
  children: ReactNode;
  skeleton?: "list" | "stat" | "timeline";
}

/** Card shell for the task-metric widgets: names the active filters and flags unsupported ones. */
export function MetricWidgetCard({
  widget,
  title,
  icon,
  colSpan = 1,
  loading,
  failed,
  count,
  footer,
  children,
  skeleton = "list",
}: MetricWidgetCardProps) {
  const known = useProjectNames(
    widget.filters.projects === "selected" ? widget.filters.projectIds : [],
  );
  const names = widget.filters.projectIds.flatMap((id) => (known[id] ? [known[id]] : []));
  const subtitle = describeFilters(widget.filters, names) || undefined;

  return (
    <WidgetCard
      title={title}
      subtitle={subtitle}
      icon={icon}
      colSpan={colSpan}
      minHeight="200px"
      footer={footer}
      action={
        count !== undefined && count > 0 && !loading ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground">
            {count}
          </span>
        ) : undefined
      }
    >
      {widget.unsupportedFilters.length > 0 && (
        <p className="mb-3 flex items-start gap-1.5 rounded-md bg-yellow-100 px-2 py-1.5 text-xs text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">
          <WarningCircle size={14} className="mt-px shrink-0" />
          <span>
            This widget was saved with filters this version cannot apply (
            {widget.unsupportedFilters.join(", ")}). It counts without them until you edit it.
          </span>
        </p>
      )}
      {loading ? (
        <WidgetSkeleton rows={3} variant={skeleton} />
      ) : failed ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Could not load this widget. Refresh to try again.
        </p>
      ) : (
        children
      )}
    </WidgetCard>
  );
}
