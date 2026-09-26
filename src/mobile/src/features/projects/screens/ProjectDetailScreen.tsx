import React, { useCallback, useRef, useState, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
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
  SlidersHorizontal,
  ChartBar,
} from "phosphor-react-native";
import { create } from "@bufbuild/protobuf";
import { ViewDefinitionSchema } from "@uniffy/proto/projects/v1/projects_pb";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { DomainHeader } from "@shared/components/DomainHeader";
import { ScreenError } from "@shared/components/ScreenError";
import { CommentButton } from "@shared/comments/CommentsSheet";
import { ShareButton } from "@shared/permissions/ShareSheet";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { ActionSheet } from "@shared/components/ActionSheet";
import { NamePromptSheet } from "@shared/components/NamePromptSheet";
import { confirmDestructive } from "@shared/lib/confirmDestructive";
import { roleCanEdit } from "@shared/permissions/contentRoles";
import { useTheme } from "@shared/hooks/useTheme";
import { bottomBarBlockHeight } from "@shared/components/BottomNav";
import { BOTTOM_NAV_HEIGHT } from "@theme/theme";
import { FONT } from "@theme/typography";
import { SubjectPickerSheet } from "@shared/directory/SubjectPickerSheet";
import { useDateTimePrefs } from "@core/datetimePrefs";
import { zonedDayKey } from "@shared/lib/zonedTime";
import { useDirectory } from "@shared/directory/useDirectory";
import {
  useProject,
  useProjectSprints,
  useProjectTasks,
  useViewTasks,
} from "@features/projects/useProjects";
import {
  useDeleteProject,
  useBulkUpdateTasks,
  useDeleteTasks,
  useDropTaskOnGroup,
  useMoveTasks,
} from "@features/projects/useProjectMutations";
import { useProjectViews } from "@features/projects/useProjectViews";
import { OptionPickerSheet } from "@features/projects/components/OptionPickerSheet";
import {
  getStatusOptions,
  getPriorityOptions,
  computeProjectStats,
} from "@features/projects/projectsSerializer";
import { TaskFilterSheet } from "@features/projects/components/TaskFilterSheet";
import { TaskDisplaySheet } from "@features/projects/components/TaskDisplaySheet";
import { ViewTabs } from "@features/projects/components/ViewTabs";
import { ProjectBoardView, CARD_GAP } from "@features/projects/components/ProjectBoardView";
import { ProjectTableView } from "@features/projects/components/ProjectTableView";
import { ProjectRoadmapView } from "@features/projects/components/ProjectRoadmapView";
import { ProjectBacklogView } from "@features/projects/components/ProjectBacklogView";
import { ProjectGraphView } from "@features/projects/components/ProjectGraphView";
import { TaskDragPreview } from "@features/projects/components/TaskDragPreview";
import { useTaskDrag } from "@features/projects/useTaskDrag";
import { planTaskMove } from "@features/projects/taskOrdering";
import { buildTaskRelations } from "@features/projects/taskRelations";
import { narrowTasks } from "@features/projects/taskFilters";
import { TASK_TYPES } from "@features/projects/taskTypes";
import { activeFacetCount, readFacets } from "@features/projects/viewFacets";
import { shapesResults, withFilter, isDescending } from "@features/projects/viewDefinition";
import { tasksForView, usesTaskOutline } from "@features/projects/viewResults";
import {
  buildTaskGroups,
  dimensionKey,
  dimensionOf,
  isMultiValued,
} from "@features/projects/taskGrouping";
import type { DropTarget } from "@features/projects/useTaskDrag";
import type { GroupDimension, TaskGroup } from "@features/projects/taskGrouping";
import type { SerializedTask, SerializedView } from "@features/projects/projectsSerializer";

/** The layouts built from groups of rows or cards, and so the only ones that drag or select. */
const COLUMN_LAYOUTS: ReadonlySet<SerializedView["layout"]> = new Set(["table", "board"]);

/** Groupings where a drop writes the group's value to the task. */
const DROP_DIMENSIONS: ReadonlySet<GroupDimension["kind"]> = new Set([
  "status",
  "priority",
  "sprint",
  "select",
]);

const STATUS_DIMENSION: GroupDimension = { kind: "status" };
const EMPTY_DEFINITION = create(ViewDefinitionSchema);

