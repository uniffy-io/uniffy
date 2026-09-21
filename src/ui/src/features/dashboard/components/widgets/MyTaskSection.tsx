import { Link } from "react-router-dom";
import { cn } from "@/shared/utils/cn";
import { formatDateShort } from "@/shared/utils/dateFormatting";
import { taskPath } from "@/features/projects/utils/taskPath";
import type { Project, Task } from "@/features/projects/types/project";

export type MyTaskTone = "overdue" | "today" | "upcoming";

type ProjectsById = Record<string, Pick<Project, "name" | "slug"> | undefined>;

const TONE_TEXT: Record<MyTaskTone, string> = {
  overdue: "text-red-600 dark:text-red-400",
  today: "text-amber-600 dark:text-amber-400",
  upcoming: "text-muted-foreground",
};

const TONE_BORDER: Record<MyTaskTone, string> = {
  overdue: "border-red-500",
  today: "border-amber-500",
  upcoming: "border-border",
};

function MyTaskRow({
  task,
  project,
  tone,
}: {
  task: Task;
  project: Pick<Project, "name" | "slug"> | undefined;
  tone: MyTaskTone;
}) {
  const context = project ? `${project.name} - ${project.slug}-${task.number}` : "Unknown project";

  return (
    <Link
      to={taskPath(task.projectId, task.id)}
      className="group flex items-center gap-3 rounded-lg p-2 -mx-2 transition-colors hover:bg-muted/50"
    >
      <div className={cn("w-4 h-4 rounded border-2 flex-shrink-0", TONE_BORDER[tone])} />

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
          {task.title || "Untitled Task"}
        </p>
        <p className="text-xs text-muted-foreground truncate">{context}</p>
      </div>

      {task.dueDate && (
        <span
          className={cn(
            "text-xs flex-shrink-0",
            TONE_TEXT[tone],
            tone !== "upcoming" && "font-medium",
          )}
        >
          {formatDateShort(task.dueDate)}
        </span>
      )}
    </Link>
  );
}

interface MyTaskSectionProps {
  label: string;
  tone: MyTaskTone;
  tasks: Task[];
  projects: ProjectsById;
  /** Rows to render; the header count always reflects every task. */
  limit?: number;
}

export function MyTaskSection({
  label,
  tone,
  tasks,
  projects,
  limit = tasks.length,
}: MyTaskSectionProps) {
  if (tasks.length === 0 || limit <= 0) return null;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 pt-1 pb-0.5">
        <span className={cn("text-xs font-semibold uppercase tracking-wider", TONE_TEXT[tone])}>
          {label}
        </span>
        <span
          className={cn("text-xs rounded-full px-1.5 py-0.5 font-medium bg-muted", TONE_TEXT[tone])}
        >
          {tasks.length}
        </span>
      </div>
      {tasks.slice(0, limit).map((task) => (
        <MyTaskRow key={task.id} task={task} project={projects[task.projectId]} tone={tone} />
      ))}
    </div>
  );
}
