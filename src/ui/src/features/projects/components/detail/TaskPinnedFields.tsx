import { useCallback, useRef, useState, type ReactNode } from "react";
import { Check, Diamond, PushPin } from "@phosphor-icons/react";
import { toast } from "sonner";
import { ActionMenu, ActionMenuItem } from "@/components/ui/action-menu";
import { Badge } from "@/components/ui/badge";
import { DatePicker } from "@/components/ui/date-picker";
import { TaskTypeIcon } from "@/features/projects/components/TaskTypeIcon";
import { AssigneeField } from "@/features/projects/components/detail/fields/AssigneeField";
import {
  PriorityPicker,
  StatusPicker,
} from "@/features/projects/components/detail/fields/OptionPickers";
import { SprintSelector } from "@/features/projects/components/detail/fields/SprintSelector";
import { TimeField } from "@/features/projects/components/detail/fields/TimeField";
import { useTaskFieldUpdate } from "@/features/projects/hooks/useTaskFieldUpdate";
import type { Project, SelectOption, Sprint, Task } from "@/features/projects/types";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import {
  MAX_PINNED_TASK_FIELDS,
  PINNABLE_TASK_FIELDS,
  PINNABLE_TASK_FIELD_LABELS,
  type PinnableTaskField,
  togglePinnedField,
} from "@/features/projects/utils/pinnedFields";
import { TASK_TYPES, getHierarchyRuleViolation } from "@/features/projects/utils/taskTypes";
import { useAppDispatch } from "@/app/hooks";
import { useAppearanceSettings } from "@/features/settings/hooks/useSettings";
import {
  fetchEffectiveSettings,
  updateEffectiveSettingsLocal,
  updateSettings,
} from "@/features/settings/store/settingsSlice";
import { TagPicker } from "@/features/tags";
import { cn } from "@/shared/utils/cn";
import { isOverdue } from "@/shared/utils/dateFormatting";

interface TaskPinnedFieldsProps {
  task: Task;
  project: Project | null;
  allProjectTasks: Task[];
  sprints: Sprint[];
  canEdit: boolean;
}

const pinnedControlClass =
  "focus-ring inline-flex h-7 min-h-11 md:min-h-0 touch:min-h-11 items-center gap-2 rounded-md -mx-2 border-0 bg-transparent px-2 py-0 text-[13px] font-normal shadow-none transition-colors hover:bg-muted/50";

function Pin({ field, children }: { field: PinnableTaskField; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" data-testid={`task-pin-${field}`}>
      <span className="text-[11px] font-medium text-subtle-foreground">
        {PINNABLE_TASK_FIELD_LABELS[field]}
      </span>
      <div className="flex min-h-11 md:min-h-7 touch:min-h-11 items-center">{children}</div>
    </div>
  );
}

function TypePin({
  task,
  allProjectTasks,
  onChange,
  disabled,
}: {
  task: Task;
  allProjectTasks: Task[];
  onChange: (taskType: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = TASK_TYPES.find((type) => type.value === (task.taskType || "task"));
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        className={cn(pinnedControlClass, "text-foreground disabled:cursor-not-allowed")}
      >
        <TaskTypeIcon type={current?.value ?? "task"} size={14} />
        {current?.label ?? "Task"}
      </button>
      <ActionMenu
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        label="Task type"
        align="left"
      >
        {TASK_TYPES.map((type) => (
          <ActionMenuItem
            key={type.value}
            onClick={() => {
              setOpen(false);
              if (type.value === (task.taskType || "task")) return;
              onChange(type.value);
              const parentType = task.parentId
                ? (allProjectTasks.find((t) => t.id === task.parentId)?.taskType ?? null)
                : null;
              const warning = getHierarchyRuleViolation(type.value, parentType);
              if (warning) toast.warning(warning);
            }}
          >
            <TaskTypeIcon type={type.value} size={14} />
            <span className="flex-1">{type.label}</span>
            {type.value === (task.taskType || "task") && <Check size={14} weight="bold" />}
          </ActionMenuItem>
        ))}
      </ActionMenu>
    </>
  );
}

/** Serializes pin updates so quick toggles cannot save out of order. */
function usePinnedFieldsSave() {
  const dispatch = useAppDispatch();
  const inFlight = useRef(false);
  const queued = useRef<PinnableTaskField[] | null>(null);

  return useCallback(
    (next: PinnableTaskField[]) => {
      const appearance = { taskPinnedFields: next };
      dispatch(updateEffectiveSettingsLocal({ appearance }));
      queued.current = next;
      if (inFlight.current) return;
      inFlight.current = true;
      void (async () => {
        while (queued.current) {
          const taskPinnedFields = queued.current;
          queued.current = null;
          await dispatch(updateSettings({ appearance: { taskPinnedFields } }));
        }
        inFlight.current = false;
        await dispatch(fetchEffectiveSettings());
      })();
    },
    [dispatch],
  );
}

function PinMenu({ pinned }: { pinned: PinnableTaskField[] }) {
  const savePinned = usePinnedFieldsSave();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const full = pinned.length >= MAX_PINNED_TASK_FIELDS;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Choose pinned fields"
        title="Choose pinned fields"
        className="focus-ring mt-4 inline-flex size-8 shrink-0 touch:size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        data-testid="task-pin-menu"
      >
        <PushPin size={14} />
      </button>
      <ActionMenu
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        label={`Pinned fields (up to ${MAX_PINNED_TASK_FIELDS})`}
        align="right"
        className="w-56"
      >
        {PINNABLE_TASK_FIELDS.map((field) => {
          const isPinned = pinned.includes(field);
          return (
            <ActionMenuItem
              key={field}
              role="menuitemcheckbox"
              aria-checked={isPinned}
              disabled={!isPinned && full}
              onClick={() => savePinned(togglePinnedField(pinned, field))}
            >
              <span className="flex-1">{PINNABLE_TASK_FIELD_LABELS[field]}</span>
              {isPinned && <Check size={14} weight="bold" className="text-primary" />}
            </ActionMenuItem>
          );
        })}
      </ActionMenu>
    </>
  );
}

