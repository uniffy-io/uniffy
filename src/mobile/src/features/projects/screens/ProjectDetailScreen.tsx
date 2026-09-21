import React, { useCallback, useRef, useState, useMemo } from "react";
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
  MagnifyingGlass,
  Funnel,
  X,
  CheckCircle,
  Users,
  Flag,
  Trash,
} from "phosphor-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { DomainHeader } from "@shared/components/DomainHeader";
import { ScreenError } from "@shared/components/ScreenError";
import { CommentButton } from "@shared/comments/CommentsSheet";
import { ShareButton } from "@shared/permissions/ShareSheet";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { ActionSheet } from "@shared/components/ActionSheet";
import { confirmDestructive } from "@shared/lib/confirmDestructive";
import { roleCanEdit } from "@shared/permissions/contentRoles";
import { useTheme } from "@shared/hooks/useTheme";
import { bottomBarBlockHeight } from "@shared/components/BottomNav";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { SubjectPickerSheet } from "@shared/directory/SubjectPickerSheet";
import { useProject, useProjectTasks } from "@features/projects/useProjects";
import {
  useDeleteProject,
  useBulkUpdateTasks,
  useDeleteTasks,
  useMoveTasks,
} from "@features/projects/useProjectMutations";
import { OptionPickerSheet } from "@features/projects/components/OptionPickerSheet";
import {
  getStatusOptions,
  getPriorityOptions,
  computeProjectStats,
} from "@features/projects/projectsSerializer";
import { TaskFilterSheet } from "@features/projects/components/TaskFilterSheet";
import { ProjectBoardView, CARD_GAP } from "@features/projects/components/ProjectBoardView";
import { ProjectTableView } from "@features/projects/components/ProjectTableView";
import { ProjectRoadmapView } from "@features/projects/components/ProjectRoadmapView";
import { ProjectBacklogView } from "@features/projects/components/ProjectBacklogView";
import { ProjectGraphView } from "@features/projects/components/ProjectGraphView";
import { TaskDragPreview } from "@features/projects/components/TaskDragPreview";
import { useTaskDrag } from "@features/projects/useTaskDrag";
import { planTaskMove } from "@features/projects/taskOrdering";
import { buildTaskRelations } from "@features/projects/taskRelations";
import {
  filterTasks,
  isNarrowed,
  activeFilterCount,
  NO_TASK_FILTERS,
} from "@features/projects/taskFilters";
import type { DropTarget } from "@features/projects/useTaskDrag";
import type { TaskFilters } from "@features/projects/taskFilters";
import type { SerializedTask } from "@features/projects/projectsSerializer";

type ViewMode = "Table" | "Board" | "Roadmap" | "Backlog" | "Graph";

const VIEWS: ViewMode[] = ["Table", "Board", "Roadmap", "Backlog", "Graph"];

/** The views built from status columns, and so the only ones that drag or select. */
const COLUMN_VIEWS: ViewMode[] = ["Table", "Board"];

