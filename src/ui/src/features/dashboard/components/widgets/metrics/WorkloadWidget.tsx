import { UsersThree } from "@phosphor-icons/react";
import { SubjectAvatar } from "@/components/subject/SubjectAvatar";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import { EmptyWidget } from "@/features/dashboard/components/widgets/WidgetCard";
import { MetricWidgetCard } from "@/features/dashboard/components/widgets/metrics/MetricWidgetCard";
import { useTaskMetric } from "@/features/dashboard/hooks/useTaskMetric";
import type { DashboardWidget } from "@/features/dashboard/types";
import { brandAxisColor } from "@/config/theme/brandGradients";

const ROWS = 8;

export function WorkloadWidget({ widget }: { widget: DashboardWidget }) {
  const { data, loading, failed } = useTaskMetric(widget.id, "workload", widget.filters, ROWS);
  const rows = data?.workload ?? [];
  const { subjects } = useSubjectResolver(rows.map((row) => row.userId).filter(Boolean));
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  const widest = Math.max(1, ...rows.map((row) => row.open));

  return (
    <MetricWidgetCard
      widget={widget}
      title="Workload"
      icon={UsersThree}
      colSpan={2}
      loading={loading}
      failed={failed}
      count={data?.total}
    >
      {rows.length === 0 ? (
        <EmptyWidget
          icon={UsersThree}
          title="No open work"
          description="Nobody has open tasks here."
        />
      ) : (
        <ul className="space-y-2.5">
          {rows.map((row) => {
            const subject = row.userId ? byId.get(row.userId) : undefined;
            const name = row.userId ? (subject?.name ?? "Someone") : "Unassigned";
            return (
              <li key={row.userId || "unassigned"} className="flex items-center gap-3">
                {subject ? (
                  <SubjectAvatar subject={subject} size="sm" />
                ) : (
                  <span className="size-7 shrink-0 rounded-full bg-muted" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate font-medium text-foreground">{name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {row.open} open
                      {row.overdue > 0 && (
                        <span className="text-red-600 dark:text-red-400">
                          {" "}
                          · {row.overdue} overdue
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(row.open / widest) * 100}%`,
                        background: `linear-gradient(90deg, ${brandAxisColor(0)}, ${brandAxisColor(0.6)})`,
                      }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </MetricWidgetCard>
  );
}