export function TaskPinnedFields({
  task,
  project,
  allProjectTasks,
  sprints,
  canEdit,
}: TaskPinnedFieldsProps) {
  const { taskPinnedFields } = useAppearanceSettings();
  const update = useTaskFieldUpdate(task.id);
  const statusField = project?.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.STATUS);
  const priorityField = project?.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.PRIORITY);
  const statusOption = statusField?.config.options?.find((o) => o.id === task.status);
  const priorityOption = priorityField?.config.options?.find((o) => o.id === task.priority);

  const render = (field: PinnableTaskField): ReactNode => {
    switch (field) {
      case "status":
        return statusOption && statusField ? (
          <StatusPicker
            appearance="plain"
            triggerClassName={pinnedControlClass}
            currentOption={statusOption}
            options={(statusField.config.options ?? []) as SelectOption[]}
            onSelect={(status) => update({ status })}
            disabled={!canEdit}
          />
        ) : null;
      case "priority":
        return priorityOption && priorityField ? (
          <PriorityPicker
            appearance="plain"
            triggerClassName={pinnedControlClass}
            currentOption={priorityOption}
            options={(priorityField.config.options ?? []) as SelectOption[]}
            onSelect={(priority) => update({ priority })}
            disabled={!canEdit}
          />
        ) : null;
      case "assignees":
        return (
          <AssigneeField
            triggerClassName={pinnedControlClass}
            task={task}
            assigneeIds={task.assigneeIds}
            onChange={(assigneeIds) => update({ assigneeIds })}
            disabled={!canEdit}
          />
        );
      case "due_date":
        return (
          <DatePicker
            size="sm"
            value={task.dueDate ?? ""}
            onChange={(value) => update({ dueDate: value || null })}
            disabled={!canEdit}
            placeholder="No due date"
            triggerClassName={cn(
              pinnedControlClass,
              !task.completedAt && task.dueDate && isOverdue(task.dueDate) && "text-destructive",
            )}
          />
        );
      case "start_date":
        return (
          <DatePicker
            size="sm"
            value={task.startDate ?? ""}
            onChange={(value) => update({ startDate: value || null })}
            disabled={!canEdit}
            placeholder="No start date"
            triggerClassName={pinnedControlClass}
          />
        );
      case "tags":
        return (
          <TagPicker
            triggerClassName={cn(pinnedControlClass, "mx-0 justify-center")}
            chipClassName={cn(pinnedControlClass, "mx-0")}
            selectedTagIds={task.tagIds}
            onChange={(tagIds) => update({ tagIds })}
            disabled={!canEdit}
            placeholder="Add a tag"
          />
        );
      case "type":
        return (
          <TypePin
            task={task}
            allProjectTasks={allProjectTasks}
            onChange={(taskType) => update({ taskType })}
            disabled={!canEdit}
          />
        );
      case "sprint":
        return sprints.length > 0 ? (
          <SprintSelector
            triggerClassName={pinnedControlClass}
            sprints={sprints}
            currentSprintId={task.sprintId}
            onSelect={(sprintId) => update({ sprintId })}
            disabled={!canEdit}
          />
        ) : null;
      case "estimate":
        return (
          <TimeField
            triggerClassName={pinnedControlClass}
            compact
            label="Estimate"
            minutes={task.estimatedMinutes}
            onSave={(estimatedMinutes) => update({ estimatedMinutes })}
            disabled={!canEdit}
          />
        );
    }
  };

  const pins = taskPinnedFields.flatMap((field) => {
    const control = render(field);
    return control ? [{ field, control }] : [];
  });

  return (
    <div className="flex items-start gap-2" data-testid="task-pinned-fields">
      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-7 gap-y-3">
        {pins.map(({ field, control }) => (
          <Pin key={field} field={field}>
            {control}
          </Pin>
        ))}
        {task.isMilestone && (
          <div className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-subtle-foreground">Milestone</span>
            <Badge
              variant="secondary"
              className={cn(pinnedControlClass, "self-start")}
              style={{
                color: "var(--status-warning)",
              }}
            >
              <Diamond weight="fill" />
              Milestone
            </Badge>
          </div>
        )}
        {pins.length === 0 && !task.isMilestone && (
          <span className="text-xs text-subtle-foreground">No pinned fields</span>
        )}
      </div>
      <PinMenu pinned={taskPinnedFields} />
    </div>
  );
}
