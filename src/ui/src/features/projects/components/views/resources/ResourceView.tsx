/**
 * ResourceView - Tasks grouped by assignee with workload stats.
 *
 * Shows each team member's assigned tasks with a summary header
 * (task count, estimated/spent time). Sections are collapsible.
 * An "Unassigned" section collects tasks without assignees.
 */

import { useState, useMemo, useCallback } from "react";
import { CaretDown, CaretRight, User, CalendarBlank, Clock } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SubjectAvatar } from "@/components/subject";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import { selectCurrentProject } from "@/features/projects/store/projectsSlice";
import { selectTask, openDetailPanel } from "@/features/projects/store/projectsUiSlice";
import { useFilteredTasks } from "@/features/projects/hooks/useTasks";
import { formatMinutes } from "@/features/projects/utils/timeFormatting";
import { formatDateShort, isOverdue } from "@/shared/utils/dateFormatting";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { Task, SelectOption } from "@/features/projects/types";
import type { Subject } from "@/components/subject/types";

interface AssigneeGroup {
  assigneeId: string | null;
  tasks: Task[];
  totalEstimated: number;
  totalSpent: number;
}

export function ResourceView() {
  const dispatch = useAppDispatch();
  const project = useAppSelector(selectCurrentProject);
  const tasks = useFilteredTasks(project?.id ?? "");
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  // Collect all unique assignee IDs
  const allAssigneeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const task of tasks) {
      for (const id of task.assigneeIds) {
        ids.add(id);
      }
    }
    return [...ids];
  }, [tasks]);

  // Resolve assignee IDs to subjects
  const { subjects } = useSubjectResolver(allAssigneeIds);
  const subjectMap = useMemo(() => {
    const map: Record<string, Subject> = {};
    for (const s of subjects) {
      map[s.id] = s;
    }
    return map;
  }, [subjects]);

  // Group tasks by assignee
  const groups = useMemo((): AssigneeGroup[] => {
    const byAssignee: Record<string, Task[]> = {};
    const unassigned: Task[] = [];

    for (const task of tasks) {
      if (task.assigneeIds.length === 0) {
        unassigned.push(task);
      } else {
        for (const assigneeId of task.assigneeIds) {
          if (!byAssignee[assigneeId]) byAssignee[assigneeId] = [];
          byAssignee[assigneeId].push(task);
        }
      }
    }

    const assigneeGroups: AssigneeGroup[] = Object.entries(byAssignee)
      .map(([assigneeId, groupTasks]) => ({
        assigneeId,
        tasks: groupTasks,
        totalEstimated: groupTasks.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0),
        totalSpent: groupTasks.reduce((s, t) => s + (t.timeSpentMinutes ?? 0), 0),
      }))
      .sort((a, b) => b.tasks.length - a.tasks.length); // Busiest first

    if (unassigned.length > 0) {
      assigneeGroups.push({
        assigneeId: null,
        tasks: unassigned,
        totalEstimated: unassigned.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0),
        totalSpent: unassigned.reduce((s, t) => s + (t.timeSpentMinutes ?? 0), 0),
      });
    }

    return assigneeGroups;
  }, [tasks]);

  // Status options for badges
  const statusOptions = useMemo(() => {
    const field = project?.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.STATUS);
    const map: Record<string, SelectOption> = {};
    for (const opt of field?.config.options ?? []) {
      map[opt.id] = opt;
    }
    return map;
  }, [project]);

  const priorityOptions = useMemo(() => {
    const field = project?.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.PRIORITY);
    const map: Record<string, SelectOption> = {};
    for (const opt of field?.config.options ?? []) {
      map[opt.id] = opt;
    }
    return map;
  }, [project]);

  const toggleSection = useCallback((key: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleTaskClick = useCallback((taskId: string) => {
    dispatch(selectTask(taskId));
    dispatch(openDetailPanel());
  }, [dispatch]);

  if (!project) return null;

  if (tasks.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8">
        <User size={48} className="text-muted-foreground/30 mb-4" />
        <p className="text-sm text-muted-foreground">
          No tasks to display. Create tasks and assign them to team members.
        </p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="divide-y divide-border">
        {groups.map((group) => {
          const key = group.assigneeId ?? "__unassigned__";
          const isCollapsed = collapsedSections.has(key);
          const subject = group.assigneeId ? subjectMap[group.assigneeId] : null;

          return (
            <div key={key}>
              {/* Section header */}
              <button
                type="button"
                onClick={() => toggleSection(key)}
                className="w-full flex items-center gap-3 px-4 py-2.5 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
              >
                {isCollapsed
                  ? <CaretRight size={14} className="text-muted-foreground shrink-0" />
                  : <CaretDown size={14} className="text-muted-foreground shrink-0" />
                }

                {subject ? (
                  <SubjectAvatar subject={subject} size="sm" />
                ) : (
                  <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0">
                    <User size={12} className="text-muted-foreground" />
                  </div>
                )}

                <span className="text-sm font-medium text-foreground">
                  {subject?.name ?? "Unassigned"}
                </span>

                <span className="text-xs text-muted-foreground">
                  {group.tasks.length} task{group.tasks.length !== 1 ? "s" : ""}
                </span>

                {group.totalEstimated > 0 && (
                  <span className={cn(
                    "text-xs shrink-0 ml-auto",
                    group.totalSpent > group.totalEstimated
                      ? "text-red-500"
                      : "text-muted-foreground"
                  )}>
                    <Clock size={10} className="inline mr-0.5" />
                    {formatMinutes(group.totalSpent)} / {formatMinutes(group.totalEstimated)}
                  </span>
                )}
              </button>

              {/* Task rows */}
              {!isCollapsed && (
                <div>
                  {group.tasks.map((task) => {
                    const status = statusOptions[task.status];
                    const priority = priorityOptions[task.priority];
                    const taskOverdue = task.dueDate ? isOverdue(task.dueDate) : false;

                    return (
                      <div
                        key={`${key}-${task.id}`}
                        className="flex items-center gap-3 px-4 pl-12 py-2 border-b border-border/50 hover:bg-muted/20 cursor-pointer transition-colors"
                        onClick={() => handleTaskClick(task.id)}
                      >
                        {/* Status dot */}
                        {status && (
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: status.color }}
                            title={status.label}
                          />
                        )}

                        {/* Title */}
                        <span className={cn(
                          "text-sm flex-1 truncate",
                          task.completedAt && "text-muted-foreground line-through"
                        )}>
                          {task.title}
                        </span>

                        {/* Priority */}
                        {priority && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0"
                            style={{
                              backgroundColor: `${priority.color}15`,
                              color: priority.color,
                            }}
                          >
                            {priority.label}
                          </span>
                        )}

                        {/* Due date */}
                        {task.dueDate && (
                          <span className={cn(
                            "flex items-center gap-1 text-xs shrink-0",
                            taskOverdue ? "text-red-500" : "text-muted-foreground"
                          )}>
                            <CalendarBlank size={10} />
                            {formatDateShort(task.dueDate)}
                          </span>
                        )}

                        {/* Time */}
                        {(task.estimatedMinutes || task.timeSpentMinutes) && (
                          <span className={cn(
                            "text-[10px] shrink-0",
                            task.estimatedMinutes && task.timeSpentMinutes && task.timeSpentMinutes > task.estimatedMinutes
                              ? "text-red-500"
                              : "text-muted-foreground"
                          )}>
                            <Clock size={10} className="inline mr-0.5" />
                            {task.timeSpentMinutes ? formatMinutes(task.timeSpentMinutes) : "0m"}
                            {task.estimatedMinutes ? ` / ${formatMinutes(task.estimatedMinutes)}` : ""}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
