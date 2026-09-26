import { Fragment, useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  MagnifyingGlass,
  Trash,
  X,
  Funnel,
  SquaresFour,
  CaretDown,
  Plus,
  SidebarSimple,
  FrameCorners,
  Gear,
  TreeView,
  SlidersHorizontal,
  SortAscending,
  SortDescending,
  EyeSlash,
  Warning,
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
import { Select, type SelectOption as SelectMenuOption } from "@/components/ui/select";
import {
  setSearchQuery,
  selectSearchQuery,
  selectSelectedTaskIds,
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
import type { Project } from "@/features/projects/types";
import { FilterBuilder } from "@/features/projects/components/views/table/FilterBuilder";
import { useFilterLabels } from "@/features/projects/hooks/useFilterLabels";
import { useViewCatalog } from "@/features/projects/hooks/useViewCatalog";
import { groupFieldOptions } from "@/features/projects/utils/filterFieldOptions";
import {
  conditionProblem,
  describeNode,
  hasFilterProblems,
} from "@/features/projects/utils/filterTree";
import { selectTasksForProject } from "@/features/projects/store/projectsSlice";
import {
  selectActiveSprint,
  selectSprintsForProject,
} from "@/features/projects/store/sprintsSlice";
import { TASK_TYPES } from "@/features/projects/utils/taskTypes";
import type { SelectOption, Sprint } from "@/features/projects/types";
import { useProjectPermission } from "@/features/projects/hooks/useProjectPermissions";
import { TagPicker } from "@/features/tags";
import type { AppDispatch } from "@/app/store";
import { FilterLogic, SortDirection } from "@uniffy/proto/projects/v1/projects_pb";
import type { ViewGroupBy } from "@/features/projects/types/views";
import {
  selectActiveDefinition,
  selectActiveView,
  selectDirtyViewIds,
  selectProjectViews,
} from "@/features/projects/store/viewSelectors";
import { ViewTabs } from "@/features/projects/components/header/ViewTabs";
import { ViewDraftActions } from "@/features/projects/components/header/ViewDraftActions";
import { viewGates } from "@/features/projects/utils/viewGates";
import {
  setDraftFilter,
  setDraftGroupBy,
  setDraftLayout,
} from "@/features/projects/store/viewDraftThunks";
import {
  NO_SPRINT,
  removeFilterNode,
  setQuickFilter,
  summarizeFilter,
  type QuickFilterKind,
} from "@/features/projects/utils/viewDraft";
import { fieldRefFromKey, fieldRefKey, flipDirection } from "@/features/projects/utils/viewFields";

interface ProjectHeaderProps {
  project: Project;
}

interface Option {
  value: string | null;
  label: string;
}

export function ProjectHeader({ project }: ProjectHeaderProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isMobile, isMobileOrTablet } = useBreakpoint();
  const views = useAppSelector(selectProjectViews(project.id));
  const activeView = useAppSelector(selectActiveView(project.id));
  const definition = useAppSelector(selectActiveDefinition(project.id));
  const dirtyViewIds = useAppSelector(selectDirtyViewIds(project.id));
  const currentUserId = useAppSelector((state) => state.auth.user?.id ?? null);
  const viewMode = definition.layout.type;
  const filter = definition.filter;
  const searchQuery = useAppSelector(selectSearchQuery);
  const selectedTaskIds = useAppSelector(selectSelectedTaskIds);
  const isSidebarOpen = useAppSelector(selectIsSidebarOpen);
  const detailViewMode = useAppSelector(selectDetailViewMode);
  const { canEdit, canManage } = useProjectPermission();
  const activeGates = activeView
    ? viewGates(activeView, {
        canEdit,
        canManage,
        currentUserId,
        isDefault: project.defaultViewId === activeView.id,
      })
    : null;
  const activeSprint = useAppSelector(selectActiveSprint(project.id));
  const allSprints = useAppSelector(selectSprintsForProject(project.id));
  const { chips, otherCount } = useMemo(() => summarizeFilter(filter), [filter]);
  const chipOf = (kind: QuickFilterKind) => chips.find((chip) => chip.kind === kind) ?? null;
  const quickSprint = chipOf("sprint")?.values[0] ?? null;
  const quickType = chipOf("taskType")?.values[0] ?? null;
  const quickEpic = chipOf("epic")?.values[0] ?? null;
  const selectedTagIds = chipOf("tags")?.values ?? [];
  const quickRootOnly = chipOf("rootOnly") !== null;
  const tableOutlineEnabled = definition.layout.type === "table" && !definition.layout.flat;
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
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Label visibility tracks the real control-bar width, not the viewport: the
  // surrounding panels are resizable, so a wide viewport can still leave the
  // bar narrow.
  const controlBarRef = useRef<HTMLDivElement>(null);
  const [controlBarWidth, setControlBarWidth] = useState(0);
  useEffect(() => {
    const el = controlBarRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setControlBarWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // The row never wraps, so a narrower bar sheds labels: first Filter and Display (search starts
  // shrinking), then the active view's name.
  const showActiveViewLabel = controlBarWidth === 0 || controlBarWidth >= 440;
  const compactControls = isMobile || (controlBarWidth > 0 && controlBarWidth < 720);

  const statusField = project.fieldDefinitions.find((f) => f.id === SYSTEM_FIELD_IDS.STATUS);
  const statusOptions = statusField?.config.options || [];

  const applyQuickFilter = (kind: QuickFilterKind, values: string[]) => {
    dispatch(setDraftFilter(project.id, setQuickFilter(filter, kind, values)));
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

  const hasSelection = selectedTaskIds.length > 0;

  const sprintOptions: Option[] = useMemo(
    () => [
      { value: null, label: "All sprints" },
      { value: NO_SPRINT, label: "Backlog" },
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
  const showGroupBy = viewMode === "table" || viewMode === "board" || viewMode === "roadmap";
  const showOutline = viewMode === "table";
  const showManageStatuses = viewMode === "board";

  const viewCatalog = useViewCatalog();
  const fieldsByIdForGroups = useMemo(
    () => new Map(project.fieldDefinitions.map((field) => [field.id, field])),
    [project.fieldDefinitions],
  );
  const groupByOptions = useMemo(
    () => groupFieldOptions(project.fieldDefinitions, fieldsByIdForGroups, viewCatalog),
    [project.fieldDefinitions, fieldsByIdForGroups, viewCatalog],
  );
  const groupBy = definition.groupBy;
  const groupByValue = groupBy ? fieldRefKey(groupBy.field) : null;

  const handleGroupBy = (key: string | null) => {
    const field = key ? fieldRefFromKey(key) : null;
    const next: ViewGroupBy | null = field
      ? { field, direction: SortDirection.ASC, hideEmpty: groupBy?.hideEmpty ?? false }
      : null;
    dispatch(setDraftGroupBy(project.id, next));
  };
  const updateGroupBy = (changes: Partial<ViewGroupBy>) => {
    if (groupBy) dispatch(setDraftGroupBy(project.id, { ...groupBy, ...changes }));
  };

  const columnFieldOptions = useMemo(
    () =>
      project.fieldDefinitions
        .filter((field) => field.type === "single_select")
        .map((field) => ({ value: field.id, label: field.name })),
    [project.fieldDefinitions],
  );
  const columnFieldId =
    (definition.layout.type === "board" && definition.layout.columnFieldId) ||
    SYSTEM_FIELD_IDS.STATUS;
  const handleColumnField = (fieldId: string) =>
    dispatch(
      setDraftLayout(project.id, {
        type: "board",
        columnFieldId: fieldId === SYSTEM_FIELD_IDS.STATUS ? "" : fieldId,
      }),
    );

  const fieldsById = useMemo(
    () => new Map(project.fieldDefinitions.map((field) => [field.id, field])),
    [project.fieldDefinitions],
  );
  const filterLabels = useFilterLabels(project.id, filter, fieldsById);
  const filterBlocksSave = hasFilterProblems(filter, fieldsById);

  const displayDirtyCount =
    (quickType ? 1 : 0) +
    (quickSprint && showSprintControl ? 1 : 0) +
    (quickEpic && showEpicControl ? 1 : 0) +
    (selectedTagIds.length > 0 ? 1 : 0) +
    (quickRootOnly ? 1 : 0) +
    (groupByValue && showGroupBy ? 1 : 0) +
    (showManageStatuses && columnFieldId !== SYSTEM_FIELD_IDS.STATUS ? 1 : 0) +
    (tableOutlineEnabled && showOutline ? 1 : 0);

  const clearAllFilters = () => {
    dispatch(setDraftFilter(project.id, null));
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
          <ViewTabs
            project={project}
            views={views}
            activeViewId={activeView?.id ?? null}
            dirtyViewIds={dirtyViewIds}
            showActiveLabel={showActiveViewLabel}
            compact={isMobile}
            canEdit={canEdit}
            canManage={canManage}
          />

          {activeView && dirtyViewIds.includes(activeView.id) && (
            <ViewDraftActions
              projectId={project.id}
              view={activeView}
              canSave={activeGates?.canEdit ?? false}
              canShare={canEdit}
              blockedReason={
                filterBlocksSave
                  ? "A filter names a deleted field or option. Remove it to save."
                  : null
              }
              compact={compactControls}
            />
          )}

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
              className={cn("h-8 gap-1.5", otherCount > 0 && "text-primary")}
              onClick={() => setIsFilterOpen(!isFilterOpen)}
              title="Filter"
              data-filter-trigger
            >
              <Funnel size={16} weight={otherCount > 0 ? "fill" : "regular"} />
              {!compactControls && "Filter"}
              {otherCount > 0 && (
                <span className="text-xs bg-primary text-primary-foreground rounded-full px-1.5 min-w-[18px] text-center">
                  {otherCount}
                </span>
              )}
            </Button>
            {isFilterOpen && (
              <FilterBuilder
                projectId={project.id}
                fields={project.fieldDefinitions}
                filter={filter}
                onApply={(next) => dispatch(setDraftFilter(project.id, next))}
                onClose={() => setIsFilterOpen(false)}
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
              data-display-trigger
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
                quickType={quickType}
                onType={(v) => applyQuickFilter("taskType", v ? [v] : [])}
                showSprint={showSprintControl}
                sprintOptions={sprintOptions}
                quickSprint={quickSprint}
                onSprint={(v) => applyQuickFilter("sprint", v ? [v] : [])}
                showEpic={showEpicControl}
                epicOptions={epicFilterOptions}
                quickEpic={quickEpic}
                onEpic={(v) => applyQuickFilter("epic", v ? [v] : [])}
                selectedTagIds={selectedTagIds}
                onTags={(ids) => applyQuickFilter("tags", ids)}
                quickRootOnly={quickRootOnly}
                onRootOnly={() => applyQuickFilter("rootOnly", quickRootOnly ? [] : ["root"])}
                showGroupBy={showGroupBy}
                groupByOptions={groupByOptions}
                groupByValue={groupByValue}
                onGroupBy={handleGroupBy}
                groupDirection={groupBy?.direction ?? SortDirection.ASC}
                onGroupDirection={() =>
                  groupBy && updateGroupBy({ direction: flipDirection(groupBy.direction) })
                }
                hideEmptyGroups={groupBy?.hideEmpty ?? false}
                onHideEmptyGroups={() =>
                  groupBy && updateGroupBy({ hideEmpty: !groupBy.hideEmpty })
                }
                showColumnField={showManageStatuses}
                columnFieldOptions={columnFieldOptions}
                columnFieldId={columnFieldId}
                onColumnField={handleColumnField}
                showOutline={showOutline}
                tableOutlineEnabled={tableOutlineEnabled}
                onOutline={() =>
                  dispatch(setDraftLayout(project.id, { type: "table", flat: tableOutlineEnabled }))
                }
                showManageStatuses={showManageStatuses}
                onManageStatuses={() => {
                  setIsDisplayOpen(false);
                  navigate(`/projects/${project.id}/settings?section=statuses`);
                }}
              />
            )}
          </div>
        </PaneHeaderControls>

        {/* Active filters: one sentence per top-level condition; a nested group opens the builder */}
        {filter && filter.nodes.length > 0 && !hasSelection && (
          <div className="flex flex-wrap items-center gap-1.5 px-3 md:px-4 pb-2">
            <span className="text-xs text-muted-foreground mr-0.5">Filters</span>
            {filter.nodes.map((node, index) => (
              <Fragment key={index}>
                {index > 0 && filter.logic === FilterLogic.OR && (
                  <span className="text-xs text-muted-foreground">or</span>
                )}
                <FilterChip
                  label={describeNode(node, fieldsById, filterLabels)}
                  invalid={
                    node.kind === "condition"
                      ? conditionProblem(node.condition, fieldsById) !== null
                      : hasFilterProblems(node.group, fieldsById)
                  }
                  onClick={() => setIsFilterOpen(true)}
                  onRemove={() =>
                    dispatch(setDraftFilter(project.id, removeFilterNode(filter, index)))
                  }
                />
              </Fragment>
            ))}
            <button
              type="button"
              onClick={clearAllFilters}
              className="h-11 md:h-auto text-xs text-muted-foreground hover:text-foreground transition-colors ml-0.5"
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

interface FilterChipProps {
  label: string;
  onRemove: () => void;
  onClick?: () => void;
  /** Names a field or option deleted since; the view cannot be saved until it goes. */
  invalid?: boolean;
}

function FilterChip({ label, onRemove, onClick, invalid = false }: FilterChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center h-11 md:h-6 rounded-full text-xs",
        invalid ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-primary/10 text-primary",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        title={invalid ? `${label}: names something deleted` : label}
        className={cn(
          "inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 max-w-[240px]",
          onClick && "hover:underline",
        )}
      >
        {invalid && <Warning size={12} className="shrink-0" />}
        <span className="truncate">{label}</span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        className={cn(
          "px-1.5 md:px-1 h-full rounded-r-full transition-colors",
          invalid ? "hover:bg-red-500/20" : "hover:bg-primary/20",
        )}
        title="Remove filter"
        aria-label={`Remove filter: ${label}`}
      >
        <X size={12} weight="bold" />
      </button>
    </span>
  );
}

interface DisplayPanelProps {
  onClose: () => void;
  typeOptions: Option[];
  quickType: string | null;
  onType: (v: string | null) => void;
  showSprint: boolean;
  sprintOptions: Option[];
  quickSprint: string | null;
  onSprint: (v: string | null) => void;
  showEpic: boolean;
  epicOptions: Option[];
  quickEpic: string | null;
  onEpic: (v: string | null) => void;
  selectedTagIds: string[];
  onTags: (ids: string[]) => void;
  quickRootOnly: boolean;
  onRootOnly: () => void;
  showGroupBy: boolean;
  groupByOptions: SelectMenuOption[];
  groupByValue: string | null;
  onGroupBy: (v: string | null) => void;
  groupDirection: SortDirection;
  onGroupDirection: () => void;
  hideEmptyGroups: boolean;
  onHideEmptyGroups: () => void;
  showColumnField: boolean;
  columnFieldOptions: SelectMenuOption[];
  columnFieldId: string;
  onColumnField: (fieldId: string) => void;
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
      // A picked option lives in a portal outside the panel; picking it must not close the panel.
      if (e.target instanceof Element && e.target.closest("[data-select-portal]")) return;
      // The Display button toggles the panel itself; closing here too would reopen it on click.
      if (e.target instanceof Element && e.target.closest("[data-display-trigger]")) return;
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
            value={props.quickType}
            onSelect={props.onType}
          />
        </PanelRow>
        {props.showSprint && (
          <PanelRow label="Sprint">
            <OptionChips
              options={props.sprintOptions}
              value={props.quickSprint}
              onSelect={props.onSprint}
            />
          </PanelRow>
        )}
        {props.showEpic && (
          <PanelRow label="Epic">
            <OptionChips
              options={props.epicOptions}
              value={props.quickEpic}
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
          active={props.quickRootOnly}
          onToggle={props.onRootOnly}
        />
      </PanelSection>

      {(props.showGroupBy || props.showOutline || props.showManageStatuses) && (
        <PanelSection label="Arrange">
          {props.showColumnField && (
            <PanelRow label="Columns">
              <Select
                value={props.columnFieldId}
                onChange={props.onColumnField}
                options={props.columnFieldOptions}
                size="sm"
                ariaLabel="Board columns"
                className="w-full"
                triggerClassName="w-full h-11 md:h-8 touch:h-11"
                menuMinWidth={200}
              />
            </PanelRow>
          )}
          {props.showGroupBy && (
            <PanelRow label={props.showColumnField ? "Swimlanes" : "Group by"}>
              <div className="flex items-center gap-1.5">
                <Select
                  value={props.groupByValue ?? ""}
                  onChange={(key) => props.onGroupBy(key || null)}
                  options={[{ value: "", label: "No grouping" }, ...props.groupByOptions]}
                  size="sm"
                  searchable
                  searchPlaceholder="Search fields..."
                  ariaLabel={props.showColumnField ? "Swimlanes" : "Group by"}
                  className="flex-1 min-w-0"
                  triggerClassName="w-full h-11 md:h-8 touch:h-11"
                  menuMinWidth={220}
                />
                {props.groupByValue && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-11 w-11 md:h-8 md:w-8 touch:h-11 touch:w-11 shrink-0"
                    onClick={props.onGroupDirection}
                    title={
                      props.groupDirection === SortDirection.DESC
                        ? "Groups in reverse order"
                        : "Groups in order"
                    }
                    aria-label="Reverse group order"
                  >
                    {props.groupDirection === SortDirection.DESC ? (
                      <SortDescending size={16} />
                    ) : (
                      <SortAscending size={16} />
                    )}
                  </Button>
                )}
              </div>
            </PanelRow>
          )}
          {props.showGroupBy && props.groupByValue && (
            <ToggleRow
              icon={<EyeSlash size={16} />}
              label="Hide empty groups"
              description="Only show groups with tasks"
              active={props.hideEmptyGroups}
              onToggle={props.onHideEmptyGroups}
            />
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
