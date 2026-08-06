import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from "react-native";
import {
  DotsThree,
  Check,
  CaretRight,
  Warning,
  ArrowsClockwise,
  Eye,
  EyeSlash,
} from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { DomainHeader } from "@shared/components/DomainHeader";
import { ScreenError } from "@shared/components/ScreenError";
import { MarkdownRenderer } from "@shared/components/MarkdownRenderer";
import { CommentButton } from "@shared/comments/CommentsSheet";
import { ShareButton } from "@shared/permissions/ShareSheet";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { ActionSheet } from "@shared/components/ActionSheet";
import { Avatar } from "@shared/components/Avatar";
import { SubjectAvatarStack } from "@shared/directory/SubjectAvatarStack";
import { SubjectPickerSheet } from "@shared/directory/SubjectPickerSheet";
import { useDirectory } from "@shared/directory/useDirectory";
import { confirmDestructive } from "@shared/lib/confirmDestructive";
import { useAuth } from "@core/providers/AuthContext";
import { CalendarPicker } from "@features/calendar/components/CalendarPicker";
import { TagPickerSheet } from "@features/tags/components/TagPickerSheet";
import { OptionPickerSheet } from "@features/projects/components/OptionPickerSheet";
import { TaskTypePickerSheet } from "@features/projects/components/TaskTypePickerSheet";
import { SprintPickerSheet } from "@features/projects/components/SprintPickerSheet";
import { TaskPickerSheet } from "@features/projects/components/TaskPickerSheet";
import { TimeInputSheet } from "@features/projects/components/TimeInputSheet";
import { TaskPriorityBadge } from "@features/projects/components/TaskPriorityBadge";
import { RecurrenceSheet } from "@features/projects/components/RecurrenceSheet";
import { getTaskTypeConfig, getHierarchyRuleViolation } from "@features/projects/taskTypes";
import { formatMinutes } from "@features/projects/timeFormatting";
import { formatRelativeTime } from "@shared/lib/dateFormatting";
import { parseRecurrence, describeRecurrence } from "@features/projects/taskRecurrence";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import {
  useTask,
  useProject,
  useProjectTasks,
  useProjectSprints,
  useTaskActivities,
  useTaskWatchers,
} from "@features/projects/useProjects";
import {
  useUpdateTask,
  useDeleteTask,
  useToggleTaskWatcher,
} from "@features/projects/useProjectMutations";
import {
  getStatusOptions,
  getPriorityOptions,
  getOptionById,
  activityActionLabel,
  DONE_STATUS_ID,
  TODO_STATUS_ID,
} from "@features/projects/projectsSerializer";
import type { SerializedTask } from "@features/projects/projectsSerializer";

type EditableField = "status" | "priority" | null;
type DetailSheet =
  "type" | "sprint" | "parent" | "estimate" | "spent" | "tags" | "blockers" | "repeat" | null;

/** Every task under `rootId`, plus `rootId` itself. */
function collectDescendantIds(tasks: SerializedTask[], rootId: string): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const task of tasks) {
    if (!task.parentId) continue;
    const siblings = childrenOf.get(task.parentId);
    if (siblings) siblings.push(task.id);
    else childrenOf.set(task.parentId, [task.id]);
  }

  const ids = [rootId];
  const seen = new Set(ids);
  for (let i = 0; i < ids.length; i++) {
    for (const childId of childrenOf.get(ids[i]) ?? []) {
      if (seen.has(childId)) continue;
      seen.add(childId);
      ids.push(childId);
    }
  }
  return ids;
}

