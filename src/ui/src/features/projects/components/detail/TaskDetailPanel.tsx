/**
 * TaskDetailPanel - Right sidebar for task details
 *
 * Contains:
 * - Header with task number and close button
 * - Editable task title
 * - Status badge
 * - Fields section
 * - Description with markdown and @ mentions
 */

import { useState, useRef, useEffect, useMemo } from "react";
import { X, Repeat, Bell, Diamond, PencilSimple, Check } from "@phosphor-icons/react";
import { TASK_TYPES, getTaskTypeConfig } from "@/features/projects/utils/taskTypes";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import type { SerializedMemberInfo } from "@/features/admin";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ExpandableEditor } from "@/components/editor/ExpandableEditor";
import { MentionChipCompact } from "@/components/editor/plugins/mention";
import { selectTasksMap, selectCurrentProject, selectTasksForProject, optimisticUpdateTask } from "../../store/projectsSlice";
import { updateTask } from "../../store/projectsThunks";
import { closeDetailPanel, selectTask } from "../../store/projectsUiSlice";
import { selectSprintsForProject } from "../../store/sprintsSlice";
import type { SelectOption, Sprint } from "../../types";
import { SYSTEM_FIELD_IDS } from "../../types";

import { CommentsPanel } from "@/features/comments/components/CommentsPanel";
import { ContentType } from "@/gen/common/v1/common_pb";
import { useTaskPermission } from "@/features/projects/hooks/useProjectPermissions";
import { SubtasksList } from "./SubtasksList";
import { ActivityLog } from "./ActivityLog";
import { DependenciesList } from "./DependenciesList";

interface TaskDetailPanelProps {
  taskId: string;
}

