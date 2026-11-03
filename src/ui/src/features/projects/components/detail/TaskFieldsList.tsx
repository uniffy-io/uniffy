import { Clock } from "@phosphor-icons/react";
import { toast } from "sonner";
import { useAppDispatch } from "@/app/hooks";
import { DatePicker } from "@/components/ui/date-picker";
import { TaskTypeIcon } from "@/features/projects/components/TaskTypeIcon";
import { AssigneeField } from "@/features/projects/components/detail/fields/AssigneeField";
import { PriorityPicker } from "@/features/projects/components/detail/fields/OptionPickers";
import { SprintSelector } from "@/features/projects/components/detail/fields/SprintSelector";
import { TimeField } from "@/features/projects/components/detail/fields/TimeField";
import { ParentPicker } from "@/features/projects/components/detail/ParentPicker";
import { TaskRecurrenceSelector } from "@/features/projects/components/detail/TaskRecurrenceSelector";
import { optimisticUpdateTask } from "@/features/projects/store/projectsSlice";
import { updateTask } from "@/features/projects/store/projectsThunks";
import { useOpenTask } from "@/features/projects/hooks/useOpenTask";
import type { Project, SelectOption, Sprint, Task } from "@/features/projects/types";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { PinnableTaskField } from "@/features/projects/utils/pinnedFields";
import { formatMinutes } from "@/features/projects/utils/timeFormatting";
import { TASK_TYPES, getHierarchyRuleViolation } from "@/features/projects/utils/taskTypes";
import { cn } from "@/shared/utils/cn";
import { isOverdue } from "@/shared/utils/dateFormatting";

interface TaskFieldsListProps {
  task: Task;
  project: Project | null;
  allProjectTasks: Task[];
  sprints: Sprint[];
  /** Time logged on descendants, shown beside the task's own time. */
  subtaskTimeSpent: number;
  canEdit: boolean;
  /** Fields already shown as pins above the description, so each field has one place. */
  pinned: readonly PinnableTaskField[];
}

