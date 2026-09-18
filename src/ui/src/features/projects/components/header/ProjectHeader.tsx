import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  MagnifyingGlass,
  Table,
  Columns,
  ChartLine,
  Trash,
  X,
  Funnel,
  SquaresFour,
  CaretDown,
  Plus,
  Archive,
  ShareNetwork,
  SidebarSimple,
  Users,
  FrameCorners,
  Gear,
  TreeView,
  SlidersHorizontal,
} from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  PaneHeader,
  PaneHeaderBar,
  PaneHeaderControls,
  PaneIconButton,
} from "@/components/ui/pane-header";
import { popoverShellClass } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  setViewMode,
  setSearchQuery,
  setFilterConfig,
  setGroupBy,
  setSprintFilter,
  setTaskTypeFilter,
  setTableOutlineEnabled,
  setRootOnlyFilter,
  setInEpicFilter,
  selectViewMode,
  selectSearchQuery,
  selectSelectedTaskIds,
  selectActiveFilterConfig,
  selectActiveGroupByFieldId,
  selectSprintFilter,
  selectTaskTypeFilter,
  selectTableOutlineEnabled,
  selectRootOnlyFilter,
  selectInEpicFilter,
  clearSelection,
  openCreateTaskModal,
  toggleSidebar,
  selectIsSidebarOpen,
  setDetailViewMode,
  selectDetailViewMode,
} from "@/features/projects/store/projectsUiSlice";
import { deleteTasks, bulkUpdateTasksThunk } from "@/features/projects/store/projectsThunks";
import { ProjectIcon } from "@/features/projects/utils/projectIcons";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import { statusPaint } from "@/features/projects/utils/statusPaint";
import type { Project, ViewType } from "@/features/projects/types";
import { FilterBuilder } from "@/features/projects/components/views/table/FilterBuilder";
import { ManageStatusesDialog } from "@/features/projects/components/views/board/ManageStatusesDialog";
import {
  updateFieldDefinition,
  selectTasksForProject,
} from "@/features/projects/store/projectsSlice";
import { updateFieldThunk } from "@/features/projects/store/projectsThunks";
import {
  selectActiveSprint,
  selectSprintsForProject,
} from "@/features/projects/store/sprintsSlice";
import { TASK_TYPES } from "@/features/projects/utils/taskTypes";
import type { SelectOption, Sprint } from "@/features/projects/types";
import { useProjectPermission } from "@/features/projects/hooks/useProjectPermissions";
import { TagPicker } from "@/features/tags";
import { TAGS_FILTER_FIELD_ID } from "@/features/projects/utils/taskAttributeFields";
import type { FilterCondition } from "@/features/projects/types/views";
import type { AppDispatch } from "@/app/store";
import { randomUUID } from "@/shared/utils/uuid";

interface ProjectHeaderProps {
  project: Project;
}

interface Option {
  value: string | null;
  label: string;
}

const VIEWS: { value: ViewType; label: string; icon: React.ReactNode }[] = [
  { value: "table", label: "Table", icon: <Table size={16} /> },
  { value: "board", label: "Board", icon: <Columns size={16} /> },
  { value: "roadmap", label: "Roadmap", icon: <ChartLine size={16} /> },
  { value: "backlog", label: "Backlog", icon: <Archive size={16} /> },
  { value: "graph", label: "Graph", icon: <ShareNetwork size={16} /> },
  { value: "resources", label: "Resources", icon: <Users size={16} /> },
];