export function TaskDetailPanel({ taskId }: TaskDetailPanelProps) {
  const dispatch = useAppDispatch();
  const task = useAppSelector((state) => selectTasksMap(state)[taskId]);
  const project = useAppSelector(selectCurrentProject);
  const projectId = project?.id;
  const allProjectTasks = useAppSelector(
    useMemo(
      () => (projectId ? selectTasksForProject(projectId) : () => []),
      [projectId]
    )
  );
  const blocksTaskIds = useMemo(
    () => allProjectTasks.filter((t) => t.blockedByTaskIds.includes(taskId)).map((t) => t.id),
    [allProjectTasks, taskId]
  );
  const members = useAppSelector((state) => state.admin.members) as SerializedMemberInfo[];
  const { canEdit } = useTaskPermission(taskId);
  const sprints = useAppSelector(selectSprintsForProject(project?.id ?? ""));

  const memberMap = useMemo(() => {
    const map: Record<string, SerializedMemberInfo> = {};
    for (const m of members) {
      map[m.userId] = m;
    }
    return map;
  }, [members]);

  const getInitials = (id: string) => {
    const member = memberMap[id];
    if (!member) return id.slice(-2).toUpperCase();
    const parts = member.displayName.split(" ").filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return member.displayName.slice(0, 2).toUpperCase();
  };

  const handleClose = () => {
    dispatch(closeDetailPanel());
    dispatch(selectTask(null));
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        handleClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

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
  const typeConfig = getTaskTypeConfig(task.taskType || "task");
  const TypeIcon = typeConfig.icon;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <TypeIcon size={14} className="text-muted-foreground" weight="fill" />
          <span
            className="text-sm font-mono text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={() => navigator.clipboard.writeText(ticketId)}
            title="Click to copy"
          >
            {ticketId}
          </span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleClose}>
          <X size={16} />
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Task Title (editable when permitted) */}
          <EditableTitle
            title={task.title}
            readOnly={!canEdit}
            onSave={(newTitle) => {
              dispatch(optimisticUpdateTask({ id: task.id, title: newTitle }));
              dispatch(updateTask({ id: task.id, title: newTitle }));
            }}
          />

          {/* Status Badge */}
          {statusOption && (
            <div className="flex items-center justify-between">
              <StatusBadge option={statusOption} />
              
              {/* Feature 15: Milestone Badge */}
              {task.isMilestone && (
                 <Badge variant="secondary" className="gap-1" style={{ color: 'var(--status-warning)', borderColor: 'color-mix(in srgb, var(--status-warning) 30%, transparent)', backgroundColor: 'color-mix(in srgb, var(--status-warning) 10%, transparent)' }}>
                    <Diamond weight="fill" />
                    Milestone
                 </Badge>
              )}
            </div>
          )}

          {/* Fields Section */}
          <div className="space-y-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Fields
            </h3>

            <div className="space-y-3">
              {/* Priority */}
              {priorityOption && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-20">Priority</span>
                  <Badge
                    variant="outline"
                    style={{
                      backgroundColor: `${priorityOption.color}15`,
                      borderColor: `${priorityOption.color}30`,
                      color: priorityOption.color,
                    }}
                  >
                    {priorityOption.label}
                  </Badge>
                </div>
              )}

              {/* Type */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground w-20 shrink-0">Type</span>
                <div className="flex flex-wrap gap-1.5">
                  {TASK_TYPES.map((type) => {
                    const TIcon = type.icon;
                    const isActive = (task.taskType || "task") === type.value;
                    return (
                      <button
                        key={type.value}
                        type="button"
                        onClick={() => {
                          dispatch(updateTask({ id: task.id, taskType: type.value }));
                        }}
                        className={cn(
                          "flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors",
                          isActive
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
                        )}
                      >
                        <TIcon size={12} weight={isActive ? "fill" : "regular"} />
                        {type.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Assignees */}
              {task.assigneeIds.length > 0 && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-20">Assignee</span>
                  <div className="flex -space-x-1">
                    {task.assigneeIds.map((id) => (
                      <div
                        key={id}
                        className="w-6 h-6 rounded-full bg-primary flex items-center justify-center text-xs text-primary-foreground border-2 border-card"
                        title={memberMap[id]?.displayName}
                      >
                        {getInitials(id)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Start Date */}
              {task.startDate && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-20">Start</span>
                  <span className="text-sm">{formatDate(task.startDate)}</span>
                </div>
              )}

              {/* Due Date */}
              {task.dueDate && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground w-20">Due</span>
                  <div className="flex items-center gap-2">
                    <span className={cn(
                      "text-sm",
                      isOverdue(task.dueDate) && "text-destructive"
                    )}>
                      {formatDate(task.dueDate)}
                    </span>
                    
                    {/* Feature 9: Recurrence Indicator */}
                    {task.recurrenceRule && (
                       <div className="flex items-center text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          <Repeat size={12} className="mr-1" />
                          Recurring
                       </div>
                    )}
                  </div>
                </div>
              )}
              
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

              {/* Feature 8: Reminder (Visual Only) */}
              <div className="flex items-center gap-3">
                 <span className="text-sm text-muted-foreground w-20">Remind me</span>
                 <Button variant="ghost" size="sm" className="h-6 px-2 text-xs text-muted-foreground">
                    <Bell size={12} className="mr-1" />
                    Set reminder
                 </Button>
              </div>
            </div>
          </div>
          
          {/* Feature 6: Dependencies */}
          <DependenciesList
            taskId={task.id}
            blockedByTaskIds={task.blockedByTaskIds}
            blocksTaskIds={blocksTaskIds}
          />

          {/* Feature 7: Subtasks */}
          <SubtasksList taskId={task.id} parentCompleted={!!task.completedAt} />

          {/* Description Section */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Description
            </h3>
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
              readonly={!canEdit}
            />
          </div>

          {/* References Section */}
          {task.outgoingReferences.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                References
              </h3>
              <div className="flex flex-wrap gap-2">
                {task.outgoingReferences.map((urn) => {
                  const mention = extractMentionsFromMarkdown(task.description).find((m) => m.urn === urn);
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
          
          {/* Comments (shared domain) */}
          <CommentsPanel contentType={ContentType.TASK} contentId={task.id} />

          {/* Activity Log (field changes, status updates, etc.) */}
          <ActivityLog taskId={task.id} />
        </div>
      </ScrollArea>
    </div>
  );
}

function EditableTitle({ title, onSave, readOnly }: { title: string; onSave: (newTitle: string) => void; readOnly?: boolean }) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep local value in sync when title changes from outside
  useEffect(() => {
    if (!isEditing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting local value when title prop changes externally
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
      <PencilSimple size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
    </div>
  );
}


interface StatusBadgeProps {
  option: SelectOption;
}

function StatusBadge({ option }: StatusBadgeProps) {
  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium"
      style={{
        backgroundColor: `${option.color}15`,
        border: `1px solid ${option.color}30`,
      }}
    >
      <div
        className="w-2 h-2 rounded-full"
        style={{ backgroundColor: option.color }}
      />
      <span style={{ color: option.color }}>{option.label}</span>
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
    closed: "text-muted-foreground/50",
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
            : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
        )}
      >
        {currentSprint ? currentSprint.name : "Backlog"}
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 z-50 mt-1 w-56 rounded-lg border border-border bg-card shadow-lg py-1 animate-in fade-in-0 zoom-in-95">
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
              !currentSprintId
                ? "bg-primary/10 text-primary"
                : "text-foreground hover:bg-muted"
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
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-muted"
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

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function isOverdue(dateStr: string): boolean {
  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return date < today;
}

function extractMentionsFromMarkdown(markdown: string): Array<{ label: string; urn: string }> {
  const mentionRegex = /\[\[\[([^|]+)\|([^\]]+)\]\]\]/g;
  const mentions: Array<{ label: string; urn: string }> = [];
  let match;
  while ((match = mentionRegex.exec(markdown)) !== null) {
    mentions.push({ label: match[1], urn: match[2] });
  }
  return mentions;
}

function extractFallbackLabel(urn: string): string {
  const parts = urn.split(":");
  const type = parts[3]?.toLowerCase() || "item";
  const id = parts[4]?.slice(0, 8) || "";
  return `${type}:${id}`;
}