/** Every task field with its editor: priority, type, parent, people, dates, sprint and time. */
export function TaskFieldsList({
  task,
  project,
  allProjectTasks,
  sprints,
  subtaskTimeSpent,
  canEdit,
  pinned,
}: TaskFieldsListProps) {
  const dispatch = useAppDispatch();
  const openTask = useOpenTask();
  const shows = (field: PinnableTaskField) => !pinned.includes(field);
  const priorityField = project?.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.PRIORITY);
  const priorityOption = priorityField?.config.options?.find((o) => o.id === task.priority);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {shows("priority") && priorityOption && priorityField && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground w-20">Priority</span>
            <PriorityPicker
              currentOption={priorityOption}
              options={(priorityField.config.options ?? []) as SelectOption[]}
              onSelect={(newPriority) => {
                dispatch(
                  optimisticUpdateTask({
                    id: task.id,
                    priority: newPriority,
                  }),
                );
                dispatch(
                  updateTask({
                    id: task.id,
                    priority: newPriority,
                  }),
                );
              }}
              disabled={!canEdit}
            />
          </div>
        )}

        {shows("type") && (
          <div className="flex items-start gap-2">
            <span className="text-sm text-muted-foreground w-20 shrink-0 pt-1">Type</span>
            <div className="flex flex-wrap gap-1.5">
              {TASK_TYPES.map((type) => {
                const isActive = (task.taskType || "task") === type.value;
                return (
                  <button
                    key={type.value}
                    type="button"
                    disabled={!canEdit}
                    onClick={() => {
                      if (isActive) return;
                      dispatch(optimisticUpdateTask({ id: task.id, taskType: type.value }));
                      void dispatch(updateTask({ id: task.id, taskType: type.value }));
                      const parentType = task.parentId
                        ? (allProjectTasks.find((t) => t.id === task.parentId)?.taskType ?? null)
                        : null;
                      const warning = getHierarchyRuleViolation(type.value, parentType);
                      if (warning) toast.warning(warning);
                    }}
                    className={cn(
                      "flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors disabled:cursor-not-allowed",
                      isActive
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                  >
                    <TaskTypeIcon type={type.value} size={12} />
                    {type.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground w-20 shrink-0">Parent</span>
          <div className="flex-1 min-w-0">
            <ParentPicker
              task={task}
              project={project}
              allTasks={allProjectTasks}
              onSelect={(parentId) => {
                const parentType = parentId
                  ? (allProjectTasks.find((t) => t.id === parentId)?.taskType ?? null)
                  : null;
                const warning = getHierarchyRuleViolation(task.taskType || "task", parentType);
                dispatch(optimisticUpdateTask({ id: task.id, parentId }));
                dispatch(updateTask({ id: task.id, parentId }));
                if (warning) toast.warning(warning);
              }}
              onNavigate={openTask}
              disabled={!canEdit}
            />
          </div>
        </div>

        {shows("assignees") && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground w-20">Assignee</span>
            <div className="flex-1 min-w-0">
              <AssigneeField
                assigneeIds={task.assigneeIds}
                onChange={(ids) => {
                  dispatch(
                    optimisticUpdateTask({
                      id: task.id,
                      assigneeIds: ids,
                    }),
                  );
                  dispatch(updateTask({ id: task.id, assigneeIds: ids }));
                }}
                disabled={!canEdit}
              />
            </div>
          </div>
        )}

        {shows("start_date") && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground w-20">Start</span>
            <div className="flex-1 min-w-0">
              <DatePicker
                value={task.startDate ?? ""}
                onChange={(v) => {
                  const next = v || null;
                  dispatch(
                    optimisticUpdateTask({
                      id: task.id,
                      startDate: next,
                    }),
                  );
                  dispatch(updateTask({ id: task.id, startDate: next }));
                }}
                disabled={!canEdit}
                placeholder="Set start date"
              />
            </div>
          </div>
        )}

        {shows("due_date") && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground w-20">Due</span>
            <div
              className={cn(
                "flex-1 min-w-0",
                !task.completedAt && task.dueDate && isOverdue(task.dueDate) && "text-destructive",
              )}
            >
              <DatePicker
                value={task.dueDate ?? ""}
                onChange={(v) => {
                  const next = v || null;
                  dispatch(
                    optimisticUpdateTask({
                      id: task.id,
                      dueDate: next,
                    }),
                  );
                  dispatch(updateTask({ id: task.id, dueDate: next }));
                }}
                disabled={!canEdit}
                placeholder="Set due date"
              />
            </div>
          </div>
        )}

        <div className="flex items-start gap-3">
          <span className="text-sm text-muted-foreground w-20 pt-0.5">Repeat</span>
          <div className="flex-1">
            <TaskRecurrenceSelector
              value={task.recurrenceRule}
              onChange={(val) =>
                dispatch(
                  updateTask({
                    id: task.id,
                    recurrenceRule: val,
                  }),
                )
              }
              disabled={!canEdit}
            />
          </div>
        </div>

        {shows("sprint") && sprints.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground w-20">Sprint</span>
            <SprintSelector
              sprints={sprints}
              currentSprintId={task.sprintId}
              onSelect={(sprintId) => {
                dispatch(optimisticUpdateTask({ id: task.id, sprintId }));
                dispatch(updateTask({ id: task.id, sprintId }));
              }}
              disabled={!canEdit}
            />
          </div>
        )}

        {shows("estimate") && (
          <TimeField
            label="Estimated"
            minutes={task.estimatedMinutes}
            onSave={(minutes) => {
              dispatch(
                optimisticUpdateTask({
                  id: task.id,
                  estimatedMinutes: minutes,
                }),
              );
              dispatch(updateTask({ id: task.id, estimatedMinutes: minutes }));
            }}
            disabled={!canEdit}
          />
        )}
        {/* Time spent is the sum of the task's worklogs, never typed. */}
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground w-20 flex items-center gap-1.5">
            <Clock size={12} />
            Time Spent
          </span>
          <span className="text-sm">
            {task.timeSpentMinutes ? formatMinutes(task.timeSpentMinutes) : "Not set"}
          </span>
          {subtaskTimeSpent > 0 && (
            <span className="text-xs text-subtle-foreground">
              {formatMinutes((task.timeSpentMinutes ?? 0) + subtaskTimeSpent)} incl. subtasks
            </span>
          )}
        </div>

        {task.estimatedMinutes != null && task.estimatedMinutes > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground w-20" />
            <div className="flex items-center gap-2 flex-1">
              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    !task.timeSpentMinutes
                      ? "bg-muted"
                      : task.timeSpentMinutes <= task.estimatedMinutes * 0.75
                        ? "bg-green-500"
                        : task.timeSpentMinutes <= task.estimatedMinutes
                          ? "bg-yellow-500"
                          : "bg-red-500",
                  )}
                  style={{
                    width: `${Math.min(100, ((task.timeSpentMinutes ?? 0) / task.estimatedMinutes) * 100)}%`,
                  }}
                />
              </div>
              <span
                className={cn(
                  "text-[10px] shrink-0",
                  task.timeSpentMinutes && task.timeSpentMinutes > task.estimatedMinutes
                    ? "text-red-500 font-medium"
                    : "text-muted-foreground",
                )}
              >
                {task.timeSpentMinutes
                  ? `${Math.round((task.timeSpentMinutes / task.estimatedMinutes) * 100)}%`
                  : "0%"}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
