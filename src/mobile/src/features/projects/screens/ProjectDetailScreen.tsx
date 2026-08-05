import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from "react-native";
import {
  DotsThree,
  Plus,
  ArrowUp,
  Warning,
  CalendarBlank,
  ArrowsClockwise,
  MagnifyingGlass,
  Funnel,
  X,
  CheckCircle,
  Users,
  Flag,
  Trash,
} from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { DomainHeader } from "@shared/components/DomainHeader";
import { CommentButton } from "@shared/comments/CommentsSheet";
import { ShareButton } from "@shared/permissions/ShareSheet";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { ActionSheet } from "@shared/components/ActionSheet";
import { SubjectAvatarStack } from "@shared/directory/SubjectAvatarStack";
import { confirmDestructive } from "@shared/lib/confirmDestructive";
import { useTheme } from "@shared/hooks/useTheme";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { SubjectPickerSheet } from "@shared/directory/SubjectPickerSheet";
import { useProject, useProjectTasks } from "@features/projects/useProjects";
import {
  useDeleteProject,
  useBulkUpdateTasks,
  useDeleteTasks,
} from "@features/projects/useProjectMutations";
import { OptionPickerSheet } from "@features/projects/components/OptionPickerSheet";
import {
  getStatusOptions,
  getPriorityOptions,
  getOptionById,
  computeProjectStats,
} from "@features/projects/projectsSerializer";
import { getTaskTypeConfig } from "@features/projects/taskTypes";
import { formatMinutes } from "@features/projects/timeFormatting";
import { TaskFilterSheet } from "@features/projects/components/TaskFilterSheet";
import {
  filterTasks,
  isNarrowed,
  activeFilterCount,
  NO_TASK_FILTERS,
} from "@features/projects/taskFilters";
import type { TaskFilters } from "@features/projects/taskFilters";
import type { SerializedTask, PlainSelectOption } from "@features/projects/projectsSerializer";

type ViewMode = "Table" | "Board" | "Roadmap";

function PriorityBadge({ priority, options }: { priority: string; options: PlainSelectOption[] }) {
  const opt = getOptionById(options, priority);
  if (!opt) return null;
  const color = opt.color;
  return (
    <View style={[styles.priorityBadge, { backgroundColor: color + "18" }]}>
      {opt.label.toLowerCase().includes("high") || opt.label.toLowerCase().includes("urgent") ? (
        <ArrowUp size={9} color={color} weight="bold" />
      ) : null}
      <Text style={[styles.priorityText, { color }]}>{opt.label}</Text>
    </View>
  );
}

