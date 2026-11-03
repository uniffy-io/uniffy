import { Link } from "react-router-dom";
import type { Icon } from "@phosphor-icons/react";
import { Eye, Prohibit, WarningCircle } from "@phosphor-icons/react";
import { EmptyWidget } from "@/features/dashboard/components/widgets/WidgetCard";
import { MetricWidgetCard } from "@/features/dashboard/components/widgets/metrics/MetricWidgetCard";
import { useTaskMetric } from "@/features/dashboard/hooks/useTaskMetric";
import type {
  DashboardWidget,
  MetricProjectRef,
  MetricTask,
  TaskMetricKind,
} from "@/features/dashboard/types";
import type { TaskListWidgetId } from "@/features/dashboard/utils/layout";
import { taskLinkPath } from "@/features/projects/utils/taskPath";
import { cn } from "@/shared/utils/cn";
import { formatDateShort, isOverdue } from "@/shared/utils/dateFormatting";

const ROWS = 6;

interface TaskListConfig {
  metric: TaskMetricKind;
  title: string;
  icon: Icon;
  emptyTitle: string;
  emptyDescription: string;
}

const CONFIG: Record<TaskListWidgetId, TaskListConfig> = {
  "overdue-tasks": {
    metric: "overdue",
    title: "Overdue tasks",
    icon: WarningCircle,
    emptyTitle: "Nothing overdue",
    emptyDescription: "Every open task here is on schedule.",
  },
  "blocked-tasks": {
    metric: "blocked",
    title: "Blocked tasks",
    icon: Prohibit,
    emptyTitle: "Nothing blocked",
    emptyDescription: "No open task is waiting on another one.",
  },
  "review-queue": {
    metric: "review_queue",
    title: "Review queue",
    icon: Eye,
    emptyTitle: "Review queue is empty",
    emptyDescription: "No open task is waiting for review.",
  },
};

function MetricTaskRow({ task, project }: { task: MetricTask; project?: MetricProjectRef }) {
  const late = task.dueDate ? isOverdue(task.dueDate) : false;
  return (
    <Link
      to={taskLinkPath(task.taskId)}
      className="group -mx-2 flex min-h-11 items-center gap-3 rounded-lg p-2 transition-colors hover:bg-muted/50 lg:min-h-0"
    >
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-primary">
          {task.title || "Untitled task"}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {project ? `${project.name} - ${project.slug}-${task.number}` : `#${task.number}`}
        </p>
      </div>
      {task.dueDate && (
        <span
          className={cn(
            "shrink-0 text-xs",
            late ? "font-medium text-red-600 dark:text-red-400" : "text-muted-foreground",
          )}
        >
          {formatDateShort(task.dueDate)}
        </span>
      )}
    </Link>
  );
}

export function TaskListMetricWidget({
  widget,
}: {
  widget: DashboardWidget & { id: TaskListWidgetId };
}) {
  const config = CONFIG[widget.id];
  const { data, loading, failed } = useTaskMetric(widget.id, config.metric, widget.filters, ROWS);
  const total = data?.total ?? 0;

  return (
    <MetricWidgetCard
      widget={widget}
      title={config.title}
      icon={config.icon}
      loading={loading}
      failed={failed}
      count={total}
      footer={
        total > ROWS ? (
          <span className="text-xs text-muted-foreground">
            Showing {ROWS} of {total}
          </span>
        ) : undefined
      }
    >
      {total === 0 ? (
        <EmptyWidget
          icon={config.icon}
          title={config.emptyTitle}
          description={config.emptyDescription}
        />
      ) : (
        <div className="space-y-0.5">
          {data?.items.map((task) => (
            <MetricTaskRow key={task.taskId} task={task} project={data?.projects[task.projectId]} />
          ))}
        </div>
      )}
    </MetricWidgetCard>
  );
}
