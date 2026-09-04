import { useState, useRef, useEffect, useMemo } from "react";
import {
  X,
  Diamond,
  PencilSimple,
  Check,
  SidebarSimple,
  Clock,
  Eye,
  EyeSlash,
  CaretRight,
} from "@phosphor-icons/react";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { toast } from "sonner";
import { TaskTypeIcon } from "@/features/projects/components/TaskTypeIcon";
import { TASK_TYPES, getHierarchyRuleViolation } from "@/features/projects/utils/taskTypes";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { isOverdue } from "@/shared/utils/dateFormatting";
import { SubjectAvatarStack, SubjectPicker } from "@/components/subject";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { popoverShellClass } from "@/components/ui/popover";
import { ExpandableEditor } from "@/components/editor/ExpandableEditor";
import { MentionChipCompact } from "@/components/mention";
import {
  selectTasksMap,
  selectCurrentProject,
  selectTasksForProject,
  optimisticUpdateTask,
} from "@/features/projects/store/projectsSlice";
import { updateTask } from "@/features/projects/store/projectsThunks";
import { closeDetailPanel, selectTask } from "@/features/projects/store/projectsUiSlice";
import { selectSprintsForProject } from "@/features/projects/store/sprintsSlice";
import { projectsApi } from "@/features/projects/api/projectsApi";
import { formatMinutes, parseTimeInput } from "@/features/projects/utils/timeFormatting";
import type { SelectOption, Sprint, Task } from "@/features/projects/types";
import { statusPaint } from "@/features/projects/utils/statusPaint";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";

import { CommentsPanel } from "@/features/comments/components/CommentsPanel";
import { extractMentionsFromMarkdown, extractFallbackLabel } from "@/shared/utils/mentionUtils";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { useTaskPermission } from "@/features/projects/hooks/useProjectPermissions";
import { TagPicker } from "@/features/tags";
import { SubtasksList } from "./SubtasksList";
import { TaskRecurrenceSelector } from "./TaskRecurrenceSelector";
import { ActivityLog } from "./ActivityLog";
import { DependenciesList } from "./DependenciesList";
import { ParentPicker } from "./ParentPicker";

interface TaskDetailPanelProps {
  taskId: string;
  variant?: "sidebar" | "modal";
}