function TaskCard({
  task,
  allTasks,
  priorityOptions,
  statusColor,
  selected,
  selectionColor,
  onPress,
  onLongPress,
}: {
  task: SerializedTask;
  allTasks: SerializedTask[];
  priorityOptions: PlainSelectOption[];
  statusColor: string;
  selected: boolean;
  selectionColor: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const T = useTheme();
  const isDone = !!task.completedAt;
  const isBlocked = task.blockedByTaskIds.length > 0;
  const subtasks = allTasks.filter((t) => t.parentId === task.id);
  const subtasksDone = subtasks.filter((t) => t.completedAt).length;
  const TypeIcon = getTaskTypeConfig(task.taskType).Icon;

  return (
    <TouchableOpacity
      style={[
        styles.taskCard,
        { backgroundColor: T.bg, borderColor: T.border, opacity: isDone ? 0.7 : 1 },
        selected && { borderColor: selectionColor, backgroundColor: selectionColor + "14" },
      ]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={250}
      activeOpacity={0.8}
    >
      <View style={styles.taskTags}>
        {task.priority ? (
          <PriorityBadge priority={task.priority} options={priorityOptions} />
        ) : null}
        {isBlocked && (
          <View style={[styles.blockedBadge, { backgroundColor: T.red + "18" }]}>
            <Warning size={9} color={T.red} weight="bold" />
            <Text style={[styles.priorityText, { color: T.red }]}>Blocked</Text>
          </View>
        )}
        {task.tags.map((tag) => (
          <View key={tag.id} style={[styles.blockedBadge, { backgroundColor: tag.color + "22" }]}>
            <Text style={[styles.priorityText, { color: tag.color }]}>{tag.name}</Text>
          </View>
        ))}
      </View>

      <View style={styles.taskTitleRow}>
        <TypeIcon size={13} color={T.textDim} weight="duotone" />
        <Text
          style={[
            styles.taskTitle,
            { color: T.textBright, textDecorationLine: isDone ? "line-through" : "none" },
          ]}
        >
          {task.title}
        </Text>
      </View>

      <View style={styles.taskFooter}>
        <View style={styles.taskFooterLeft}>
          {task.dueDate ? (
            <View style={styles.dueDateRow}>
              <CalendarBlank size={11} color={T.textDim} weight="duotone" />
              <Text style={[styles.dueDateText, { color: T.textDim }]}>{task.dueDate}</Text>
            </View>
          ) : null}
          {subtasks.length > 0 && (
            <Text style={[styles.subtaskCount, { color: T.textDim }]}>
              {subtasksDone}/{subtasks.length}
            </Text>
          )}
        </View>
        <SubjectAvatarStack subjectIds={task.assigneeIds} size={20} />
      </View>
    </TouchableOpacity>
  );
}

export function ProjectBoardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const [activeView, setActiveView] = useState<ViewMode>("Table");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<TaskFilters>(NO_TASK_FILTERS);
  const [filterOpen, setFilterOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkSheet, setBulkSheet] = useState<"status" | "priority" | "assignees" | null>(null);

  const projectQuery = useProject(id);
  const tasksQuery = useProjectTasks(id);
  const deleteProject = useDeleteProject();
  const bulkUpdateTasks = useBulkUpdateTasks();
  const deleteTasks = useDeleteTasks();

  const project = projectQuery.data;
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const bottomPad =
    Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom;

  const statusOptions = useMemo(() => (project ? getStatusOptions(project) : []), [project]);
  const priorityOptions = useMemo(() => (project ? getPriorityOptions(project) : []), [project]);
  // Progress reads the whole project, not the current filter - the header would
  // otherwise claim the project is complete the moment someone filters to Done.
  const stats = useMemo(() => computeProjectStats(tasks), [tasks]);

  const narrowed = isNarrowed(filters, query);
  const filterCount = activeFilterCount(filters);
  const visibleTasks = useMemo(() => filterTasks(tasks, filters, query), [tasks, filters, query]);

  // Subtasks are normally folded into their parent row. While a search or
  // filter is on, a match has to surface wherever it sits in the hierarchy.
  const columnTasks = (statusId: string) =>
    visibleTasks
      .filter((t) => t.status === statusId && (narrowed || !t.parentId))
      .sort((a, b) => a.sortOrder - b.sortOrder);

  const selecting = selectedIds.length > 0;

  const toggleSelected = (taskId: string) =>
    setSelectedIds((prev) =>
      prev.includes(taskId) ? prev.filter((t) => t !== taskId) : [...prev, taskId],
    );

  // A tap opens the task normally, but once a long-press has started a
  // selection it extends that selection instead.
  const openOrSelect = (taskId: string) => {
    if (selecting) toggleSelected(taskId);
    else router.push(`/projects/task/${taskId}` as any);
  };

  const runBulk = (changes: { status?: string; priority?: string; assigneeIds?: string[] }) => {
    bulkUpdateTasks.mutate(
      { projectId: id, taskIds: selectedIds, ...changes },
      { onSuccess: () => setSelectedIds([]) },
    );
  };

  const columns = useMemo(
    () =>
      statusOptions.map((opt) => ({
        key: opt.id,
        label: opt.label,
        color: opt.color,
      })),
    [statusOptions],
  );

  if (projectQuery.isLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer, { backgroundColor: T.pageBg }]}>
        <ActivityIndicator size="large" color={T.accent} />
      </View>
    );
  }

  if (!project) return null;

  const projectColor = project.color || T.accent;

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={project.name}
        color={projectColor}
        icon="projects"
        subtitle={`${stats.progress}% complete - ${stats.done}/${stats.total} tasks`}
        rightActions={
          <>
            <CommentButton
              contentType={ContentType.PROJECT}
              contentId={project.id}
              color={projectColor}
            />
            <ShareButton
              contentType={ContentType.PROJECT}
              contentId={project.id}
              color={projectColor}
            />
            <TouchableOpacity
              onPress={() => setSheetOpen(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <DotsThree size={22} color={T.text} weight="bold" />
            </TouchableOpacity>
          </>
        }
      />

      <View style={[styles.viewTabs, { backgroundColor: T.bg, borderBottomColor: T.border }]}>
        {(["Table", "Board", "Roadmap"] as ViewMode[]).map((view) => {
          const isActive = activeView === view;
          return (
            <TouchableOpacity
              key={view}
              style={[
                styles.viewTab,
                isActive && { borderBottomColor: projectColor, borderBottomWidth: 2 },
              ]}
              onPress={() => {
                if (view === "Roadmap") {
                  router.push({ pathname: "/projects/roadmap" as any, params: { projectId: id } });
                } else {
                  setActiveView(view);
                }
              }}
            >
              <Text style={[styles.viewTabText, { color: isActive ? projectColor : T.textDim }]}>
                {view}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={[styles.searchRow, { backgroundColor: T.bg, borderBottomColor: T.border }]}>
        <View style={[styles.searchBar, { backgroundColor: T.pageBg, borderColor: T.border }]}>
          <MagnifyingGlass size={15} color={T.textDim} weight="bold" />
          <TextInput
            style={[styles.searchInput, { color: T.textBright }]}
            value={query}
            onChangeText={setQuery}
            placeholder="Search tasks"
            placeholderTextColor={T.textDim}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity
              onPress={() => setQuery("")}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <X size={14} color={T.textDim} weight="bold" />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[
            styles.filterBtn,
            {
              backgroundColor: filterCount > 0 ? projectColor + "18" : T.pageBg,
              borderColor: filterCount > 0 ? projectColor : T.border,
            },
          ]}
          onPress={() => setFilterOpen(true)}
          activeOpacity={0.7}
        >
          <Funnel
            size={16}
            color={filterCount > 0 ? projectColor : T.textDim}
            weight={filterCount > 0 ? "fill" : "duotone"}
          />
          {filterCount > 0 && (
            <Text style={[styles.filterCount, { color: projectColor }]}>{filterCount}</Text>
          )}
        </TouchableOpacity>
      </View>

      {narrowed && (
        <View style={styles.narrowedBar}>
          <Text style={[styles.narrowedText, { color: T.textDim }]}>
            {visibleTasks.length} matching task{visibleTasks.length === 1 ? "" : "s"}
          </Text>
          <TouchableOpacity
            onPress={() => {
              setQuery("");
              setFilters(NO_TASK_FILTERS);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.narrowedReset, { color: projectColor }]}>Reset</Text>
          </TouchableOpacity>
        </View>
      )}

      {activeView === "Table" ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: bottomPad }}
          keyboardShouldPersistTaps="handled"
        >
          {columns.map((col) => {
            const colTasks = columnTasks(col.key);
            if (colTasks.length === 0) return null;
            return (
              <View key={col.key}>
                <View
                  style={[
                    styles.listGroupHeader,
                    { backgroundColor: T.bg, borderBottomColor: T.border },
                  ]}
                >
                  <View style={[styles.colDot, { backgroundColor: col.color }]} />
                  <Text style={[styles.listGroupTitle, { color: T.textBright }]}>{col.label}</Text>
                  <View style={[styles.colCount, { backgroundColor: T.surfaceHover }]}>
                    <Text style={[styles.colCountText, { color: T.textDim }]}>
                      {colTasks.length}
                    </Text>
                  </View>
                </View>
                {colTasks.map((task) => {
                  const isDone = !!task.completedAt;
                  const isBlocked = task.blockedByTaskIds.length > 0;
                  const RowTypeIcon = getTaskTypeConfig(task.taskType).Icon;
                  const isSelected = selectedIds.includes(task.id);
                  return (
                    <TouchableOpacity
                      key={task.id}
                      style={[
                        styles.listRow,
                        { borderBottomColor: T.border, borderLeftColor: col.color },
                        isSelected && { backgroundColor: projectColor + "14" },
                      ]}
                      onPress={() => openOrSelect(task.id)}
                      onLongPress={() => toggleSelected(task.id)}
                      delayLongPress={250}
                      activeOpacity={0.8}
                    >
                      {selecting && (
                        <TouchableOpacity
                          onPress={() => toggleSelected(task.id)}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          {isSelected ? (
                            <CheckCircle size={20} color={projectColor} weight="fill" />
                          ) : (
                            <View style={[styles.selectRing, { borderColor: T.textDim }]} />
                          )}
                        </TouchableOpacity>
                      )}
                      <View style={{ flex: 1, gap: 4 }}>
                        <View style={styles.taskTitleRow}>
                          <RowTypeIcon size={14} color={T.textDim} weight="duotone" />
                          <Text
                            style={[
                              styles.listTaskTitle,
                              {
                                color: isDone ? T.textDim : T.textBright,
                                textDecorationLine: isDone ? "line-through" : "none",
                              },
                            ]}
                            numberOfLines={2}
                          >
                            {task.title}
                          </Text>
                          {task.recurrenceRule ? (
                            <ArrowsClockwise size={12} color={T.textDim} weight="bold" />
                          ) : null}
                        </View>
                        <View style={styles.listTaskMeta}>
                          {task.priority ? (
                            <PriorityBadge priority={task.priority} options={priorityOptions} />
                          ) : null}
                          {isBlocked && (
                            <View style={[styles.blockedBadge, { backgroundColor: T.red + "18" }]}>
                              <Warning size={9} color={T.red} weight="bold" />
                              <Text style={[styles.priorityText, { color: T.red }]}>Blocked</Text>
                            </View>
                          )}
                          {task.tags.map((tag) => (
                            <View
                              key={tag.id}
                              style={[styles.blockedBadge, { backgroundColor: tag.color + "22" }]}
                            >
                              <Text style={[styles.priorityText, { color: tag.color }]}>
                                {tag.name}
                              </Text>
                            </View>
                          ))}
                          {task.estimatedMinutes ? (
                            <Text style={[styles.listDueDate, { color: T.textDim }]}>
                              {formatMinutes(task.estimatedMinutes)}
                            </Text>
                          ) : null}
                          {task.dueDate ? (
                            <Text style={[styles.listDueDate, { color: T.textDim }]}>
                              {task.dueDate}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                      <SubjectAvatarStack subjectIds={task.assigneeIds} size={22} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            );
          })}

          {narrowed && visibleTasks.length === 0 ? (
            <Text style={[styles.noMatches, { color: T.textDim }]}>No tasks match this search</Text>
          ) : (
            <TouchableOpacity
              style={[styles.listAddBtn, { borderColor: T.border }]}
              activeOpacity={0.7}
              onPress={() =>
                router.push({ pathname: "/projects/task/create" as any, params: { projectId: id } })
              }
            >
              <Plus size={15} color={T.textDim} weight="bold" />
              <Text style={[styles.addTaskText, { color: T.textDim }]}>Add task</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      ) : activeView === "Board" ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottomPad }}
          keyboardShouldPersistTaps="handled"
        >
          {columns.map((col) => {
            const colTasks = columnTasks(col.key);
            return (
              <View
                key={col.key}
                style={[styles.column, { backgroundColor: T.surface, borderColor: T.border }]}
              >
                <View style={styles.colHeader}>
                  <View style={[styles.colDot, { backgroundColor: col.color }]} />
                  <Text style={[styles.colTitle, { color: T.textBright }]}>{col.label}</Text>
                  <View style={[styles.colCount, { backgroundColor: T.surfaceHover }]}>
                    <Text style={[styles.colCountText, { color: T.textDim }]}>
                      {colTasks.length}
                    </Text>
                  </View>
                </View>

                {colTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    allTasks={tasks}
                    priorityOptions={priorityOptions}
                    statusColor={col.color}
                    selected={selectedIds.includes(task.id)}
                    selectionColor={projectColor}
                    onPress={() => openOrSelect(task.id)}
                    onLongPress={() => toggleSelected(task.id)}
                  />
                ))}

                <TouchableOpacity
                  style={[styles.addTaskBtn, { borderColor: T.border }]}
                  activeOpacity={0.7}
                  onPress={() =>
                    router.push({
                      pathname: "/projects/task/create" as any,
                      params: { projectId: id, status: col.key },
                    })
                  }
                >
                  <Plus size={14} color={T.textDim} weight="bold" />
                  <Text style={[styles.addTaskText, { color: T.textDim }]}>Add task</Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      {selecting && (
        <View
          style={[
            styles.bulkBar,
            { backgroundColor: T.bg, borderTopColor: T.border, paddingBottom: insets.bottom || 12 },
          ]}
        >
          <View style={styles.bulkHeader}>
            <Text style={[styles.bulkCount, { color: T.textBright }]}>
              {selectedIds.length} selected
            </Text>
            <TouchableOpacity
              onPress={() => setSelectedIds([])}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.bulkCancel, { color: projectColor }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.bulkActions}>
            <TouchableOpacity
              style={styles.bulkAction}
              onPress={() => setBulkSheet("status")}
              activeOpacity={0.7}
            >
              <CheckCircle size={19} color={T.text} weight="duotone" />
              <Text style={[styles.bulkActionText, { color: T.text }]}>Status</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.bulkAction}
              onPress={() => setBulkSheet("priority")}
              activeOpacity={0.7}
            >
              <Flag size={19} color={T.text} weight="duotone" />
              <Text style={[styles.bulkActionText, { color: T.text }]}>Priority</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.bulkAction}
              onPress={() => setBulkSheet("assignees")}
              activeOpacity={0.7}
            >
              <Users size={19} color={T.text} weight="duotone" />
              <Text style={[styles.bulkActionText, { color: T.text }]}>Assign</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.bulkAction}
              activeOpacity={0.7}
              onPress={() =>
                confirmDestructive({
                  title: "Delete tasks",
                  message: `${selectedIds.length} task${selectedIds.length === 1 ? "" : "s"} will be moved to the trash.`,
                  onConfirm: () =>
                    deleteTasks.mutate(
                      { projectId: id, taskIds: selectedIds },
                      { onSuccess: () => setSelectedIds([]) },
                    ),
                })
              }
            >
              <Trash size={19} color={T.red} weight="duotone" />
              <Text style={[styles.bulkActionText, { color: T.red }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <OptionPickerSheet
        visible={bulkSheet === "status"}
        onClose={() => setBulkSheet(null)}
        title={`Set status for ${selectedIds.length}`}
        options={statusOptions}
        selectedId={undefined}
        accentColor={projectColor}
        onSelect={(status) => runBulk({ status })}
      />

      <OptionPickerSheet
        visible={bulkSheet === "priority"}
        onClose={() => setBulkSheet(null)}
        title={`Set priority for ${selectedIds.length}`}
        options={priorityOptions}
        selectedId={undefined}
        accentColor={projectColor}
        onSelect={(priority) => runBulk({ priority })}
      />

      <SubjectPickerSheet
        visible={bulkSheet === "assignees"}
        onClose={() => setBulkSheet(null)}
        title={`Assign ${selectedIds.length} task${selectedIds.length === 1 ? "" : "s"}`}
        selectedIds={[]}
        accentColor={projectColor}
        busy={bulkUpdateTasks.isPending}
        onToggle={(subjectId) => {
          runBulk({ assigneeIds: [subjectId] });
          setBulkSheet(null);
        }}
      />

      <TaskFilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        filters={filters}
        onChange={setFilters}
        tasks={tasks}
        statusOptions={statusOptions}
        priorityOptions={priorityOptions}
        accentColor={projectColor}
      />

      <ActionSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={project.name}
        subtitle={`${stats.done}/${stats.total} tasks`}
        icon="projects"
        iconColor={projectColor}
        actions={[
          {
            icon: "edit-2",
            label: "Edit project",
            onPress: () =>
              router.push({ pathname: "/projects/create" as any, params: { projectId: id } }),
          },
          {
            icon: "users",
            label: "Workload",
            sublabel: "Tasks and time per assignee",
            onPress: () =>
              router.push({ pathname: "/projects/workload" as any, params: { projectId: id } }),
          },
          {
            icon: "settings",
            label: "Project settings",
            sublabel: "Statuses, members, access",
            onPress: () => router.push({ pathname: "/projects/settings" as any, params: { id } }),
          },
          {
            icon: "trash-2",
            label: "Delete project",
            isDanger: true,
            onPress: () =>
              confirmDestructive({
                title: "Delete project",
                message: `"${project.name}" and its ${stats.total} task${stats.total === 1 ? "" : "s"} will be moved to the trash.`,
                onConfirm: () => deleteProject.mutate(id, { onSuccess: () => router.back() }),
              }),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: { alignItems: "center", justifyContent: "center" },
  viewTabs: {
    flexDirection: "row",
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
  },
  viewTab: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: -1,
  },
  viewTabText: { fontSize: 14, fontFamily: FONT.medium },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: FONT.regular, padding: 0 },
  filterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  filterCount: { fontSize: 12, fontFamily: FONT.semibold },
  narrowedBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  narrowedText: { fontSize: 12, fontFamily: FONT.regular },
  narrowedReset: { fontSize: 13, fontFamily: FONT.semibold },
  noMatches: { fontSize: 14, fontFamily: FONT.regular, textAlign: "center", padding: 32 },
  bulkBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  bulkHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  bulkCount: { fontSize: 14, fontFamily: FONT.semibold },
  bulkCancel: { fontSize: 14, fontFamily: FONT.semibold },
  bulkActions: { flexDirection: "row", justifyContent: "space-around" },
  bulkAction: { alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 4 },
  bulkActionText: { fontSize: 11, fontFamily: FONT.medium },
  selectRing: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5 },
  column: {
    width: 260,
    borderRadius: 14,
    padding: 12,
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignSelf: "flex-start",
  },
  colHeader: { flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: 4 },
  colDot: { width: 7, height: 7, borderRadius: 4 },
  colTitle: { fontSize: 13, fontFamily: FONT.semibold, flex: 1 },
  colCount: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  colCountText: { fontSize: 11, fontFamily: FONT.medium },
  taskCard: {
    borderRadius: 10,
    padding: 12,
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
  },
  taskTags: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  priorityBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  priorityText: { fontSize: 10, fontFamily: FONT.medium },
  blockedBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  taskTitle: { flex: 1, fontSize: 13, fontFamily: FONT.medium, lineHeight: 19 },
  taskTitleRow: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  taskFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  taskFooterLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  dueDateRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  dueDateText: { fontSize: 11, fontFamily: FONT.regular },
  subtaskCount: { fontSize: 11, fontFamily: FONT.medium },
  addTaskBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  addTaskText: { fontSize: 13, fontFamily: FONT.regular },
  listGroupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  listGroupTitle: { fontSize: 13, fontFamily: FONT.semibold, flex: 1 },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
  },
  listTaskTitle: { fontSize: 14, fontFamily: FONT.medium, lineHeight: 20 },
  listTaskMeta: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  listDueDate: { fontSize: 12, fontFamily: FONT.regular },
  listAddBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    margin: 16,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: "dashed",
  },
});