function groupByStatus(
  columns: { key: string }[],
  tasks: SerializedTask[],
): Map<string, SerializedTask[]> {
  const byStatus = new Map<string, SerializedTask[]>();
  for (const col of columns) {
    byStatus.set(
      col.key,
      tasks.filter((t) => t.status === col.key),
    );
  }
  return byStatus;
}

export function ProjectBoardScreen() {
  const { id, view: linkedViewId } = useLocalSearchParams<{ id: string; view?: string }>();
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const { byId: directory } = useDirectory();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [viewMenu, setViewMenu] = useState<SerializedView | null>(null);
  const [namePrompt, setNamePrompt] = useState<
    { kind: "saveAs" } | { kind: "rename"; view: SerializedView } | null
  >(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Keyed by grouping, so switching what the table groups by starts unfolded.
  const [collapsedState, setCollapsedState] = useState<{ dimension: string; keys: string[] }>({
    dimension: "status",
    keys: [],
  });
  // Keyed by project, so a screen reused for another project starts folded.
  const [expansion, setExpansion] = useState<{ projectId: string; taskIds: string[] }>({
    projectId: id,
    taskIds: [],
  });
  const [bulkBarHeight, setBulkBarHeight] = useState(0);
  const [bulkSheet, setBulkSheet] = useState<"status" | "priority" | "assignees" | null>(null);

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
  const sprintsQuery = useProjectSprints(id);
  const deleteProject = useDeleteProject();
  const bulkUpdateTasks = useBulkUpdateTasks();
  const deleteTasks = useDeleteTasks();
  const moveTasks = useMoveTasks();
  const dropOnGroup = useDropTaskOnGroup();

  const project = projectQuery.data;
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const sprints = useMemo(() => sprintsQuery.data ?? [], [sprintsQuery.data]);
  const views = useProjectViews(project, linkedViewId);
  const activeView = views.active;
  const layout = activeView?.layout ?? "table";
  const definition = views.definition ?? EMPTY_DEFINITION;
  const viewTasksQuery = useViewTasks(id, definition, project?.fieldDefinitions);
  const { timeZone, weekStartsOn } = useDateTimePrefs();
  const today = zonedDayKey(new Date(), timeZone);

  // The router slides screen content under the floating nav, so the bulk bar
  // is parked on top of that block rather than at the bottom of the screen.
  const navSpace = bottomBarBlockHeight(insets.bottom);

  const inColumnView = COLUMN_LAYOUTS.has(layout);
  const selecting = inColumnView && (selectionMode || selectedIds.length > 0);
  const bottomPad =
    (Platform.OS === "web" ? BOTTOM_NAV_HEIGHT + 34 : BOTTOM_NAV_HEIGHT + insets.bottom) +
    (selecting ? bulkBarHeight : 0);

  const statusOptions = useMemo(() => (project ? getStatusOptions(project) : []), [project]);
  const priorityOptions = useMemo(() => (project ? getPriorityOptions(project) : []), [project]);
  // Progress reads the whole project, not the open view - the header would
  // otherwise claim the project is complete the moment a view shows only Done.
  const stats = useMemo(() => computeProjectStats(tasks), [tasks]);
  // Over every loaded task: a parent or blocker the view leaves out still counts.
  const relations = useMemo(() => buildTaskRelations(tasks), [tasks]);
  const expanded = expansion.projectId === id ? expansion.taskIds : [];

  const facetReading = useMemo(() => readFacets(definition.filter), [definition.filter]);
  const filterCount = activeFacetCount(facetReading.facets) + facetReading.advancedCount;
  const sorted = definition.sort.length > 0;
  const displayCount = (sorted ? 1 : 0) + (layout === "table" && definition.groupBy ? 1 : 0);
  const serverShaped = shapesResults(definition);
  const awaitingView = serverShaped && !viewTasksQuery.data && !viewTasksQuery.isError;

  const viewTasks = useMemo(
    () => tasksForView(tasks, viewTasksQuery.data, definition),
    [tasks, viewTasksQuery.data, definition],
  );

  const narrowed = query.trim().length > 0 || (definition.filter?.nodes.length ?? 0) > 0;
  const outline = usesTaskOutline(definition, narrowed);
  const visibleTasks = useMemo(
    () => narrowTasks(viewTasks, query, facetReading.facets),
    [viewTasks, query, facetReading.facets],
  );

  const columns = useMemo(
    () => statusOptions.map((opt) => ({ key: opt.id, label: opt.label, color: opt.color })),
    [statusOptions],
  );
  const statusColors = useMemo(
    () => new Map(statusOptions.map((opt) => [opt.id, opt.color])),
    [statusOptions],
  );
  const statusColorOf = useCallback(
    (task: SerializedTask) => statusColors.get(task.status) ?? T.textDim,
    [statusColors, T.textDim],
  );

  const fields = useMemo(() => project?.fieldDefinitions ?? [], [project]);
  const dimension = useMemo(
    () => dimensionOf(definition.groupBy, fields) ?? STATUS_DIMENSION,
    [definition.groupBy, fields],
  );
  const dimensionId = dimensionKey(dimension);
  const collapsed = useMemo(
    () => (collapsedState.dimension === dimensionId ? collapsedState.keys : []),
    [collapsedState, dimensionId],
  );

  // Search and flat views surface child rows without nesting them under parents.
  const tableGroups = useMemo<TaskGroup[]>(
    () =>
      buildTaskGroups(
        outline ? visibleTasks.filter((t) => !t.parentId) : visibleTasks,
        dimension,
        {
          statusOptions,
          priorityOptions,
          fields,
          sprints,
          taskTypes: TASK_TYPES,
          nameOf: (subjectId) => directory.get(subjectId)?.name ?? "Unknown",
          today,
          weekStartsOn,
        },
        {
          hideEmpty: definition.groupBy?.hideEmpty ?? false,
          descending: !!definition.groupBy && isDescending(definition.groupBy.direction),
        },
      ),
    [
      outline,
      visibleTasks,
      dimension,
      statusOptions,
      priorityOptions,
      fields,
      sprints,
      directory,
      definition.groupBy,
      today,
      weekStartsOn,
    ],
  );
  // The board shows every task as a card, as the web board does.
  const boardTasksByStatus = useMemo(
    () => groupByStatus(columns, visibleTasks),
    [columns, visibleTasks],
  );

  const groupTasks = useCallback(
    (key: string) =>
      layout === "board"
        ? (boardTasksByStatus.get(key) ?? [])
        : (tableGroups.find((group) => group.key === key)?.tasks ?? []),
    [layout, boardTasksByStatus, tableGroups],
  );

  const canEdit = !!project && roleCanEdit(project.userRole);
  // Several values per task, or none a drop could write: the rows stay put.
  const dragDimension =
    layout === "board" || (DROP_DIMENSIONS.has(dimension.kind) && !isMultiValued(dimension));

  const dragColumns = useMemo(() => {
    if (!dragDimension) return [];
    const keys = layout === "board" ? columns.map((col) => col.key) : tableGroups.map((g) => g.key);
    return keys.map((key) => ({
      columnKey: key,
      // A collapsed group has no cards on screen, so the only slot it offers
      // is the top of the column - which is what dropping on its header means.
      taskIds:
        layout === "table" && collapsed.includes(key) ? [] : groupTasks(key).map((t) => t.id),
    }));
  }, [dragDimension, layout, columns, tableGroups, collapsed, groupTasks]);

  const handleDrop = useCallback(
    (taskId: string, target: DropTarget) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      const visible = groupTasks(target.columnKey);
      const currentIndex = visible.findIndex((t) => t.id === taskId);
      if (layout === "table") {
        const drop = tableGroups.find((g) => g.key === target.columnKey)?.drop;
        if (!drop) return;
        if (drop.kind !== "status") {
          // Order inside a priority, sprint or custom group is the manual order,
          // which only the status groups edit; a drop there writes the value alone.
          if (currentIndex < 0) dropOnGroup.mutate({ projectId: id, taskId, drop });
          return;
        }
      }

      // Either slot next to where the card already sits leaves it where it is,
      // and in a sorted view the sort, not the drop, decides where it sits.
      if (
        task.status === target.columnKey &&
        (sorted || target.index === currentIndex || target.index === currentIndex + 1)
      ) {
        return;
      }

      // The card is still rendered in its old slot while it is lifted, so the
      // row it lands after is the nearest one above that is not the card itself.
      let above = target.index - 1;
      while (above >= 0 && visible[above].id === taskId) above -= 1;

      const moves = planTaskMove({
        task,
        status: target.columnKey,
        destination: tasks.filter((t) => t.status === target.columnKey),
        after: above >= 0 ? visible[above] : null,
      });
      moveTasks.mutate({ projectId: id, moves });
    },
    [id, layout, sorted, moveTasks, dropOnGroup, tasks, groupTasks, tableGroups],
  );

  const drag = useTaskDrag({
    enabled: canEdit && !selecting && dragDimension,
    axis: layout === "board" ? "horizontal" : "vertical",
    // Board cards are spaced apart; table rows sit flush against each other.
    itemGap: layout === "board" ? CARD_GAP : 0,
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

  const toggleCollapsed = (groupKey: string) =>
    setCollapsedState({
      dimension: dimensionId,
      keys: collapsed.includes(groupKey)
        ? collapsed.filter((key) => key !== groupKey)
        : [...collapsed, groupKey],
    });

  /**
   * Takes the whole group, and takes it away again once it is all picked - the
   * way to undo an over-eager tap is the same tap.
   */
  const toggleGroup = (groupKey: string) => {
    const groupIds = groupTasks(groupKey).map((t) => t.id);
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

  const selectView = (viewId: string) => {
    clearSelection();
    views.select(viewId);
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

      <ViewTabs
        views={views.views}
        activeId={activeView?.id}
        dirty={views.dirty}
        onSelect={selectView}
        onLongPress={(view) => {
          if (views.ownsView(view)) setViewMenu(view);
        }}
      />

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
        {layout !== "resources" && (
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
            accessibilityLabel="Filter"
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
        )}
        {layout !== "resources" && (
          <TouchableOpacity
            style={[
              styles.filterBtn,
              {
                backgroundColor: displayCount > 0 ? T.accent + "18" : T.pageBg,
                borderColor: displayCount > 0 ? T.accent : T.border,
              },
            ]}
            onPress={() => setDisplayOpen(true)}
            activeOpacity={0.7}
            accessibilityLabel="Group and sort"
          >
            <SlidersHorizontal
              size={16}
              color={displayCount > 0 ? T.accent : T.textDim}
              weight={displayCount > 0 ? "fill" : "duotone"}
            />
          </TouchableOpacity>
        )}
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

      {views.dirty && activeView && (
        <View style={[styles.draftBar, { backgroundColor: T.bg, borderBottomColor: T.border }]}>
          <Text style={[styles.draftText, { color: T.textDim }]} numberOfLines={1}>
            Unsaved changes
          </Text>
          <TouchableOpacity
            onPress={views.discard}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.draftAction, { color: T.textDim }]}>Discard</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setNamePrompt({ kind: "saveAs" })}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={[styles.draftAction, { color: T.accent }]}>Save as new</Text>
          </TouchableOpacity>
          {views.ownsView(activeView) && (
            <TouchableOpacity
              onPress={views.save}
              disabled={views.saving}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.draftAction, { color: views.saving ? T.textDim : T.accent }]}>
                Save
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {(narrowed || awaitingView || viewTasksQuery.isError) && layout !== "resources" && (
        <View style={styles.narrowedBar}>
          {viewTasksQuery.isError ? (
            <Text style={[styles.narrowedText, { color: T.red }]}>
              This view could not be loaded
            </Text>
          ) : (
            <Text style={[styles.narrowedText, { color: T.textDim }]}>
              {awaitingView
                ? "Loading the view"
                : `${visibleTasks.length} matching task${visibleTasks.length === 1 ? "" : "s"}`}
            </Text>
          )}
          {viewTasksQuery.isFetching && serverShaped && (
            <ActivityIndicator size="small" color={T.textDim} />
          )}
          <View style={styles.fill} />
          {viewTasksQuery.isError ? (
            <TouchableOpacity
              onPress={() => viewTasksQuery.refetch()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.narrowedReset, { color: T.accent }]}>Retry</Text>
            </TouchableOpacity>
          ) : query.length > 0 ? (
            <TouchableOpacity
              onPress={() => setQuery("")}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.narrowedReset, { color: T.accent }]}>Clear search</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      )}

      {!activeView || (awaitingView && layout !== "resources") ? (
        <View style={[styles.fill, styles.loadingContainer]}>
          <ActivityIndicator size="large" color={T.accent} />
        </View>
      ) : layout === "resources" ? (
        <View style={[styles.fill, styles.placeholder]}>
          <ChartBar size={32} color={T.textDim} weight="duotone" />
          <Text style={[styles.placeholderTitle, { color: T.textBright }]}>Resource view</Text>
          <Text style={[styles.placeholderText, { color: T.textDim }]}>
            Workload per person has its own screen on the phone.
          </Text>
          <TouchableOpacity
            style={[styles.placeholderBtn, { backgroundColor: T.accent }]}
            activeOpacity={0.8}
            onPress={() =>
              router.push({ pathname: "/projects/resources" as any, params: { projectId: id } })
            }
          >
            <Text style={styles.placeholderBtnText}>Open resources</Text>
          </TouchableOpacity>
        </View>
      ) : layout === "table" ? (
        <ProjectTableView
          groups={tableGroups}
          statusColorOf={statusColorOf}
          relations={relations}
          projectSlug={project.slug}
          statusOptions={statusOptions}
          priorityOptions={priorityOptions}
          accentColor={T.accent}
          bottomPad={bottomPad}
          narrowed={narrowed}
          outline={outline}
          noMatches={narrowed && !awaitingView && visibleTasks.length === 0}
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
      ) : layout === "board" ? (
        <ProjectBoardView
          columns={columns}
          relations={relations}
          projectSlug={project.slug}
          tasksFor={groupTasks}
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
      ) : layout === "roadmap" ? (
        <ProjectRoadmapView
          tasks={visibleTasks}
          relations={relations}
          projectSlug={project.slug}
          statusOptions={statusOptions}
          accentColor={T.accent}
          bottomPad={bottomPad}
          onOpenTask={openTask}
        />
      ) : layout === "backlog" ? (
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
        filter={definition.filter}
        onChange={(filter) => views.editDraft(withFilter(definition, filter))}
        tasks={tasks}
        statusOptions={statusOptions}
        priorityOptions={priorityOptions}
        sprints={sprints}
        accentColor={T.accent}
      />

      <TaskDisplaySheet
        visible={displayOpen}
        onClose={() => setDisplayOpen(false)}
        layout={layout}
        definition={definition}
        onChange={views.editDraft}
        fields={fields}
        accentColor={T.accent}
      />

      <ActionSheet
        visible={viewMenu !== null}
        onClose={() => setViewMenu(null)}
        title={viewMenu?.name ?? ""}
        subtitle="Personal view"
        icon="user"
        iconColor={T.accent}
        actions={
          viewMenu
            ? [
                {
                  icon: "edit-2",
                  label: "Rename view",
                  onPress: () => setNamePrompt({ kind: "rename", view: viewMenu }),
                },
                {
                  icon: "trash-2",
                  label: "Delete view",
                  isDanger: true,
                  onPress: () =>
                    confirmDestructive({
                      title: "Delete view",
                      message: `"${viewMenu.name}" will be deleted. Tasks are not affected.`,
                      onConfirm: () => views.remove(viewMenu),
                    }),
                },
              ]
            : []
        }
      />

      <NamePromptSheet
        visible={namePrompt !== null}
        title={namePrompt?.kind === "rename" ? "Rename view" : "Save as a personal view"}
        cta={namePrompt?.kind === "rename" ? "Rename" : "Save"}
        initialName={
          namePrompt?.kind === "rename"
            ? namePrompt.view.name
            : activeView
              ? `${activeView.name} (copy)`
              : ""
        }
        placeholder="View name"
        pending={views.saving}
        accentColor={T.accent}
        onClose={() => setNamePrompt(null)}
        onSubmit={(name) => {
          const close = () => setNamePrompt(null);
          if (namePrompt?.kind === "rename") views.rename(namePrompt.view, name, close);
          else views.saveAsNew(name, close);
        }}
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
  fill: { flex: 1 },
  draftBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 18,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  draftText: { flex: 1, fontSize: 13, fontFamily: FONT.regular },
  draftAction: { fontSize: 14, fontFamily: FONT.semibold },
  placeholder: { alignItems: "center", justifyContent: "center", gap: 10, padding: 32 },
  placeholderTitle: { fontSize: 16, fontFamily: FONT.semibold },
  placeholderText: { fontSize: 13, fontFamily: FONT.regular, textAlign: "center" },
  placeholderBtn: { marginTop: 6, paddingHorizontal: 18, paddingVertical: 11, borderRadius: 10 },
  placeholderBtnText: { color: "#fff", fontSize: 14, fontFamily: FONT.semibold },
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
    gap: 8,
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