export function ProjectHeader({ project }: ProjectHeaderProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isMobile, isMobileOrTablet, isDesktop } = useBreakpoint();
  const viewMode = useAppSelector(selectViewMode);
  const searchQuery = useAppSelector(selectSearchQuery);
  const selectedTaskIds = useAppSelector(selectSelectedTaskIds);
  const activeFilterConfig = useAppSelector(selectActiveFilterConfig);
  const activeGroupByFieldId = useAppSelector(selectActiveGroupByFieldId);
  const isSidebarOpen = useAppSelector(selectIsSidebarOpen);
  const detailViewMode = useAppSelector(selectDetailViewMode);
  const { canEdit, canManage } = useProjectPermission();
  const activeSprint = useAppSelector(selectActiveSprint(project.id));
  const allSprints = useAppSelector(selectSprintsForProject(project.id));
  const sprintFilter = useAppSelector(selectSprintFilter);
  const taskTypeFilter = useAppSelector(selectTaskTypeFilter);
  const tableOutlineEnabled = useAppSelector(selectTableOutlineEnabled);
  const rootOnlyFilter = useAppSelector(selectRootOnlyFilter);
  const inEpicFilter = useAppSelector(selectInEpicFilter);
  const selectProjectTasks = useMemo(() => selectTasksForProject(project.id), [project.id]);
  const projectTasks = useAppSelector(selectProjectTasks);
  const epicOptions = useMemo(
    () =>
      projectTasks
        .filter((t) => t.taskType === "epic")
        .map((t) => ({ value: t.id, label: t.title })),
    [projectTasks],
  );
  const hasSprintsWithTasks = allSprints.some((s) => s.taskCount > 0);
  const [showDeleteTasksConfirm, setShowDeleteTasksConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isDisplayOpen, setIsDisplayOpen] = useState(false);
  const [isManageStatusesOpen, setIsManageStatusesOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Label visibility tracks the real control-bar width, not the viewport: the
  // surrounding panels are resizable, so a wide viewport can still leave the
  // bar narrow. Full labels only appear once the whole switcher fits.
  const controlBarRef = useRef<HTMLDivElement>(null);
  const [controlBarWidth, setControlBarWidth] = useState(0);
  useEffect(() => {
    const el = controlBarRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setControlBarWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // The row never wraps, so a narrower bar sheds labels: first the inactive views, then Filter and
  // Display (search starts shrinking), then the active view's.
  const viewLabels: ViewLabels =
    controlBarWidth === 0
      ? isDesktop
        ? "all"
        : "active"
      : controlBarWidth > 1040
        ? "all"
        : controlBarWidth >= 440
          ? "active"
          : "none";
  const compactControls = isMobile || (controlBarWidth > 0 && controlBarWidth < 720);

  const statusField = project.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.STATUS);
  const statusOptions = statusField?.config.options || [];

  const handleUpdateStatuses = (newOptions: SelectOption[]) => {
    if (!statusField) return;
    const updatedConfig = { ...statusField.config, options: newOptions };

    dispatch(
      updateFieldDefinition({
        projectId: project.id,
        fieldId: SYSTEM_FIELD_IDS.STATUS,
        changes: { config: updatedConfig },
      }),
    );

    dispatch(
      updateFieldThunk({
        projectId: project.id,
        fieldId: SYSTEM_FIELD_IDS.STATUS,
        updates: { config: updatedConfig },
      }),
    );
  };

  const handleViewChange = (view: ViewType) => {
    dispatch(setViewMode(view));
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    dispatch(setSearchQuery(e.target.value));
  };

  const handleDeleteTasks = async () => {
    setIsDeleting(true);
    try {
      await dispatch(deleteTasks(selectedTaskIds)).unwrap();
      dispatch(clearSelection());
    } finally {
      setIsDeleting(false);
      setShowDeleteTasksConfirm(false);
    }
  };

  const filterableFields = project.fieldDefinitions.filter((f) => f.id !== SYSTEM_FIELD_IDS.TITLE);

  const hasSelection = selectedTaskIds.length > 0;

  // Tags live inside the shared FilterConfig; pull them out so they can be
  // surfaced as their own quick control and chip.
  const tagCondition = activeFilterConfig?.conditions.find(
    (c) => c.fieldId === TAGS_FILTER_FIELD_ID,
  );
  const selectedTagIds: string[] = Array.isArray(tagCondition?.value)
    ? (tagCondition!.value as string[])
    : tagCondition?.value
      ? [String(tagCondition.value)]
      : [];
  const nonTagConditions = (activeFilterConfig?.conditions ?? []).filter(
    (c) => c.fieldId !== TAGS_FILTER_FIELD_ID,
  );

  const applyTags = useCallback(
    (nextTagIds: string[]) => {
      const others = (activeFilterConfig?.conditions ?? []).filter(
        (c) => c.fieldId !== TAGS_FILTER_FIELD_ID,
      );
      if (nextTagIds.length === 0) {
        dispatch(
          setFilterConfig(
            others.length === 0
              ? null
              : { conditions: others, logic: activeFilterConfig?.logic ?? "and" },
          ),
        );
        return;
      }
      const next: FilterCondition = {
        id: tagCondition?.id ?? randomUUID(),
        fieldId: TAGS_FILTER_FIELD_ID,
        operator: "contains",
        value: nextTagIds,
      };
      dispatch(
        setFilterConfig({
          conditions: [...others, next],
          logic: activeFilterConfig?.logic ?? "and",
        }),
      );
    },
    [activeFilterConfig, tagCondition, dispatch],
  );

  const clearBuilderConditions = useCallback(() => {
    const tagsOnly = (activeFilterConfig?.conditions ?? []).filter(
      (c) => c.fieldId === TAGS_FILTER_FIELD_ID,
    );
    dispatch(
      setFilterConfig(
        tagsOnly.length === 0
          ? null
          : { conditions: tagsOnly, logic: activeFilterConfig?.logic ?? "and" },
      ),
    );
  }, [activeFilterConfig, dispatch]);

  const sprintOptions: Option[] = useMemo(
    () => [
      { value: null, label: "All sprints" },
      { value: "__backlog__", label: "Backlog" },
      ...allSprints
        .filter((s) => s.status !== "closed")
        .map((s) => ({ value: s.id, label: s.name })),
    ],
    [allSprints],
  );
  const typeOptions: Option[] = useMemo(
    () => [
      { value: null, label: "All types" },
      ...TASK_TYPES.map((t) => ({ value: t.value, label: t.label })),
    ],
    [],
  );
  const epicFilterOptions: Option[] = useMemo(
    () => [{ value: null, label: "All tasks" }, ...epicOptions],
    [epicOptions],
  );

  const showSprintControl = hasSprintsWithTasks && viewMode !== "backlog";
  const showEpicControl = epicOptions.length > 0;
  const showGroupBy = viewMode === "table" || viewMode === "board";
  const showOutline = viewMode === "table";
  const showManageStatuses = viewMode === "board";

  const groupByOptions: Option[] = useMemo(() => {
    if (viewMode === "board") return BOARD_GROUP_BY_OPTIONS;
    return hasSprintsWithTasks
      ? GROUP_BY_OPTIONS
      : GROUP_BY_OPTIONS.filter((o) => o.value !== "__sprint__");
  }, [viewMode, hasSprintsWithTasks]);
  const groupByValue =
    viewMode === "board"
      ? activeGroupByFieldId === GROUP_BY_EPIC_KEY
        ? GROUP_BY_EPIC_KEY
        : null
      : activeGroupByFieldId;

  // Resolve human labels for the active-filter chips.
  const typeLabel = TASK_TYPES.find((t) => t.value === taskTypeFilter)?.label ?? taskTypeFilter;
  const sprintLabel =
    sprintFilter === "__backlog__"
      ? "Backlog"
      : (allSprints.find((s) => s.id === sprintFilter)?.name ?? sprintFilter);
  const epicLabel = epicOptions.find((e) => e.value === inEpicFilter)?.label ?? inEpicFilter;

  const activeFilterCount =
    nonTagConditions.length +
    (selectedTagIds.length > 0 ? 1 : 0) +
    (taskTypeFilter ? 1 : 0) +
    (sprintFilter ? 1 : 0) +
    (inEpicFilter ? 1 : 0) +
    (rootOnlyFilter ? 1 : 0);
  const hasActiveFilters = activeFilterCount > 0;

  const displayDirtyCount =
    (taskTypeFilter ? 1 : 0) +
    (sprintFilter && showSprintControl ? 1 : 0) +
    (inEpicFilter && showEpicControl ? 1 : 0) +
    (selectedTagIds.length > 0 ? 1 : 0) +
    (rootOnlyFilter ? 1 : 0) +
    (groupByValue && showGroupBy ? 1 : 0) +
    (tableOutlineEnabled && showOutline ? 1 : 0);

  const clearAllFilters = () => {
    dispatch(setTaskTypeFilter(null));
    dispatch(setSprintFilter(null));
    dispatch(setInEpicFilter(null));
    dispatch(setRootOnlyFilter(false));
    dispatch(setFilterConfig(null));
  };

  return (
    <>
      <PaneHeader>
        <PaneHeaderBar
          divided
          leading={
            isMobileOrTablet &&
            !isSidebarOpen && (
              <PaneIconButton
                onClick={() => dispatch(toggleSidebar())}
                className="text-primary"
                title="Show sidebar"
              >
                <SidebarSimple size={16} />
              </PaneIconButton>
            )
          }
          icon={
            <ProjectIcon
              icon={project.icon}
              size={isMobile ? 16 : 20}
              weight="duotone"
              className="text-primary shrink-0"
            />
          }
          title={project.name}
        >
          {canEdit && (
            <Button
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={() => dispatch(openCreateTaskModal())}
            >
              <Plus size={16} weight="bold" />
              {!isMobile && "New Task"}
            </Button>
          )}

          <SegmentedControl
            className="hidden md:flex"
            ariaLabel="Task detail view"
            value={detailViewMode}
            onChange={(mode) => dispatch(setDetailViewMode(mode))}
            options={[
              { value: "sidebar", content: <SidebarSimple size={14} />, title: "Sidebar panel" },
              { value: "modal", content: <FrameCorners size={14} />, title: "Modal view" },
            ]}
          />

          {canManage && (
            <PaneIconButton
              onClick={() => navigate(`/projects/${project.id}/settings`)}
              title="Project Settings"
            >
              <Gear size={16} />
            </PaneIconButton>
          )}
        </PaneHeaderBar>

        {/* Control bar: view switcher (left) vs slice controls (right) */}
        <PaneHeaderControls ref={controlBarRef} className="relative flex-nowrap">
          <ViewSwitcher viewMode={viewMode} onChange={handleViewChange} labels={viewLabels} />

          {activeSprint && !compactControls && (
            <span className="shrink-0 text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
              {activeSprint.name}
            </span>
          )}

          <div className="hidden md:block flex-1" />

          {/* Search: full-width field on mobile, fixed field on desktop */}
          {isMobile ? (
            isSearchOpen || searchQuery ? (
              <div className="relative flex-1 min-w-0">
                <MagnifyingGlass
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="text"
                  autoFocus
                  placeholder="Search tasks..."
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onBlur={() => !searchQuery && setIsSearchOpen(false)}
                  className="pl-9 h-8 text-sm bg-muted border-0"
                />
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => setIsSearchOpen(true)}
                title="Search tasks"
              >
                <MagnifyingGlass size={16} />
              </Button>
            )
          ) : (
            <div className="relative w-56 lg:w-64 min-w-28 shrink">
              <MagnifyingGlass
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="text"
                placeholder="Search tasks..."
                value={searchQuery}
                onChange={handleSearchChange}
                className="pl-9 h-8 text-sm bg-muted border-0"
              />
            </div>
          )}

          {/* Advanced filter builder; a compact bar anchors the popover to the whole row so it fits. */}
          <div className={cn("shrink-0", !compactControls && "relative")}>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-8 gap-1.5", nonTagConditions.length > 0 && "text-primary")}
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              title="Filter"
            >
              <Funnel size={16} weight={nonTagConditions.length > 0 ? "fill" : "regular"} />
              {!compactControls && "Filter"}
              {nonTagConditions.length > 0 && (
                <span className="text-xs bg-primary text-primary-foreground rounded-full px-1.5 min-w-[18px] text-center">
                  {nonTagConditions.length}
                </span>
              )}
            </Button>
            {isFilterOpen && (
              <FilterBuilder
                fields={filterableFields}
                filterConfig={activeFilterConfig}
                onApply={(config) => dispatch(setFilterConfig(config))}
                onClose={() => setIsFilterOpen(false)}
                epicOptions={epicOptions}
                className={
                  compactControls
                    ? "right-3 max-w-[calc(100%-1.5rem)] md:right-4 md:max-w-[calc(100%-2rem)]"
                    : undefined
                }
              />
            )}
          </div>

          {/* Display: every quick filter + arrangement control in one panel */}
          <div className="relative shrink-0">
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-8 gap-1.5", displayDirtyCount > 0 && "text-primary")}
              onClick={() => setIsDisplayOpen(!isDisplayOpen)}
              title="Display"
            >
              <SlidersHorizontal size={16} weight={displayDirtyCount > 0 ? "fill" : "regular"} />
              {!compactControls && "Display"}
              {displayDirtyCount > 0 && (
                <span className="text-xs bg-primary text-primary-foreground rounded-full px-1.5 min-w-[18px] text-center">
                  {displayDirtyCount}
                </span>
              )}
            </Button>
            {isDisplayOpen && (
              <DisplayPanel
                onClose={() => setIsDisplayOpen(false)}
                typeOptions={typeOptions}
                taskTypeFilter={taskTypeFilter}
                onType={(v) => dispatch(setTaskTypeFilter(v))}
                showSprint={showSprintControl}
                sprintOptions={sprintOptions}
                sprintFilter={sprintFilter}
                onSprint={(v) => dispatch(setSprintFilter(v))}
                showEpic={showEpicControl}
                epicOptions={epicFilterOptions}
                inEpicFilter={inEpicFilter}
                onEpic={(v) => dispatch(setInEpicFilter(v))}
                selectedTagIds={selectedTagIds}
                onTags={applyTags}
                rootOnlyFilter={rootOnlyFilter}
                onRootOnly={() => dispatch(setRootOnlyFilter(!rootOnlyFilter))}
                showGroupBy={showGroupBy}
                groupByOptions={groupByOptions}
                groupByValue={groupByValue}
                onGroupBy={(v) => dispatch(setGroupBy(v))}
                showOutline={showOutline}
                tableOutlineEnabled={tableOutlineEnabled}
                onOutline={() => dispatch(setTableOutlineEnabled(!tableOutlineEnabled))}
                showManageStatuses={showManageStatuses}
                onManageStatuses={() => {
                  setIsDisplayOpen(false);
                  setIsManageStatusesOpen(true);
                }}
              />
            )}
            {isManageStatusesOpen && (
              <div className="absolute top-full right-0 z-50 mt-1.5">
                <ManageStatusesDialog
                  options={statusOptions}
                  onSave={handleUpdateStatuses}
                  onClose={() => setIsManageStatusesOpen(false)}
                />
              </div>
            )}
          </div>
        </PaneHeaderControls>

        {/* Active filters: only present once something narrows the view */}
        {hasActiveFilters && !hasSelection && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 md:px-4 pb-2">
            <span className="text-xs text-muted-foreground mr-0.5">Filters</span>
            {nonTagConditions.length > 0 && (
              <FilterChip
                label={`Conditions · ${nonTagConditions.length}`}
                onClick={() => setIsFilterOpen(true)}
                onRemove={clearBuilderConditions}
              />
            )}
            {taskTypeFilter && (
              <FilterChip
                label={`Type · ${typeLabel}`}
                onRemove={() => dispatch(setTaskTypeFilter(null))}
              />
            )}
            {sprintFilter && (
              <FilterChip
                label={`Sprint · ${sprintLabel}`}
                onRemove={() => dispatch(setSprintFilter(null))}
              />
            )}
            {inEpicFilter && (
              <FilterChip
                label={`Epic · ${epicLabel}`}
                onRemove={() => dispatch(setInEpicFilter(null))}
              />
            )}
            {selectedTagIds.length > 0 && (
              <FilterChip
                label={`Tags · ${selectedTagIds.length}`}
                onRemove={() => applyTags([])}
              />
            )}
            {rootOnlyFilter && (
              <FilterChip
                label="Top-level only"
                onRemove={() => dispatch(setRootOnlyFilter(false))}
              />
            )}
            <button
              type="button"
              onClick={clearAllFilters}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-0.5"
            >
              Clear all
            </button>
          </div>
        )}

        {/* Bulk actions take over the rail while tasks are selected */}
        {hasSelection && (
          <div className="flex items-center px-3 md:px-4 pb-2">
            <BulkActionToolbar
              selectedCount={selectedTaskIds.length}
              selectedTaskIds={selectedTaskIds}
              statusOptions={statusOptions}
              onDeleteClick={() => setShowDeleteTasksConfirm(true)}
              onClearSelection={() => dispatch(clearSelection())}
              dispatch={dispatch}
              sprints={allSprints}
            />
          </div>
        )}
      </PaneHeader>

      <ConfirmDialog
        isOpen={showDeleteTasksConfirm}
        onClose={() => setShowDeleteTasksConfirm(false)}
        onConfirm={handleDeleteTasks}
        title="Delete Tasks"
        message={`Are you sure you want to delete ${selectedTaskIds.length} task${selectedTaskIds.length !== 1 ? "s" : ""}? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        loading={isDeleting}
      />
    </>
  );
}

type ViewLabels = "all" | "active" | "none";

interface ViewSwitcherProps {
  viewMode: ViewType;
  onChange: (view: ViewType) => void;
  labels: ViewLabels;
}

function ViewSwitcher({ viewMode, onChange, labels }: ViewSwitcherProps) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg bg-muted/60 p-0.5",
        // Icon-only on a phone: the switcher gives way (and scrolls) before Filter and Display do.
        labels === "none" ? "min-w-0 shrink overflow-x-auto" : "shrink-0",
      )}
    >
      {VIEWS.map((view) => {
        const isActive = viewMode === view.value;
        const withLabel = labels === "all" || (labels === "active" && isActive);
        return (
          <button
            key={view.value}
            type="button"
            onClick={() => onChange(view.value)}
            title={view.label}
            aria-pressed={isActive}
            className={cn(
              "flex shrink-0 items-center gap-1.5 py-1 rounded-md text-sm transition-all",
              labels === "none" ? "px-2" : "px-2.5",
              isActive
                ? "bg-card text-foreground shadow-sm font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="shrink-0 flex items-center">{view.icon}</span>
            {withLabel && <span className="truncate">{view.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

interface FilterChipProps {
  label: string;
  onRemove: () => void;
  onClick?: () => void;
}

function FilterChip({ label, onRemove, onClick }: FilterChipProps) {
  return (
    <span className="inline-flex items-center h-6 rounded-full bg-primary/10 text-primary text-xs">
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        className={cn("pl-2.5 pr-1 py-0.5 max-w-[180px] truncate", onClick && "hover:underline")}
      >
        {label}
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="px-1 h-full rounded-r-full hover:bg-primary/20 transition-colors"
        title="Remove filter"
      >
        <X size={12} weight="bold" />
      </button>
    </span>
  );
}

export const GROUP_BY_TAGS_KEY = "__tags__";
export const GROUP_BY_EPIC_KEY = "__epic__";

const GROUP_BY_OPTIONS: Option[] = [
  { value: null, label: "No grouping" },
  { value: SYSTEM_FIELD_IDS.STATUS, label: "Status" },
  { value: SYSTEM_FIELD_IDS.PRIORITY, label: "Priority" },
  { value: SYSTEM_FIELD_IDS.ASSIGNEE, label: "Assignee" },
  { value: "__sprint__", label: "Sprint" },
  { value: "__task_type__", label: "Task Type" },
  { value: GROUP_BY_TAGS_KEY, label: "Tags" },
];

const BOARD_GROUP_BY_OPTIONS: Option[] = [
  { value: null, label: "Status" },
  { value: GROUP_BY_EPIC_KEY, label: "Epic" },
];

interface DisplayPanelProps {
  onClose: () => void;
  typeOptions: Option[];
  taskTypeFilter: string | null;
  onType: (v: string | null) => void;
  showSprint: boolean;
  sprintOptions: Option[];
  sprintFilter: string | null;
  onSprint: (v: string | null) => void;
  showEpic: boolean;
  epicOptions: Option[];
  inEpicFilter: string | null;
  onEpic: (v: string | null) => void;
  selectedTagIds: string[];
  onTags: (ids: string[]) => void;
  rootOnlyFilter: boolean;
  onRootOnly: () => void;
  showGroupBy: boolean;
  groupByOptions: Option[];
  groupByValue: string | null;
  onGroupBy: (v: string | null) => void;
  showOutline: boolean;
  tableOutlineEnabled: boolean;
  onOutline: () => void;
  showManageStatuses: boolean;
  onManageStatuses: () => void;
}

function DisplayPanel(props: DisplayPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleClose = props.onClose;

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handleClickOutside), 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [handleClose]);

  return (
    <div
      ref={containerRef}
      className={cn(
        popoverShellClass,
        "absolute top-full right-0 z-50 mt-1.5 w-72 max-h-[70vh] overflow-y-auto rounded-xl p-3 space-y-4 animate-in fade-in-0 zoom-in-95",
      )}
    >
      <PanelSection label="Filter">
        <PanelRow label="Type">
          <OptionChips
            options={props.typeOptions}
            value={props.taskTypeFilter}
            onSelect={props.onType}
          />
        </PanelRow>
        {props.showSprint && (
          <PanelRow label="Sprint">
            <OptionChips
              options={props.sprintOptions}
              value={props.sprintFilter}
              onSelect={props.onSprint}
            />
          </PanelRow>
        )}
        {props.showEpic && (
          <PanelRow label="Epic">
            <OptionChips
              options={props.epicOptions}
              value={props.inEpicFilter}
              onSelect={props.onEpic}
            />
          </PanelRow>
        )}
        <PanelRow label="Tags">
          <TagPicker
            selectedTagIds={props.selectedTagIds}
            onChange={props.onTags}
            placeholder="Pick a tag"
          />
        </PanelRow>
        <ToggleRow
          icon={<SquaresFour size={16} />}
          label="Top-level only"
          description="Hide subtasks; show parent tasks"
          active={props.rootOnlyFilter}
          onToggle={props.onRootOnly}
        />
      </PanelSection>

      {(props.showGroupBy || props.showOutline || props.showManageStatuses) && (
        <PanelSection label="Arrange">
          {props.showGroupBy && (
            <PanelRow label="Group by">
              <OptionChips
                options={props.groupByOptions}
                value={props.groupByValue}
                onSelect={props.onGroupBy}
              />
            </PanelRow>
          )}
          {props.showOutline && (
            <ToggleRow
              icon={<TreeView size={16} />}
              label="Outline"
              description="Nest subtasks under parents"
              active={props.tableOutlineEnabled}
              onToggle={props.onOutline}
            />
          )}
          {props.showManageStatuses && (
            <button
              type="button"
              onClick={props.onManageStatuses}
              className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted transition-colors"
            >
              <SquaresFour size={16} className="text-muted-foreground shrink-0" />
              Manage statuses
            </button>
          )}
        </PanelSection>
      )}
    </div>
  );
}

function PanelSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        {label}
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function PanelRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function OptionChips({
  options,
  value,
  onSelect,
}: {
  options: Option[];
  value: string | null;
  onSelect: (v: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value ?? "__none__"}
            type="button"
            onClick={() => onSelect(option.value)}
            className={cn(
              "px-2 py-1 rounded-md text-xs transition-colors",
              isActive
                ? "bg-primary text-primary-foreground font-medium"
                : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

interface ToggleRowProps {
  icon: React.ReactNode;
  label: string;
  description?: string;
  active: boolean;
  onToggle: () => void;
}

function ToggleRow({ icon, label, description, active, onToggle }: ToggleRowProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted transition-colors"
    >
      <span className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground")}>
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-sm text-foreground">{label}</span>
        {description && (
          <span className="block text-xs text-muted-foreground truncate">{description}</span>
        )}
      </span>
      <span
        className={cn(
          "relative h-4 w-7 rounded-full transition-colors shrink-0",
          active ? "bg-primary" : "bg-muted-foreground/30",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3 w-3 rounded-full bg-white transition-transform",
            active ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}

interface BulkActionToolbarProps {
  selectedCount: number;
  selectedTaskIds: string[];
  statusOptions: SelectOption[];
  onDeleteClick: () => void;
  onClearSelection: () => void;
  dispatch: AppDispatch;
  sprints: Sprint[];
}

function BulkActionToolbar({
  selectedCount,
  selectedTaskIds,
  statusOptions,
  onDeleteClick,
  onClearSelection,
  dispatch,
  sprints,
}: BulkActionToolbarProps) {
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleBulkUpdate = (updates: {
    status?: string;
    priority?: string;
    sprintId?: string | null;
  }) => {
    dispatch(bulkUpdateTasksThunk({ taskIds: selectedTaskIds, updates }));
    setOpenDropdown(null);
  };

  const handleClose = useCallback(() => setOpenDropdown(null), []);

  useEffect(() => {
    if (!openDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openDropdown, handleClose]);

  const priorityOptions: { value: string; label: string; color: string }[] = [
    { value: "priority_urgent", label: "Urgent", color: "#ef4444" },
    { value: "priority_high", label: "High", color: "#f97316" },
    { value: "priority_medium", label: "Medium", color: "#eab308" },
    { value: "priority_low", label: "Low", color: "#22c55e" },
    { value: "priority_none", label: "None", color: "#94a3b8" },
  ];

  return (
    <div ref={containerRef} className="flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground whitespace-nowrap">{selectedCount} selected</span>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpenDropdown(openDropdown === "status" ? null : "status")}
          className="flex items-center gap-1 h-7 px-2 rounded-md text-xs hover:bg-muted transition-colors text-muted-foreground"
        >
          Status
          <CaretDown size={10} />
        </button>
        {openDropdown === "status" && (
          <div className={cn(popoverShellClass, "absolute top-full left-0 z-50 mt-1 w-40 py-1")}>
            {statusOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleBulkUpdate({ status: opt.id })}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: statusPaint(statusOptions, opt.id).gradient }}
                />
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpenDropdown(openDropdown === "priority" ? null : "priority")}
          className="flex items-center gap-1 h-7 px-2 rounded-md text-xs hover:bg-muted transition-colors text-muted-foreground"
        >
          Priority
          <CaretDown size={10} />
        </button>
        {openDropdown === "priority" && (
          <div className={cn(popoverShellClass, "absolute top-full left-0 z-50 mt-1 w-40 py-1")}>
            {priorityOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleBulkUpdate({ priority: opt.value })}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted"
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: opt.color }}
                />
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {sprints.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpenDropdown(openDropdown === "sprint" ? null : "sprint")}
            className="flex items-center gap-1 h-7 px-2 rounded-md text-xs hover:bg-muted transition-colors text-muted-foreground"
          >
            Sprint
            <CaretDown size={10} />
          </button>
          {openDropdown === "sprint" && (
            <div className={cn(popoverShellClass, "absolute top-full left-0 z-50 mt-1 w-48 py-1")}>
              <button
                type="button"
                onClick={() => handleBulkUpdate({ sprintId: null })}
                className="flex w-full items-center px-3 py-1.5 text-sm hover:bg-muted text-muted-foreground"
              >
                Backlog (no sprint)
              </button>
              {sprints
                .filter((s) => s.status !== "closed")
                .map((sprint) => (
                  <button
                    key={sprint.id}
                    type="button"
                    onClick={() => handleBulkUpdate({ sprintId: sprint.id })}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-muted"
                  >
                    <span className="truncate">{sprint.name}</span>
                    {sprint.status === "active" && (
                      <span className="text-[10px] text-green-600 dark:text-green-400 shrink-0">
                        Active
                      </span>
                    )}
                  </button>
                ))}
            </div>
          )}
        </div>
      )}

      <button
        onClick={onDeleteClick}
        className="p-1 rounded-md hover:bg-destructive/10 transition-colors"
        title="Delete selected tasks"
      >
        <Trash size={16} weight="duotone" className="text-destructive" />
      </button>

      <button
        onClick={onClearSelection}
        className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        title="Clear selection"
      >
        <X size={14} />
      </button>
    </div>
  );
}