export function TaskDetailPanel({ taskId, variant = "sidebar" }: TaskDetailPanelProps) {
  const dispatch = useAppDispatch();
  const { isMobileOrTablet } = useBreakpoint();
  const task = useAppSelector((state) => selectTasksMap(state)[taskId]);
  const project = useAppSelector(selectCurrentProject);
  const projectId = project?.id;
  const allProjectTasks = useAppSelector(
    useMemo(() => (projectId ? selectTasksForProject(projectId) : () => []), [projectId]),
  );
  const blocksTaskIds = useMemo(
    () => allProjectTasks.filter((t) => t.blockedByTaskIds.includes(taskId)).map((t) => t.id),
    [allProjectTasks, taskId],
  );
  const { canEdit } = useTaskPermission(taskId);
  const sprints = useAppSelector(selectSprintsForProject(project?.id ?? ""));

  const handleClose = () => {
    dispatch(closeDetailPanel());
    dispatch(selectTask(null));
  };

  useOverlayEscape(() => {
    // Escape inside a field cancels the field edit, not the whole panel.
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    handleClose();
  });

  // Build ancestor chain for breadcrumb navigation (must be before early return)
  const ancestorChain = useMemo(() => {
    if (!task?.parentId) return [];
    const chain: Array<{ id: string; title: string; number: number }> = [];
    const tasksMap: Record<string, Task> = {};
    for (const t of allProjectTasks) {
      tasksMap[t.id] = t;
    }
    let currentId: string | null = task.parentId;
    while (currentId && chain.length < 5) {
      const ancestor: Task | undefined = tasksMap[currentId];
      if (!ancestor) break;
      chain.unshift({ id: ancestor.id, title: ancestor.title, number: ancestor.number });
      currentId = ancestor.parentId;
    }
    return chain;
  }, [task, allProjectTasks]);

  if (!task) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Task not found
      </div>
    );
  }

  // Get status and priority options from project field definitions
  const statusField = project?.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.STATUS);
  const priorityField = project?.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.PRIORITY);

  const statusOption = statusField?.config.options?.find((o) => o.id === task.status);
  const priorityOption = priorityField?.config.options?.find((o) => o.id === task.priority);

  const ticketId = project ? `${project.slug}-${task.number}` : `#${task.number}`;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 md:px-4 py-2 md:py-3 border-b border-border">
        <div className="flex items-center gap-2">
          {isMobileOrTablet && (
            <button
              onClick={handleClose}
              className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Close panel"
            >
              <X size={16} weight="bold" />
            </button>
          )}
          <TaskTypeIcon type={task.taskType} className="text-muted-foreground" />
          <span
            className="text-sm font-mono text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={() => navigator.clipboard.writeText(ticketId)}
            title="Click to copy"
          >
            {ticketId}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <WatchButton taskId={task.id} />
          {!isMobileOrTablet && (
            <button
              onClick={handleClose}
              className="px-2 py-1 rounded-md text-primary bg-primary/10 transition-colors"
              aria-label="Close panel"
            >
              <SidebarSimple size={16} className="transform -scale-x-100" />
            </button>
          )}
        </div>
      </div>

      {/* Parent breadcrumbs */}
      {ancestorChain.length > 0 && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground px-4 pt-2 flex-wrap">
          {ancestorChain.map((ancestor, i) => (
            <span key={ancestor.id} className="flex items-center gap-1">
              {i > 0 && <CaretRight size={10} className="text-subtle-foreground" />}
              <button
                type="button"
                className="font-mono hover:text-foreground hover:underline transition-colors truncate max-w-[150px]"
                onClick={() => dispatch(selectTask(ancestor.id))}
                title={ancestor.title}
              >
                {project?.slug}-{ancestor.number}
              </button>
            </span>
          ))}
          <CaretRight size={10} className="text-subtle-foreground" />
          <span className="font-mono text-foreground font-medium">{ticketId}</span>
        </div>
      )}

      <ScrollArea className="flex-1 min-h-0">
        <div
          className={cn(
            "p-4",
            variant === "modal" ? "flex flex-col lg:flex-row gap-6 items-start" : "space-y-6",
          )}
        >
          {/* Left column - primary content in modal (title, description, comments); top of single column in sidebar */}
          <div
            className={cn(variant === "modal" ? "flex-1 min-w-0 w-full space-y-6" : "space-y-6")}
          >
            {/* Task Title (editable when permitted) */}
            <EditableTitle
              title={task.title}
              readOnly={!canEdit}
              onSave={(newTitle) => {
                dispatch(optimisticUpdateTask({ id: task.id, title: newTitle }));
                dispatch(updateTask({ id: task.id, title: newTitle }));
              }}
            />

            {/* Status (sidebar variant only - modal places status at the top of the metadata column) */}
            {variant !== "modal" && statusOption && statusField && (
              <div className="flex items-center justify-between">
                <StatusPicker
                  currentOption={statusOption}
                  options={(statusField.config.options ?? []) as SelectOption[]}
                  onSelect={(newStatus) => {
                    dispatch(
                      optimisticUpdateTask({
                        id: task.id,
                        status: newStatus,
                      }),
                    );
                    dispatch(updateTask({ id: task.id, status: newStatus }));
                  }}
                  disabled={!canEdit}
                />
                {task.isMilestone && (
                  <Badge
                    variant="secondary"
                    className="gap-1"
                    style={{
                      color: "var(--status-warning)",
                      borderColor: "color-mix(in srgb, var(--status-warning) 30%, transparent)",
                      backgroundColor: "color-mix(in srgb, var(--status-warning) 10%, transparent)",
                    }}
                  >
                    <Diamond weight="fill" />
                    Milestone
                  </Badge>
                )}
              </div>
            )}

            {/* Tags (sidebar variant only - modal places tags in the metadata column) */}
            {variant !== "modal" && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Tags
                </h3>
                <TagPicker
                  selectedTagIds={task.tagIds}
                  onChange={(nextTagIds) => {
                    dispatch(
                      optimisticUpdateTask({
                        id: task.id,
                        tagIds: nextTagIds,
                      }),
                    );
                    dispatch(updateTask({ id: task.id, tagIds: nextTagIds }));
                  }}
                  disabled={!canEdit}
                  placeholder="Add a tag"
                />
              </div>
            )}

            {/* Description - same click-to-open expandable widget the sidebar uses: chip placeholder when empty, full CrepeEditor in an overlay on click. Capped + scrollable preview keeps the modal compact regardless of description length; the Edit button rides the header row so it never overlaps the scrollbar. */}
            {variant === "modal" && (
              <ExpandableEditor
                contentType={ContentType.TASK}
                contentId={task.id}
                value={task.description}
                onChange={(newDesc) => {
                  dispatch(optimisticUpdateTask({ id: task.id, description: newDesc }));
                  dispatch(updateTask({ id: task.id, description: newDesc }));
                }}
                placeholder="Click to add a description... (type @ to mention)"
                label="Description"
                enableUpload
                fullPreview
                previewMaxHeight="400px"
                showHeader
                readonly={!canEdit}
              />
            )}

            {/* Comments (in modal mode, in left column) */}
            {variant === "modal" && (
              <div className="rounded-md border border-border [&>div]:h-auto">
                <CommentsPanel contentType={ContentType.TASK} contentId={task.id} />
              </div>
            )}
          </div>
          {/* end left column */}

          {/* Right column - metadata in modal (status, tags, fields, relationships, activity); continues in single column for sidebar */}
          <div
            className={cn(variant === "modal" ? "w-full lg:w-80 shrink-0 space-y-6" : "space-y-6")}
          >
            {/* Status (modal only - sidebar shows it in the left block) */}
            {variant === "modal" && statusOption && statusField && (
              <div className="flex items-center justify-between">
                <StatusPicker
                  currentOption={statusOption}
                  options={(statusField.config.options ?? []) as SelectOption[]}
                  onSelect={(newStatus) => {
                    dispatch(
                      optimisticUpdateTask({
                        id: task.id,
                        status: newStatus,
                      }),
                    );
                    dispatch(updateTask({ id: task.id, status: newStatus }));
                  }}
                  disabled={!canEdit}
                />
                {task.isMilestone && (
                  <Badge
                    variant="secondary"
                    className="gap-1"
                    style={{
                      color: "var(--status-warning)",
                      borderColor: "color-mix(in srgb, var(--status-warning) 30%, transparent)",
                      backgroundColor: "color-mix(in srgb, var(--status-warning) 10%, transparent)",
                    }}
                  >
                    <Diamond weight="fill" />
                    Milestone
                  </Badge>
                )}
              </div>
            )}

            {/* Tags (modal only - sidebar shows them in the left block) */}
            {variant === "modal" && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Tags
                </h3>
                <TagPicker
                  selectedTagIds={task.tagIds}
                  onChange={(nextTagIds) => {
                    dispatch(
                      optimisticUpdateTask({
                        id: task.id,
                        tagIds: nextTagIds,
                      }),
                    );
                    dispatch(updateTask({ id: task.id, tagIds: nextTagIds }));
                  }}
                  disabled={!canEdit}
                  placeholder="Add a tag"
                />
              </div>
            )}

            {/* Fields Section */}
            <div className="space-y-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Fields
              </h3>

              <div className="space-y-3">
                {/* Priority */}
                {priorityOption && priorityField && (
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

                {/* Type */}
                <div className="flex items-start gap-2">
                  <span className="text-sm text-muted-foreground w-20 shrink-0 pt-1">Type</span>
                  <div className="flex flex-wrap gap-1.5">
                    {TASK_TYPES.map((type) => {
                      const isActive = (task.taskType || "task") === type.value;
                      return (
                        <button
                          key={type.value}
                          type="button"
                          onClick={() => {
                            dispatch(
                              updateTask({
                                id: task.id,
                                taskType: type.value,
                              }),
                            );
                            const parentType = task.parentId
                              ? (allProjectTasks.find((t) => t.id === task.parentId)?.taskType ??
                                null)
                              : null;
                            const warning = getHierarchyRuleViolation(type.value, parentType);
                            if (warning) toast.warning(warning);
                          }}
                          className={cn(
                            "flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors",
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

                {/* Parent */}
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
                        const warning = getHierarchyRuleViolation(
                          task.taskType || "task",
                          parentType,
                        );
                        dispatch(optimisticUpdateTask({ id: task.id, parentId }));
                        dispatch(updateTask({ id: task.id, parentId }));
                        if (warning) toast.warning(warning);
                      }}
                      onNavigate={(id) => dispatch(selectTask(id))}
                      disabled={!canEdit}
                    />
                  </div>
                </div>

                {/* Assignees */}
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

                {/* Start Date */}
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

                {/* Due Date */}
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-20">Due</span>
                  <div
                    className={cn(
                      "flex-1 min-w-0",
                      task.dueDate && isOverdue(task.dueDate) && "text-destructive",
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

                {/* Recurrence */}
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

                {/* Sprint */}
                {sprints.length > 0 && (
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground w-20">Sprint</span>
                    <SprintSelector
                      sprints={sprints}
                      currentSprintId={task.sprintId}
                      onSelect={(sprintId) => {
                        dispatch(optimisticUpdateTask({ id: task.id, sprintId }));
                        dispatch(updateTask({ id: task.id, sprintId }));
                      }}
                    />
                  </div>
                )}

                {/* Time Tracking */}
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
                />
                <TimeField
                  label="Time Spent"
                  minutes={task.timeSpentMinutes}
                  onSave={(minutes) => {
                    dispatch(
                      optimisticUpdateTask({
                        id: task.id,
                        timeSpentMinutes: minutes,
                      }),
                    );
                    dispatch(updateTask({ id: task.id, timeSpentMinutes: minutes }));
                  }}
                />

                {/* Time Progress Bar */}
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

            {/* Dependencies (Blocked By + Blocks) */}
            <DependenciesList
              taskId={task.id}
              blockedByTaskIds={task.blockedByTaskIds}
              blocksTaskIds={blocksTaskIds}
            />

            {/* Subtasks */}
            <SubtasksList taskId={task.id} parentCompleted={!!task.completedAt} />

            {/* References (modal only - sidebar shows them in the sidebar-only block below) */}
            {variant === "modal" && task.outgoingReferences.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  References
                </h3>
                <div className="flex flex-wrap gap-2">
                  {task.outgoingReferences.map((urn) => {
                    const mention = extractMentionsFromMarkdown(task.description).find(
                      (m) => m.urn === urn,
                    );
                    return (
                      <MentionChipCompact
                        key={urn}
                        urn={urn}
                        label={mention?.label || extractFallbackLabel(urn)}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            {/* Activity log (modal only - collapses to the most recent entries with a "Show more" toggle to keep the metadata column scannable) */}
            {variant === "modal" && <ActivityLog taskId={task.id} maxInitialItems={5} />}
          </div>
          {/* end right column (or contents for sidebar) */}

          {/* The following sections are shown in sidebar mode only - in modal mode they're in the left column */}
          {variant === "sidebar" && (
            <>
              {/* Description - same expandable widget the modal uses: capped, scrollable preview with the Edit button on the header row, full CrepeEditor on click. */}
              <ExpandableEditor
                contentType={ContentType.TASK}
                contentId={task.id}
                value={task.description}
                onChange={(newDesc) => {
                  dispatch(optimisticUpdateTask({ id: task.id, description: newDesc }));
                  dispatch(updateTask({ id: task.id, description: newDesc }));
                }}
                placeholder="Click to add a description... (type @ to mention)"
                label="Description"
                enableUpload
                fullPreview
                previewMaxHeight="400px"
                showHeader
                readonly={!canEdit}
              />

              {/* References Section */}
              {task.outgoingReferences.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    References
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {task.outgoingReferences.map((urn) => {
                      const mention = extractMentionsFromMarkdown(task.description).find(
                        (m) => m.urn === urn,
                      );
                      return (
                        <MentionChipCompact
                          key={urn}
                          urn={urn}
                          label={mention?.label || extractFallbackLabel(urn)}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Comments */}
              <CommentsPanel contentType={ContentType.TASK} contentId={task.id} />

              {/* Activity Log */}
              <ActivityLog taskId={task.id} maxInitialItems={5} />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function EditableTitle({
  title,
  onSave,
  readOnly,
}: {
  title: string;
  onSave: (newTitle: string) => void;
  readOnly?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep local value in sync when title changes from outside
  useEffect(() => {
    if (!isEditing) {
      // Resync the draft when the title changes externally, but never mid-edit.
      // eslint-disable-next-line react/react-compiler
      setValue(title);
    }
  }, [title, isEditing]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== title) {
      onSave(trimmed);
    } else {
      setValue(title);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setValue(title);
      setIsEditing(false);
    }
  };

  if (isEditing && !readOnly) {
    return (
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className="flex-1 text-lg font-semibold bg-background border border-primary rounded px-2 py-1 outline-none text-foreground"
        />
      </div>
    );
  }

  if (readOnly) {
    return (
      <div className="px-2 py-1 -mx-2">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
    );
  }

  return (
    <div
      className="group flex items-center gap-2 cursor-pointer rounded px-2 py-1 -mx-2 hover:bg-muted/50 transition-colors"
      onClick={() => setIsEditing(true)}
    >
      <h2 className="text-lg font-semibold text-foreground flex-1">{title}</h2>
      <PencilSimple
        size={14}
        className="text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 transition-opacity"
      />
    </div>
  );
}

interface AssigneeFieldProps {
  assigneeIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

function AssigneeField({ assigneeIds, onChange, disabled }: AssigneeFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setIsOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1 -mx-2 text-sm transition-colors",
          disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-muted/50",
        )}
      >
        {assigneeIds.length > 0 ? (
          <SubjectAvatarStack subjectIds={assigneeIds} />
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        )}
      </button>
      {isOpen && (
        <SubjectPicker
          mode="multi"
          subjectTypes="all"
          value={assigneeIds}
          onChange={(ids) => onChange(ids)}
          portal
          anchorRef={triggerRef}
          onClose={() => setIsOpen(false)}
          autoFocus
        />
      )}
    </>
  );
}

interface OptionDropdownProps {
  options: SelectOption[];
  currentId: string;
  onSelect: (optionId: string) => void;
  onClose: () => void;
  /** Overrides the stored option colour for the swatch (statuses derive theirs from order). */
  swatch?: (option: SelectOption) => string;
}

function OptionDropdown({ options, currentId, onSelect, onClose, swatch }: OptionDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  return (
    <div
      ref={dropdownRef}
      className={cn(
        popoverShellClass,
        "absolute top-full left-0 z-50 mt-1 min-w-40 py-1 max-h-60 overflow-y-auto",
      )}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => {
            onSelect(option.id);
            onClose();
          }}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors",
            option.id === currentId
              ? "bg-primary/10 text-primary"
              : "text-foreground hover:bg-muted",
          )}
        >
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ background: swatch ? swatch(option) : option.color }}
          />
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface StatusPickerProps {
  currentOption: SelectOption;
  options: SelectOption[];
  onSelect: (optionId: string) => void;
  disabled?: boolean;
}

function StatusPicker({ currentOption, options, onSelect, disabled }: StatusPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const paint = statusPaint(options, currentOption.id);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen((v) => !v)}
        disabled={disabled}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
        style={{
          backgroundColor: paint.translucent,
          border: `1px solid ${paint.translucent}`,
        }}
      >
        <div className="w-2 h-2 rounded-full" style={{ background: paint.gradient }} />
        <span style={{ color: paint.solid }}>{currentOption.label}</span>
      </button>
      {isOpen && (
        <OptionDropdown
          options={options}
          swatch={(o) => statusPaint(options, o.id).gradient}
          currentId={currentOption.id}
          onSelect={onSelect}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}

interface PriorityPickerProps {
  currentOption: SelectOption;
  options: SelectOption[];
  onSelect: (optionId: string) => void;
  disabled?: boolean;
}

function PriorityPicker({ currentOption, options, onSelect, disabled }: PriorityPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => !disabled && setIsOpen((v) => !v)}
        disabled={disabled}
        className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold border transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-60"
        style={{
          backgroundColor: `${currentOption.color}15`,
          borderColor: `${currentOption.color}30`,
          color: currentOption.color,
        }}
      >
        {currentOption.label}
      </button>
      {isOpen && (
        <OptionDropdown
          options={options}
          currentId={currentOption.id}
          onSelect={onSelect}
          onClose={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}

interface SprintSelectorProps {
  sprints: Sprint[];
  currentSprintId: string | null;
  onSelect: (sprintId: string | null) => void;
}

function SprintSelector({ sprints, currentSprintId, onSelect }: SprintSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const currentSprint = sprints.find((s) => s.id === currentSprintId);
  const activeSprints = sprints.filter((s) => s.status !== "closed");

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const statusColors: Record<string, string> = {
    active: "text-green-600",
    planned: "text-muted-foreground",
    closed: "text-subtle-foreground",
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1 rounded text-sm border transition-colors",
          currentSprint
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
        )}
      >
        {currentSprint ? currentSprint.name : "Backlog"}
      </button>

      {isOpen && (
        <div
          className={cn(
            popoverShellClass,
            "absolute top-full left-0 z-50 mt-1 w-56 py-1 animate-in fade-in-0 zoom-in-95",
          )}
        >
          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Move to
          </div>
          {/* Backlog option */}
          <button
            type="button"
            onClick={() => {
              onSelect(null);
              setIsOpen(false);
            }}
            className={cn(
              "flex w-full items-center justify-between px-3 py-1.5 text-sm transition-colors",
              !currentSprintId ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
            )}
          >
            <span>Backlog</span>
            {!currentSprintId && <Check size={14} weight="bold" />}
          </button>
          {/* Sprint options */}
          {activeSprints.map((sprint) => {
            const isActive = sprint.id === currentSprintId;
            return (
              <button
                key={sprint.id}
                type="button"
                onClick={() => {
                  onSelect(sprint.id);
                  setIsOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-1.5 text-sm transition-colors",
                  isActive ? "bg-primary/10 text-primary" : "text-foreground hover:bg-muted",
                )}
              >
                <div className="flex items-center gap-2">
                  <span>{sprint.name}</span>
                  <span className={cn("text-xs", statusColors[sprint.status])}>
                    {sprint.status}
                  </span>
                </div>
                {isActive && <Check size={14} weight="bold" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface TimeFieldProps {
  label: string;
  minutes: number | null;
  onSave: (minutes: number | null) => void;
}

function TimeField({ label, minutes, onSave }: TimeFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleStartEdit = () => {
    setInputValue(minutes ? formatMinutes(minutes) : "");
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSave = () => {
    setIsEditing(false);
    const parsed = parseTimeInput(inputValue);
    if (parsed !== null || inputValue.trim() === "") {
      onSave(parsed);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-muted-foreground w-20 flex items-center gap-1.5">
        <Clock size={12} />
        {label}
      </span>
      {isEditing ? (
        <Input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") setIsEditing(false);
          }}
          placeholder="e.g. 2h 30m"
          className="h-6 w-24 px-2 text-xs"
        />
      ) : (
        <button
          onClick={handleStartEdit}
          className="text-xs text-foreground hover:text-primary transition-colors"
        >
          {minutes ? formatMinutes(minutes) : "Not set"}
        </button>
      )}
    </div>
  );
}

function WatchButton({ taskId }: { taskId: string }) {
  const [isWatching, setIsWatching] = useState(false);
  const [watcherCount, setWatcherCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const orgId = useAppSelector((state) => state.auth.currentOrganizationId);

  useEffect(() => {
    if (!orgId) return;
    projectsApi.listTaskWatchers(taskId, orgId).then((res) => {
      setWatcherCount(res.watcherCount);
    });
    projectsApi.bulkCheckTaskWatchers([taskId], orgId).then((res) => {
      setIsWatching(res.watchedTasks[taskId] ?? false);
    });
  }, [taskId, orgId]);

  const handleToggle = async () => {
    if (!orgId || isLoading) return;
    setIsLoading(true);
    try {
      const res = await projectsApi.toggleTaskWatcher(taskId, orgId);
      setIsWatching(res.isWatching);
      setWatcherCount((c) => c + (res.isWatching ? 1 : -1));
    } finally {
      setIsLoading(false);
    }
  };

  const WatchIcon = isWatching ? Eye : EyeSlash;

  return (
    <button
      onClick={handleToggle}
      disabled={isLoading}
      className={cn(
        "flex items-center gap-1 px-2 py-1 rounded-md text-xs transition-colors",
        isWatching
          ? "text-primary bg-primary/10"
          : "text-muted-foreground hover:text-foreground hover:bg-muted",
      )}
      title={isWatching ? "Stop watching" : "Watch this task"}
    >
      <WatchIcon size={14} weight={isWatching ? "fill" : "regular"} />
      {watcherCount > 0 && <span>{watcherCount}</span>}
    </button>
  );
}