export function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const T = useTheme();
  const insets = useSafeAreaInsets();

  const taskQuery = useTask(id);
  const task = taskQuery.data;
  const projectQuery = useProject(task?.projectId);
  const project = projectQuery.data;
  const tasksQuery = useProjectTasks(task?.projectId);
  const allTasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const activitiesQuery = useTaskActivities(id);
  const activities = activitiesQuery.data ?? [];
  const sprintsQuery = useProjectSprints(task?.projectId);
  const sprints = sprintsQuery.data ?? [];
  const directory = useDirectory();
  const { user } = useAuth();
  const currentUserId = user?.id;
  const watchersQuery = useTaskWatchers(id);
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const toggleWatcher = useToggleTaskWatcher();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<EditableField>(null);
  const [assigneesOpen, setAssigneesOpen] = useState(false);
  const [sheet, setSheet] = useState<DetailSheet>(null);

  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  // Re-parenting onto a descendant would create a cycle, so the whole subtree
  // is off-limits as a parent - not just the task itself. Memoised above the
  // early returns: this runs on every keystroke in the title field otherwise.
  const taskId = task?.id;
  const descendantIds = useMemo(
    () => (taskId ? collectDescendantIds(allTasks, taskId) : []),
    [allTasks, taskId],
  );

  if (taskQuery.isLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer, { backgroundColor: T.pageBg }]}>
        <ActivityIndicator size="large" color={T.accent} />
      </View>
    );
  }

  if (!task) {
    return (
      <ScreenError
        title="Task"
        icon="projects"
        color={T.accent}
        onRetry={() => taskQuery.refetch()}
      />
    );
  }

  const watcherIds = watchersQuery.data?.watcherIds ?? [];
  const isWatching = !!currentUserId && watcherIds.includes(currentUserId);
  const recurrence = parseRecurrence(task.recurrenceRule);

  const statusOptions = project ? getStatusOptions(project) : [];
  const priorityOptions = project ? getPriorityOptions(project) : [];
  const statusOpt = getOptionById(statusOptions, task.status);
  const priorityOpt = getOptionById(priorityOptions, task.priority);
  const projectColor = project?.color || T.accent;

  const subtasks = allTasks.filter((t) => t.parentId === task.id);
  const subtasksDone = subtasks.filter((t) => t.completedAt).length;

  const blockers = task.blockedByTaskIds
    .map((blockId) => allTasks.find((t) => t.id === blockId))
    .filter(Boolean) as SerializedTask[];

  const typeConfig = getTaskTypeConfig(task.taskType);
  const TypeIcon = typeConfig.Icon;
  const currentSprint = sprints.find((s) => s.id === task.sprintId);
  const parentTask = allTasks.find((t) => t.id === task.parentId);
  const hierarchyWarning = getHierarchyRuleViolation(task.taskType, parentTask?.taskType ?? null);
  const overBudget =
    !!task.estimatedMinutes &&
    !!task.timeSpentMinutes &&
    task.timeSpentMinutes > task.estimatedMinutes;

  function toggleSubtask(sub: SerializedTask) {
    const isNowDone = !sub.completedAt;
    // The canonical ids, not the ends of the list: a project can add a status
    // after Done or reorder one in front of To Do, and ticking a box would then
    // write a status the server never treats as completion.
    updateTask.mutate({
      taskId: sub.id,
      projectId: task!.projectId,
      status: isNowDone ? DONE_STATUS_ID : TODO_STATUS_ID,
    });
  }

  // Activity rows store raw ids - option ids for status/priority changes, user
  // ids for assignment changes. Show whichever label we can resolve.
  function resolveActivityValue(raw: string): string {
    const option = getOptionById([...statusOptions, ...priorityOptions], raw);
    if (option) return option.label;
    return directory.byId.get(raw)?.name ?? raw;
  }

  function toggleAssignee(userId: string) {
    const current = task!.assigneeIds;
    patch({
      assigneeIds: current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    });
  }

  type TaskPatch = Omit<Parameters<typeof updateTask.mutate>[0], "taskId" | "projectId">;
  function patch(changes: TaskPatch) {
    updateTask.mutate({ taskId: task!.id, projectId: task!.projectId, ...changes });
  }

  function toggleBlocker(blockerId: string | null) {
    if (!blockerId) return;
    const current = task!.blockedByTaskIds;
    patch({
      blockedByTaskIds: current.includes(blockerId)
        ? current.filter((id) => id !== blockerId)
        : [...current, blockerId],
    });
  }

  function toggleTag(tagId: string) {
    const current = task!.tags.map((t) => t.id);
    patch({
      tagIds: current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    });
  }

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={project?.name ?? "Projects"}
        color={projectColor}
        icon="projects"
        rightActions={
          <>
            <CommentButton contentType={ContentType.TASK} contentId={task.id} color={T.accent} />
            <ShareButton contentType={ContentType.TASK} contentId={task.id} color={T.accent} />
            <TouchableOpacity
              onPress={() => toggleWatcher.mutate(task.id)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {isWatching ? (
                <Eye size={20} color={T.accent} weight="fill" />
              ) : (
                <EyeSlash size={20} color={T.text} weight="regular" />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setSheetOpen(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <DotsThree size={22} color={T.text} weight="bold" />
            </TouchableOpacity>
          </>
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: bottomPad, gap: 20 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.badges}>
          {statusOpt && (
            <View style={[styles.badge, { backgroundColor: statusOpt.color + "18" }]}>
              <View style={[styles.badgeDot, { backgroundColor: statusOpt.color }]} />
              <Text style={[styles.badgeText, { color: statusOpt.color }]}>{statusOpt.label}</Text>
            </View>
          )}
          {priorityOpt && <TaskPriorityBadge priority={task.priority} options={priorityOptions} />}
          {task.blockedByTaskIds.length > 0 && (
            <View style={[styles.badge, { backgroundColor: T.red + "18" }]}>
              <Warning size={10} color={T.red} weight="bold" />
              <Text style={[styles.badgeText, { color: T.red }]}>Blocked</Text>
            </View>
          )}
          {recurrence ? (
            <View style={[styles.badge, { backgroundColor: T.surfaceHover }]}>
              <ArrowsClockwise size={10} color={T.textDim} weight="bold" />
              <Text style={[styles.badgeText, { color: T.textDim }]}>
                {describeRecurrence(recurrence)}
              </Text>
            </View>
          ) : null}
          {watchersQuery.data && watchersQuery.data.count > 0 ? (
            <View style={[styles.badge, { backgroundColor: T.surfaceHover }]}>
              <Eye size={10} color={T.textDim} weight="fill" />
              <Text style={[styles.badgeText, { color: T.textDim }]}>
                {watchersQuery.data.count}
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={[styles.title, { color: T.textBright }]}>{task.title}</Text>

        <View style={[styles.metaCard, { backgroundColor: T.surface, borderColor: T.border }]}>
          <TouchableOpacity
            style={[styles.metaRow, { borderBottomColor: T.border }]}
            onPress={() => setEditing("status")}
            activeOpacity={0.6}
          >
            <Text style={[styles.metaLabel, { color: T.textDim }]}>Status</Text>
            <View style={styles.metaValue}>
              <Text style={[styles.metaText, { color: statusOpt?.color ?? T.textBright }]}>
                {statusOpt?.label ?? task.status}
              </Text>
              <CaretRight size={13} color={T.textDim} weight="bold" />
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.metaRow, { borderBottomColor: T.border }]}
            onPress={() => setEditing("priority")}
            activeOpacity={0.6}
          >
            <Text style={[styles.metaLabel, { color: T.textDim }]}>Priority</Text>
            <View style={styles.metaValue}>
              <Text style={[styles.metaText, { color: priorityOpt?.color ?? T.textDim }]}>
                {priorityOpt?.label ?? "None"}
              </Text>
              <CaretRight size={13} color={T.textDim} weight="bold" />
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.metaRow, { borderBottomColor: T.border }]}
            onPress={() => setAssigneesOpen(true)}
            activeOpacity={0.6}
          >
            <Text style={[styles.metaLabel, { color: T.textDim }]}>Assignees</Text>
            <View style={styles.metaValue}>
              {task.assigneeIds.length > 0 ? (
                <SubjectAvatarStack subjectIds={task.assigneeIds} size={24} />
              ) : (
                <Text style={[styles.metaText, { color: T.textDim }]}>None</Text>
              )}
              <CaretRight size={13} color={T.textDim} weight="bold" />
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.metaRow, { borderBottomColor: T.border }]}
            onPress={() => setSheet("type")}
            activeOpacity={0.6}
          >
            <Text style={[styles.metaLabel, { color: T.textDim }]}>Type</Text>
            <View style={styles.metaValue}>
              <TypeIcon size={15} color={T.textBright} weight="duotone" />
              <Text style={[styles.metaText, { color: T.textBright }]}>{typeConfig.label}</Text>
              <CaretRight size={13} color={T.textDim} weight="bold" />
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.metaRow, { borderBottomColor: T.border }]}
            onPress={() => setSheet("sprint")}
            activeOpacity={0.6}
          >
            <Text style={[styles.metaLabel, { color: T.textDim }]}>Sprint</Text>
            <View style={styles.metaValue}>
              <Text
                style={[styles.metaText, { color: currentSprint ? T.textBright : T.textDim }]}
                numberOfLines={1}
              >
                {currentSprint?.name ?? "Backlog"}
              </Text>
              <CaretRight size={13} color={T.textDim} weight="bold" />
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.metaRow, { borderBottomColor: T.border }]}
            onPress={() => setSheet("parent")}
            activeOpacity={0.6}
          >
            <Text style={[styles.metaLabel, { color: T.textDim }]}>Parent</Text>
            <View style={styles.metaValue}>
              <Text
                style={[styles.metaText, { color: parentTask ? T.textBright : T.textDim }]}
                numberOfLines={1}
              >
                {parentTask?.title ?? "None"}
              </Text>
              <CaretRight size={13} color={T.textDim} weight="bold" />
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.metaRow, { borderBottomColor: T.border }]}
            onPress={() => setSheet("repeat")}
            activeOpacity={0.6}
          >
            <Text style={[styles.metaLabel, { color: T.textDim }]}>Repeat</Text>
            <View style={styles.metaValue}>
              <Text
                style={[styles.metaText, { color: recurrence ? T.textBright : T.textDim }]}
                numberOfLines={1}
              >
                {recurrence ? describeRecurrence(recurrence) : "Never"}
              </Text>
              <CaretRight size={13} color={T.textDim} weight="bold" />
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.metaRow, { borderBottomColor: T.border }]}
            onPress={() => setSheet("estimate")}
            activeOpacity={0.6}
          >
            <Text style={[styles.metaLabel, { color: T.textDim }]}>Estimated</Text>
            <View style={styles.metaValue}>
              <Text
                style={[
                  styles.metaText,
                  { color: task.estimatedMinutes ? T.textBright : T.textDim },
                ]}
              >
                {task.estimatedMinutes ? formatMinutes(task.estimatedMinutes) : "Not set"}
              </Text>
              <CaretRight size={13} color={T.textDim} weight="bold" />
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.metaRow, { borderBottomColor: T.border }]}
            onPress={() => setSheet("spent")}
            activeOpacity={0.6}
          >
            <Text style={[styles.metaLabel, { color: T.textDim }]}>Time spent</Text>
            <View style={styles.metaValue}>
              <Text
                style={[
                  styles.metaText,
                  { color: overBudget ? T.red : task.timeSpentMinutes ? T.textBright : T.textDim },
                ]}
              >
                {task.timeSpentMinutes ? formatMinutes(task.timeSpentMinutes) : "Not set"}
              </Text>
              <CaretRight size={13} color={T.textDim} weight="bold" />
            </View>
          </TouchableOpacity>
          <View style={[styles.metaRow, { borderBottomColor: T.border }]}>
            <Text style={[styles.metaLabel, { color: T.textDim }]}>Project</Text>
            <Text style={[styles.metaText, { color: T.textBright }]}>{project?.name ?? ""}</Text>
          </View>
          <View style={[styles.metaRow, { borderBottomWidth: 0 }]}>
            <Text style={[styles.metaLabel, { color: T.textDim }]}>Created</Text>
            <Text style={[styles.metaText, { color: T.textDim }]}>
              {formatRelativeTime(task.createdAt)}
            </Text>
          </View>
        </View>

        {hierarchyWarning && (
          <View style={[styles.warningCard, { backgroundColor: T.orange + "18" }]}>
            <Warning size={14} color={T.orange} weight="fill" />
            <Text style={[styles.warningText, { color: T.orange }]}>{hierarchyWarning}</Text>
          </View>
        )}

        <View style={{ gap: 10 }}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>TAGS</Text>
            <TouchableOpacity onPress={() => setSheet("tags")} activeOpacity={0.7}>
              <Text style={[styles.sectionAction, { color: T.accent }]}>Edit</Text>
            </TouchableOpacity>
          </View>
          {task.tags.length > 0 ? (
            <View style={styles.tagRow}>
              {task.tags.map((tag) => (
                <View key={tag.id} style={[styles.tagChip, { backgroundColor: tag.color + "22" }]}>
                  <Text style={[styles.tagText, { color: tag.color }]}>{tag.name}</Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.emptyHint, { color: T.textDim }]}>No tags</Text>
          )}
        </View>

        <View style={{ gap: 10 }}>
          <Text style={[styles.sectionLabel, { color: T.textDim }]}>DATES</Text>
          <View style={styles.datesRow}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.dateLabel, { color: T.textDim }]}>Start</Text>
              <CalendarPicker
                value={task.startDate}
                onChange={(date) =>
                  updateTask.mutate({ taskId: task.id, projectId: task.projectId, startDate: date })
                }
                placeholder="No start date"
                accentColor={T.accent}
              />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={[styles.dateLabel, { color: T.textDim }]}>Due</Text>
              <CalendarPicker
                value={task.dueDate}
                onChange={(date) =>
                  updateTask.mutate({ taskId: task.id, projectId: task.projectId, dueDate: date })
                }
                placeholder="No due date"
                accentColor={T.accent}
              />
            </View>
          </View>
        </View>

        {task.description ? (
          <View style={{ gap: 8 }}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>DESCRIPTION</Text>
            <MarkdownRenderer content={task.description} />
          </View>
        ) : null}

        <View style={{ gap: 10 }}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>
              BLOCKED BY{blockers.length > 0 ? ` - ${blockers.length}` : ""}
            </Text>
            <TouchableOpacity onPress={() => setSheet("blockers")} activeOpacity={0.7}>
              <Text style={[styles.sectionAction, { color: T.accent }]}>Edit</Text>
            </TouchableOpacity>
          </View>
          {blockers.length === 0 ? (
            <Text style={[styles.emptyHint, { color: T.textDim }]}>Nothing blocking this task</Text>
          ) : (
            blockers.map((blocker) => {
              const blockerStatus = getOptionById(statusOptions, blocker.status);
              const isDone = !!blocker.completedAt;
              return (
                <TouchableOpacity
                  key={blocker.id}
                  style={[styles.blockerRow, { backgroundColor: T.surface, borderColor: T.border }]}
                  onPress={() => router.push(`/projects/task/${blocker.id}` as any)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.blockerDot,
                      { backgroundColor: blockerStatus?.color ?? T.textDim },
                    ]}
                  />
                  <Text
                    style={[
                      styles.blockerTitle,
                      {
                        color: isDone ? T.textDim : T.textBright,
                        textDecorationLine: isDone ? "line-through" : "none",
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {blocker.title}
                  </Text>
                  <CaretRight size={14} color={T.textDim} weight="bold" />
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {subtasks.length > 0 && (
          <View style={{ gap: 10 }}>
            <View style={styles.subtaskHeader}>
              <Text style={[styles.sectionLabel, { color: T.textDim }]}>SUBTASKS</Text>
              <Text style={[styles.subtaskProgress, { color: T.textDim }]}>
                {subtasksDone}/{subtasks.length} complete
              </Text>
            </View>
            {subtasks.map((sub) => {
              const done = !!sub.completedAt;
              return (
                <TouchableOpacity
                  key={sub.id}
                  style={styles.subtaskRow}
                  onPress={() => toggleSubtask(sub)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.subtaskCheck,
                      {
                        borderColor: done ? T.green : T.border,
                        backgroundColor: done ? T.green : "transparent",
                      },
                    ]}
                  >
                    {done && <Check size={10} color="#fff" weight="bold" />}
                  </View>
                  <Text
                    style={[
                      styles.subtaskTitle,
                      {
                        color: done ? T.textDim : T.textBright,
                        textDecorationLine: done ? "line-through" : "none",
                      },
                    ]}
                  >
                    {sub.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {activities.length > 0 && (
          <View style={{ gap: 10 }}>
            <Text style={[styles.sectionLabel, { color: T.textDim }]}>ACTIVITY</Text>
            {activities.map((act) => {
              const actor = directory.byId.get(act.actorId);
              return (
                <View key={act.id} style={styles.activityRow}>
                  <Avatar
                    name={actor?.name ?? "Unknown"}
                    avatarUrl={actor?.avatarUrl}
                    size={24}
                    circle
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.activityText, { color: T.text }]}>
                      <Text style={{ fontFamily: FONT.semibold }}>{actor?.name ?? "Someone"}</Text>{" "}
                      {activityActionLabel(act.action)}
                    </Text>
                    {act.previousValue && act.newValue && (
                      <Text style={[styles.activityDetail, { color: T.textDim }]}>
                        {resolveActivityValue(act.previousValue)} {"->"}{" "}
                        {resolveActivityValue(act.newValue)}
                      </Text>
                    )}
                  </View>
                  <Text style={[styles.activityTime, { color: T.textDim }]}>
                    {formatRelativeTime(act.timestamp)}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <ActionSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={task.title}
        subtitle={statusOpt?.label}
        icon="projects"
        iconColor={projectColor}
        actions={[
          {
            icon: "edit-2",
            label: "Edit task",
            onPress: () =>
              router.push({
                pathname: "/projects/task/create" as any,
                params: { taskId: task.id },
              }),
          },
          {
            icon: "trash-2",
            label: "Delete task",
            isDanger: true,
            onPress: () =>
              confirmDestructive({
                title: "Delete task",
                message: `"${task.title}" will be moved to the trash.`,
                onConfirm: () =>
                  deleteTask.mutate(
                    { taskId: task.id, projectId: task.projectId },
                    { onSuccess: () => router.back() },
                  ),
              }),
          },
        ]}
      />

      <OptionPickerSheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "priority" ? "Priority" : "Status"}
        options={editing === "priority" ? priorityOptions : statusOptions}
        selectedId={editing === "priority" ? task.priority : task.status}
        allowNone={editing === "priority"}
        accentColor={T.accent}
        onSelect={(optionId) =>
          updateTask.mutate({
            taskId: task.id,
            projectId: task.projectId,
            [editing === "priority" ? "priority" : "status"]: optionId,
          })
        }
      />

      <SubjectPickerSheet
        visible={assigneesOpen}
        onClose={() => setAssigneesOpen(false)}
        title="Assignees"
        selectedIds={task.assigneeIds}
        onToggle={toggleAssignee}
        accentColor={T.accent}
        busy={updateTask.isPending}
      />

      <TaskTypePickerSheet
        visible={sheet === "type"}
        onClose={() => setSheet(null)}
        selectedType={task.taskType}
        accentColor={T.accent}
        onSelect={(taskType) => patch({ taskType })}
      />

      <RecurrenceSheet
        visible={sheet === "repeat"}
        onClose={() => setSheet(null)}
        rule={task.recurrenceRule}
        accentColor={T.accent}
        onSave={(recurrenceRule) => patch({ recurrenceRule })}
      />

      <SprintPickerSheet
        visible={sheet === "sprint"}
        onClose={() => setSheet(null)}
        sprints={sprints}
        selectedId={task.sprintId}
        accentColor={T.accent}
        onSelect={(sprintId) => patch({ sprintId })}
      />

      <TaskPickerSheet
        visible={sheet === "parent"}
        onClose={() => setSheet(null)}
        title="Parent task"
        tasks={allTasks}
        excludeIds={descendantIds}
        selectedIds={task.parentId ? [task.parentId] : []}
        allowNone
        accentColor={T.accent}
        onToggle={(parentId) => patch({ parentId })}
      />

      <TaskPickerSheet
        visible={sheet === "blockers"}
        onClose={() => setSheet(null)}
        title="Blocked by"
        tasks={allTasks}
        excludeIds={[task.id]}
        selectedIds={task.blockedByTaskIds}
        multi
        accentColor={T.accent}
        onToggle={toggleBlocker}
      />

      <TimeInputSheet
        visible={sheet === "estimate"}
        onClose={() => setSheet(null)}
        title="Estimated time"
        minutes={task.estimatedMinutes}
        accentColor={T.accent}
        onSave={(estimatedMinutes) => patch({ estimatedMinutes })}
      />

      <TimeInputSheet
        visible={sheet === "spent"}
        onClose={() => setSheet(null)}
        title="Time spent"
        minutes={task.timeSpentMinutes}
        accentColor={T.accent}
        onSave={(timeSpentMinutes) => patch({ timeSpentMinutes })}
      />

      <TagPickerSheet
        visible={sheet === "tags"}
        onClose={() => setSheet(null)}
        selectedIds={task.tags.map((t) => t.id)}
        busy={updateTask.isPending}
        onToggle={toggleTag}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { alignItems: "center", justifyContent: "center" },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeDot: { width: 5, height: 5, borderRadius: 3 },
  badgeText: { fontSize: 12, fontFamily: FONT.medium },
  title: { fontSize: 22, fontFamily: FONT.bold, lineHeight: 30 },
  metaCard: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metaLabel: { fontSize: 13, fontFamily: FONT.regular },
  metaValue: { flexDirection: "row", alignItems: "center", gap: 8 },
  metaText: { fontSize: 13, fontFamily: FONT.semibold },
  sectionLabel: { fontSize: 11, fontFamily: FONT.semibold, letterSpacing: 0.8 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionAction: { fontSize: 13, fontFamily: FONT.semibold },
  emptyHint: { fontSize: 13, fontFamily: FONT.regular },
  warningCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    padding: 11,
    borderRadius: 10,
  },
  warningText: { flex: 1, fontSize: 12, fontFamily: FONT.regular, lineHeight: 17 },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tagChip: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7 },
  tagText: { fontSize: 12, fontFamily: FONT.medium },
  datesRow: { flexDirection: "row", gap: 12 },
  dateLabel: { fontSize: 12, fontFamily: FONT.medium },
  blockerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  blockerDot: { width: 8, height: 8, borderRadius: 4 },
  blockerTitle: { flex: 1, fontSize: 13, fontFamily: FONT.medium },
  subtaskHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  subtaskProgress: { fontSize: 12, fontFamily: FONT.regular },
  subtaskRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  subtaskCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  subtaskTitle: { fontSize: 14, fontFamily: FONT.regular, flex: 1 },
  activityRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  activityText: { fontSize: 13, fontFamily: FONT.regular, lineHeight: 18 },
  activityDetail: { fontSize: 12, fontFamily: FONT.regular, marginTop: 2 },
  activityTime: { fontSize: 11, fontFamily: FONT.regular },
});