function groupByStatus(
  columns: { key: string }[],
  tasks: SerializedTask[],
): Map<string, SerializedTask[]> {
  const byStatus = new Map<string, SerializedTask[]>();
  for (const col of columns) {
    byStatus.set(
      col.key,
      tasks.filter((t) => t.status === col.key).sort((a, b) => a.sortOrder - b.sortOrder),
    );
  }
  return byStatus;
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
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  // Keyed by project, so a screen reused for another project starts folded.
  const [expansion, setExpansion] = useState<{ projectId: string; taskIds: string[] }>({
    projectId: id,
    taskIds: [],
  });
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const [bulkSheet, setBulkSheet] = useState<"status" | "priority" | "assignees" | null>(null);

  const inColumnView = COLUMN_VIEWS.includes(activeView);
  const selecting = inColumnView && (selectionMode || selectedIds.length > 0);

  // A menu entry pushes a screen over this one, which takes the sheet with it.
  // Coming back should land on the menu the tap started from, so a return of
  // focus reopens it - and only a return, since an entry that stays on this
  // screen never blurs it and so never arms the flag.
  const menuNavigated = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!menuNavigated.current) return;
      menuNavigated.current = false;
      setSheetOpen(true);
    }, []),
  );
  const navigateFromMenu = useCallback((go: () => void) => {
    menuNavigated.current = true;
    go();
  }, []);

  const projectQuery = useProject(id);
  const tasksQuery = useProjectTasks(id);
  const deleteProject = useDeleteProject();
  const bulkUpdateTasks = useBulkUpdateTasks();
  const deleteTasks = useDeleteTasks();
  const moveTasks = useMoveTasks();

  const project = projectQuery.data;
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  // The router slides screen content under the floating nav, so the bulk bar
  // is parked on top of that block rather than at the bottom of the screen.
  const navSpace = bottomBarBlockHeight(insets.bottom);
  const bottomPad =
    (Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom) +
    (selecting ? bulkBarHeight : 0);

  const statusOptions = useMemo(() => (project ? getStatusOptions(project) : []), [project]);
  const priorityOptions = useMemo(() => (project ? getPriorityOptions(project) : []), [project]);
  // Progress reads the whole project, not the current filter - the header would
  // otherwise claim the project is complete the moment someone filters to Done.
  const stats = useMemo(() => computeProjectStats(tasks), [tasks]);
  // Over every loaded task: a parent or blocker hidden by a filter still counts.
  const relations = useMemo(() => buildTaskRelations(tasks), [tasks]);
  const expanded = expansion.projectId === id ? expansion.taskIds : [];

  const narrowed = isNarrowed(filters, query);
  const filterCount = activeFilterCount(filters);
  const visibleTasks = useMemo(() => filterTasks(tasks, filters, query), [tasks, filters, query]);

  const columns = useMemo(
    () => statusOptions.map((opt) => ({ key: opt.id, label: opt.label, color: opt.color })),
    [statusOptions],
  );

  // Table rows are top-level tasks with their subtasks folded under them. While
  // a search or filter is on, a match has to surface wherever it sits in the
  // hierarchy. The board shows every task as a card, as the web board does.
  const tableTasksByStatus = useMemo(
    () => groupByStatus(columns, narrowed ? visibleTasks : visibleTasks.filter((t) => !t.parentId)),
    [columns, visibleTasks, narrowed],
  );
  const boardTasksByStatus = useMemo(
    () => groupByStatus(columns, visibleTasks),
    [columns, visibleTasks],
  );
  const tasksByStatus = activeView === "Board" ? boardTasksByStatus : tableTasksByStatus;

  const tasksFor = useCallback(
    (statusId: string) => tasksByStatus.get(statusId) ?? [],
    [tasksByStatus],
  );

  const canEdit = !!project && roleCanEdit(project.userRole);

  const dragColumns = useMemo(
    () =>
      columns.map((col) => ({
        statusId: col.key,
        // A collapsed group has no cards on screen, so the only slot it offers
        // is the top of the column - which is what dropping on its header means.
        taskIds:
          activeView === "Table" && collapsed.includes(col.key)
            ? []
            : (tasksByStatus.get(col.key) ?? []).map((t) => t.id),
      })),
    [activeView, collapsed, columns, tasksByStatus],
  );

  const handleDrop = useCallback(
    (taskId: string, target: DropTarget) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      const visible = tasksByStatus.get(target.statusId) ?? [];
      const currentIndex = visible.findIndex((t) => t.id === taskId);
      // Either slot next to where the card already sits leaves it where it is.
      if (
        task.status === target.statusId &&
        (target.index === currentIndex || target.index === currentIndex + 1)
      ) {
        return;
      }

      // The card is still rendered in its old slot while it is lifted, so the
      // row it lands after is the nearest one above that is not the card itself.
      let above = target.index - 1;
      while (above >= 0 && visible[above].id === taskId) above -= 1;

      const moves = planTaskMove({
        task,
        status: target.statusId,
        destination: tasks.filter((t) => t.status === target.statusId),
        after: above >= 0 ? visible[above] : null,
      });
      moveTasks.mutate({ projectId: id, moves });
    },
    [id, moveTasks, tasks, tasksByStatus],
  );

  const drag = useTaskDrag({
    enabled: canEdit && !selecting,
    axis: activeView === "Board" ? "horizontal" : "vertical",
    // Board cards are spaced apart; table rows sit flush against each other.
    itemGap: activeView === "Board" ? CARD_GAP : 0,
    columns: dragColumns,
    onDrop: handleDrop,
  });

  const draggedTask = drag.draggingId ? tasks.find((t) => t.id === drag.draggingId) : undefined;

  const toggleSelected = (taskId: string) =>
    setSelectedIds((prev) =>
      prev.includes(taskId) ? prev.filter((t) => t !== taskId) : [...prev, taskId],
    );

  const clearSelection = () => {
    setSelectionMode(false);
    setSelectedIds([]);
  };

  const toggleCollapsed = (statusId: string) =>
    setCollapsed((prev) =>
      prev.includes(statusId) ? prev.filter((s) => s !== statusId) : [...prev, statusId],
    );

  /**
   * Takes the whole group, and takes it away again once it is all picked - the
   * way to undo an over-eager tap is the same tap.
   */
  const toggleGroup = (statusId: string) => {
    const groupIds = (tasksByStatus.get(statusId) ?? []).map((t) => t.id);
    if (groupIds.length === 0) return;
    setSelectionMode(true);
    setSelectedIds((prev) => {
      const allPicked = groupIds.every((taskId) => prev.includes(taskId));
      if (allPicked) return prev.filter((taskId) => !groupIds.includes(taskId));
      return [...prev, ...groupIds.filter((taskId) => !prev.includes(taskId))];
    });
  };

  const openTask = useCallback(
    (taskId: string) => router.push(`/projects/task/${taskId}` as any),
    [],
  );

  const toggleExpanded = useCallback(
    (taskId: string) =>
      setExpansion((prev) => {
        const current = prev.projectId === id ? prev.taskIds : [];
        return {
          projectId: id,
          taskIds: current.includes(taskId)
            ? current.filter((t) => t !== taskId)
            : [...current, taskId],
        };
      }),
    [id],
  );

  // A tap opens the task, unless selection mode is on, where it picks instead.
  const openOrSelect = (taskId: string) => {
    if (selecting) toggleSelected(taskId);
    else openTask(taskId);
  };

  const runBulk = (changes: { status?: string; priority?: string; assigneeIds?: string[] }) => {
    bulkUpdateTasks.mutate(
      { projectId: id, taskIds: selectedIds, ...changes },
      {
        onSuccess: clearSelection,
      },
    );
  };

  if (projectQuery.isLoading) {
    return (
      <View style={[styles.container, styles.loadingContainer, { backgroundColor: T.pageBg }]}>
        <ActivityIndicator size="large" color={T.accent} />
      </View>
    );
  }

  if (!project) {
    return (
      <ScreenError
        title="Project"
        icon="projects"
        color={T.accent}
        onRetry={() => projectQuery.refetch()}
      />
    );
  }

  // The project's own color identifies the project - the header tile, the icon
  // on its card - while every interactive surface stays on the app accent, the
  // way the other domains do it.
  const projectColor = project.color || T.accent;

  const dragOverlay = draggedTask ? (
    <TaskDragPreview
      task={draggedTask}
      priorityOptions={priorityOptions}
      accentColor={T.accent}
      style={drag.previewStyle}
    />
  ) : null;

  return (
    <View style={[styles.container, { backgroundColor: T.pageBg }]}>
      <DomainHeader
        title={project.name}
        color={projectColor}
        icon="projects"
        subtitle={`${stats.progress}% complete`}
        rightActions={
          <>
            <CommentButton
              contentType={ContentType.PROJECT}
              contentId={project.id}
              color={T.accent}
            />
            <ShareButton
              contentType={ContentType.PROJECT}
              contentId={project.id}
              color={T.accent}
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
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.viewTabsScroll}
          contentContainerStyle={styles.viewTabsContent}
        >
          {VIEWS.map((view) => {
            const isActive = activeView === view;
            return (
              <TouchableOpacity
                key={view}
                style={[
                  styles.viewTab,
                  isActive
                    ? { backgroundColor: T.accent }
                    : {
                        backgroundColor: T.surface,
                        borderColor: T.border,
                        borderWidth: StyleSheet.hairlineWidth,
                      },
                ]}
                onPress={() => setActiveView(view)}
                activeOpacity={0.7}
              >
                <Text style={[styles.viewTabText, { color: isActive ? "#fff" : T.textDim }]}>
                  {view}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
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
              backgroundColor: filterCount > 0 ? T.accent + "18" : T.pageBg,
              borderColor: filterCount > 0 ? T.accent : T.border,
            },
          ]}
          onPress={() => setFilterOpen(true)}
          activeOpacity={0.7}
        >
          <Funnel
            size={16}
            color={filterCount > 0 ? T.accent : T.textDim}
            weight={filterCount > 0 ? "fill" : "duotone"}
          />
          {filterCount > 0 && (
            <Text style={[styles.filterCount, { color: T.accent }]}>{filterCount}</Text>
          )}
        </TouchableOpacity>
        {canEdit && inColumnView && (
          <TouchableOpacity
            style={[
              styles.filterBtn,
              {
                backgroundColor: selecting ? T.accent + "18" : T.pageBg,
                borderColor: selecting ? T.accent : T.border,
              },
            ]}
            onPress={() => (selecting ? clearSelection() : setSelectionMode(true))}
            activeOpacity={0.7}
          >
            <CheckCircle
              size={16}
              color={selecting ? T.accent : T.textDim}
              weight={selecting ? "fill" : "duotone"}
            />
          </TouchableOpacity>
        )}
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
            <Text style={[styles.narrowedReset, { color: T.accent }]}>Reset</Text>
          </TouchableOpacity>
        </View>
      )}

      {activeView === "Table" ? (
        <ProjectTableView
          columns={columns}
          tasksFor={tasksFor}
          relations={relations}
          projectSlug={project.slug}
          statusOptions={statusOptions}
          priorityOptions={priorityOptions}
          accentColor={T.accent}
          bottomPad={bottomPad}
          narrowed={narrowed}
          noMatches={narrowed && visibleTasks.length === 0}
          selecting={selecting}
          selectedIds={selectedIds}
          collapsed={collapsed}
          expanded={expanded}
          drag={drag}
          overlay={dragOverlay}
          onOpen={openOrSelect}
          onOpenParent={openTask}
          onToggleSelect={toggleSelected}
          onToggleGroup={toggleGroup}
          onToggleCollapsed={toggleCollapsed}
          onToggleExpand={toggleExpanded}
          onAddTask={() =>
            router.push({ pathname: "/projects/task/create" as any, params: { projectId: id } })
          }
        />
      ) : activeView === "Board" ? (
        <ProjectBoardView
          columns={columns}
          relations={relations}
          projectSlug={project.slug}
          tasksFor={tasksFor}
          priorityOptions={priorityOptions}
          accentColor={T.accent}
          bottomPad={bottomPad}
          selecting={selecting}
          selectedIds={selectedIds}
          drag={drag}
          overlay={dragOverlay}
          onOpen={openOrSelect}
          onToggleSelect={toggleSelected}
          onToggleGroup={toggleGroup}
          onOpenParent={openTask}
          onAddTask={(status) =>
            router.push({
              pathname: "/projects/task/create" as any,
              params: { projectId: id, status },
            })
          }
        />
      ) : activeView === "Roadmap" ? (
        <ProjectRoadmapView
          tasks={visibleTasks}
          relations={relations}
          projectSlug={project.slug}
          statusOptions={statusOptions}
          accentColor={T.accent}
          bottomPad={bottomPad}
          onOpenTask={openTask}
        />
      ) : activeView === "Backlog" ? (
        <ProjectBacklogView
          project={project}
          tasks={visibleTasks}
          allTasks={tasks}
          relations={relations}
          statusOptions={statusOptions}
          priorityOptions={priorityOptions}
          accentColor={T.accent}
          bottomPad={bottomPad}
          canEdit={canEdit}
          onOpenTask={openTask}
        />
      ) : (
        <ProjectGraphView
          project={project}
          tasks={visibleTasks}
          relations={relations}
          statusOptions={statusOptions}
          priorityOptions={priorityOptions}
          accentColor={T.accent}
          navInset={navSpace}
          onOpenTask={openTask}
        />
      )}

      {selecting && (
        <View
          style={[
            styles.bulkBar,
            { backgroundColor: T.bg, borderColor: T.border, bottom: navSpace },
          ]}
          onLayout={(event) => setBulkBarHeight(event.nativeEvent.layout.height)}
        >
          <View style={styles.bulkHeader}>
            <Text style={[styles.bulkCount, { color: T.textBright }]}>
              {selectedIds.length > 0
                ? `${selectedIds.length} selected`
                : "Tap tasks, or a status to take the group"}
            </Text>
            <TouchableOpacity
              onPress={clearSelection}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.bulkCancel, { color: T.accent }]}>Done</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.bulkActions}>
            <TouchableOpacity
              style={styles.bulkAction}
              onPress={() => setBulkSheet("status")}
              activeOpacity={0.7}
              disabled={selectedIds.length === 0}
            >
              <CheckCircle size={19} color={T.text} weight="duotone" />
              <Text style={[styles.bulkActionText, { color: T.text }]}>Status</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.bulkAction}
              onPress={() => setBulkSheet("priority")}
              activeOpacity={0.7}
              disabled={selectedIds.length === 0}
            >
              <Flag size={19} color={T.text} weight="duotone" />
              <Text style={[styles.bulkActionText, { color: T.text }]}>Priority</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.bulkAction}
              onPress={() => setBulkSheet("assignees")}
              activeOpacity={0.7}
              disabled={selectedIds.length === 0}
            >
              <Users size={19} color={T.text} weight="duotone" />
              <Text style={[styles.bulkActionText, { color: T.text }]}>Assign</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.bulkAction}
              activeOpacity={0.7}
              disabled={selectedIds.length === 0}
              onPress={() =>
                confirmDestructive({
                  title: "Delete tasks",
                  message: `${selectedIds.length} task${selectedIds.length === 1 ? "" : "s"} will be moved to the trash.`,
                  onConfirm: () =>
                    deleteTasks.mutate(
                      { projectId: id, taskIds: selectedIds },
                      { onSuccess: clearSelection },
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
        accentColor={T.accent}
        onSelect={(status) => runBulk({ status })}
      />

      <OptionPickerSheet
        visible={bulkSheet === "priority"}
        onClose={() => setBulkSheet(null)}
        title={`Set priority for ${selectedIds.length}`}
        options={priorityOptions}
        selectedId={undefined}
        accentColor={T.accent}
        onSelect={(priority) => runBulk({ priority })}
      />

      <SubjectPickerSheet
        visible={bulkSheet === "assignees"}
        onClose={() => setBulkSheet(null)}
        title={`Assign ${selectedIds.length} task${selectedIds.length === 1 ? "" : "s"}`}
        selectedIds={[]}
        accentColor={T.accent}
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
        accentColor={T.accent}
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
              navigateFromMenu(() =>
                router.push({ pathname: "/projects/create" as any, params: { projectId: id } }),
              ),
          },
          {
            icon: "users",
            label: "Resources",
            sublabel: "Tasks and time per assignee",
            onPress: () =>
              navigateFromMenu(() =>
                router.push({ pathname: "/projects/resources" as any, params: { projectId: id } }),
              ),
          },
          {
            icon: "settings",
            label: "Project settings",
            sublabel: "Statuses, members, access",
            onPress: () =>
              navigateFromMenu(() =>
                router.push({ pathname: "/projects/settings" as any, params: { id } }),
              ),
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
  viewTabs: { borderBottomWidth: StyleSheet.hairlineWidth },
  // Without flexGrow: 0 the row claims the rest of the column, not just its own height.
  viewTabsScroll: { flexGrow: 0 },
  viewTabsContent: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  viewTab: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  viewTabText: { fontSize: 13, fontFamily: FONT.medium },
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
  // Floats clear of the nav rather than sitting on the screen edge, so the
  // glass bar cannot cover the actions.
  bulkBar: {
    position: "absolute",
    left: 12,
    right: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10,
  },
  bulkHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  bulkCount: { fontSize: 14, fontFamily: FONT.semibold },
  bulkCancel: { fontSize: 14, fontFamily: FONT.semibold },
  bulkActions: { flexDirection: "row", justifyContent: "space-around" },
  bulkAction: { alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 4 },
  bulkActionText: { fontSize: 11, fontFamily: FONT.medium },
});
