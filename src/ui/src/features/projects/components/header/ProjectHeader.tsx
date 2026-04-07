/**
 * ProjectHeader - Header section for the project view
 *
 * Contains:
 * - Project icon and title
 * - Task/member counts
 * - View tabs (Table/Board/Roadmap)
 * - Filter bar with search, filter builder, group by
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { MagnifyingGlass, Table, Columns, ChartLine, Check, Trash, X, Funnel, SquaresFour, CaretDown, Plus, Archive, ShareNetwork, SidebarSimple, Users, FrameCorners, Gear } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { useBreakpoint } from "@/shared/hooks/useBreakpoint";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  setViewMode,
  setSearchQuery,
  setFilterConfig,
  setGroupBy,
  setSprintFilter,
  setTaskTypeFilter,
  selectViewMode,
  selectSearchQuery,
  selectSelectedTaskIds,
  selectActiveFilterConfig,
  selectActiveGroupByFieldId,
  selectSprintFilter,
  selectTaskTypeFilter,
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
import type { Project, ViewType } from "@/features/projects/types";
import { FilterBuilder } from "@/features/projects/components/views/table/FilterBuilder";
import { ManageStatusesDialog } from "@/features/projects/components/views/board/ManageStatusesDialog";
import { updateFieldDefinition, selectProjectTimeStats } from "@/features/projects/store/projectsSlice";
import { formatMinutes } from "@/features/projects/utils/timeFormatting";
import { updateFieldThunk } from "@/features/projects/store/projectsThunks";
import { selectActiveSprint, selectSprintsForProject } from "@/features/projects/store/sprintsSlice";
import { TASK_TYPES } from "@/features/projects/utils/taskTypes";
import type { SelectOption, Sprint } from "@/features/projects/types";
import { useProjectPermission } from "@/features/projects/hooks/useProjectPermissions";
import type { AppDispatch } from "@/app/store";

interface ProjectHeaderProps {
  project: Project;
  taskCount: number;
}

export function ProjectHeader({ project, taskCount }: ProjectHeaderProps) {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { isMobile, isMobileOrTablet } = useBreakpoint();
  const viewMode = useAppSelector(selectViewMode);
  const searchQuery = useAppSelector(selectSearchQuery);
  const selectedTaskIds = useAppSelector(selectSelectedTaskIds);
  const activeFilterConfig = useAppSelector(selectActiveFilterConfig);
  const activeGroupByFieldId = useAppSelector(selectActiveGroupByFieldId);
  const isSidebarOpen = useAppSelector(selectIsSidebarOpen);
  const detailViewMode = useAppSelector(selectDetailViewMode);
  const timeStats = useAppSelector(
    useMemo(() => selectProjectTimeStats(project.id), [project.id])
  );
  const { canEdit, canAccessSettings } = useProjectPermission();
  const activeSprint = useAppSelector(selectActiveSprint(project.id));
  const allSprints = useAppSelector(selectSprintsForProject(project.id));
  const sprintFilter = useAppSelector(selectSprintFilter);
  const taskTypeFilter = useAppSelector(selectTaskTypeFilter);
  const hasSprintsWithTasks = allSprints.some((s) => s.taskCount > 0);
  const [showDeleteTasksConfirm, setShowDeleteTasksConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isManageStatusesOpen, setIsManageStatusesOpen] = useState(false);
  // Get status field options for management
  const statusField = project.fieldDefinitions.find(
    (f) => f.id === SYSTEM_FIELD_IDS.STATUS
  );
  const statusOptions = statusField?.config.options || [];

  const handleUpdateStatuses = (newOptions: SelectOption[]) => {
      if (!statusField) return;
      const updatedConfig = { ...statusField.config, options: newOptions };
    
      // Optimistic update
      dispatch(updateFieldDefinition({
        projectId: project.id,
        fieldId: SYSTEM_FIELD_IDS.STATUS,
        changes: { config: updatedConfig },
      }));
    
      // API update
      dispatch(updateFieldThunk({
        projectId: project.id,
        fieldId: SYSTEM_FIELD_IDS.STATUS,
        updates: { config: updatedConfig },
      }));
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

  const filterableFields = project.fieldDefinitions.filter(
    (f) => f.id !== SYSTEM_FIELD_IDS.TITLE
  );

  const hasSelection = selectedTaskIds.length > 0;

  return (
    <>
    <div className="shrink-0 border-b border-border bg-card">
      {/* Project Info Bar */}
      <div className="flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2 md:py-3 border-b border-border">
        {/* Sidebar toggle (mobile + tablet when collapsed) */}
        {isMobileOrTablet && !isSidebarOpen && (
          <button
            onClick={() => dispatch(toggleSidebar())}
            className="p-1.5 rounded-md bg-transparent hover:bg-muted transition-colors shrink-0"
            title="Show sidebar"
          >
            <SidebarSimple size={16} className="text-primary" />
          </button>
        )}

        <ProjectIcon
          icon={project.icon}
          size={isMobile ? 16 : 20}
          weight="duotone"
          className="text-primary shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h1 className="font-medium text-sm md:text-base text-foreground truncate">{project.name}</h1>
          <p className="text-xs text-muted-foreground">
            {taskCount} task{taskCount !== 1 ? "s" : ""}{!isMobile && <> · {project.memberIds.length} member{project.memberIds.length !== 1 ? "s" : ""}</>}
            {timeStats.hasTimeData && !isMobile && (
              <> · {formatMinutes(timeStats.totalSpent)} spent{timeStats.totalEstimated > 0 && <> / {formatMinutes(timeStats.totalEstimated)} est{timeStats.remaining > 0 && <> · {formatMinutes(timeStats.remaining)} left</>}</>}</>
            )}
          </p>
        </div>
        {canEdit && (
          <button
            type="button"
            className="flex items-center gap-1 md:gap-2 px-2 md:px-3 py-1.5 text-sm text-primary bg-transparent hover:bg-muted rounded-md transition-colors shrink-0"
            onClick={() => dispatch(openCreateTaskModal())}
          >
            <Plus size={16} weight="bold" />
            {!isMobile && "New Task"}
          </button>
        )}

        {/* Detail view mode toggle */}
        <div className="hidden md:flex items-center gap-0.5 border border-border rounded-md p-0.5 shrink-0">
          <button
            type="button"
            onClick={() => dispatch(setDetailViewMode("sidebar"))}
            className={cn(
              "p-1 rounded transition-colors",
              detailViewMode === "sidebar" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
            )}
            title="Sidebar panel"
          >
            <SidebarSimple size={14} />
          </button>
          <button
            type="button"
            onClick={() => dispatch(setDetailViewMode("modal"))}
            className={cn(
              "p-1 rounded transition-colors",
              detailViewMode === "modal" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
            )}
            title="Modal view"
          >
            <FrameCorners size={14} />
          </button>
        </div>

        {/* Project Settings */}
        {canAccessSettings && (
          <button
            type="button"
            onClick={() => navigate(`/projects/${project.id}/settings`)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
            title="Project Settings"
          >
            <Gear size={16} />
          </button>
        )}
      </div>

      {/* View Tabs + Filter Bar */}
      <div className="flex flex-wrap items-center gap-2 md:gap-4 px-3 md:px-4 py-2">
        <div className="flex items-center gap-0.5 md:gap-1">
          <ViewTab
            icon={<Table size={16} />}
            label={isMobile ? "" : "Table"}
            isActive={viewMode === "table"}
            onClick={() => handleViewChange("table")}
          />
          <ViewTab
            icon={<Columns size={16} />}
            label={isMobile ? "" : "Board"}
            isActive={viewMode === "board"}
            onClick={() => handleViewChange("board")}
          />
          <ViewTab
            icon={<ChartLine size={16} />}
            label={isMobile ? "" : "Roadmap"}
            isActive={viewMode === "roadmap"}
            onClick={() => handleViewChange("roadmap")}
          />
          <ViewTab
            icon={<Archive size={16} />}
            label={isMobile ? "" : "Backlog"}
            isActive={viewMode === "backlog"}
            onClick={() => handleViewChange("backlog")}
          />
          <ViewTab
            icon={<ShareNetwork size={16} />}
            label={isMobile ? "" : "Graph"}
            isActive={viewMode === "graph"}
            onClick={() => handleViewChange("graph")}
          />
          {!isMobile && (
            <ViewTab
              icon={<Users size={16} />}
              label="Resources"
              isActive={viewMode === "resources"}
              onClick={() => handleViewChange("resources")}
            />
          )}
        </div>

        {activeSprint && !isMobile && (
          <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
            {activeSprint.name}
          </span>
        )}

        <div className="hidden md:block h-5 w-px bg-border" />

        {/* Search */}
        <div className="relative flex-1 min-w-[120px] max-w-sm">
          <MagnifyingGlass
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="text"
            placeholder="Filter tasks..."
            value={searchQuery}
            onChange={handleSearchChange}
            className="pl-9 h-8 text-sm bg-muted border-0"
          />
        </div>

        {/* Filter Button */}
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-8", activeFilterConfig && "text-primary")}
            onClick={() => setIsFilterOpen(!isFilterOpen)}
          >
            <Funnel size={16} className={isMobile ? "" : "mr-1"} />
            {!isMobile && "Filter"}
            {activeFilterConfig && activeFilterConfig.conditions.length > 0 && (
              <span className="ml-1 text-xs bg-primary text-primary-foreground rounded-full px-1.5 min-w-[18px] text-center">
                {activeFilterConfig.conditions.length}
              </span>
            )}
          </Button>
          {isFilterOpen && (
            <FilterBuilder
              fields={filterableFields}
              filterConfig={activeFilterConfig}
              onApply={(config) => dispatch(setFilterConfig(config))}
              onClose={() => setIsFilterOpen(false)}
            />
          )}
        </div>

        {/* Sprint Filter - hidden on mobile */}
        {hasSprintsWithTasks && viewMode !== "backlog" && !isMobile && (
          <QuickFilterDropdown
            label="Sprint"
            value={sprintFilter}
            options={[
              { value: null, label: "All sprints" },
              { value: "__backlog__", label: "Backlog" },
              ...allSprints
                .filter((s) => s.status !== "closed")
                .map((s) => ({ value: s.id, label: s.name })),
            ]}
            onSelect={(value) => dispatch(setSprintFilter(value))}
          />
        )}

        {/* Task Type Filter - hidden on mobile */}
        {!isMobile && (
          <QuickFilterDropdown
            label="Type"
            value={taskTypeFilter}
            options={[
              { value: null, label: "All types" },
              ...TASK_TYPES.map((t) => ({ value: t.value, label: t.label })),
            ]}
            onSelect={(value) => dispatch(setTaskTypeFilter(value))}
          />
        )}

        {/* Manage Statuses Button (Board view only) - hidden on mobile */}
        {viewMode === "board" && !isMobile && (
            <div className="relative">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsManageStatusesOpen(!isManageStatusesOpen)}
                >
                    <SquaresFour size={16} className={isMobileOrTablet ? "" : "mr-1"} />
                    {!isMobileOrTablet && "Manage Statuses"}
                </Button>
                {isManageStatusesOpen && (
                    <div className="absolute top-9 right-0 z-50">
                        <ManageStatusesDialog
                            options={statusOptions}
                            onSave={handleUpdateStatuses}
                            onClose={() => setIsManageStatusesOpen(false)}
                        />
                    </div>
                )}
            </div>
        )}

        {/* Group By (Table view only) - hidden on mobile */}
        {viewMode === "table" && !isMobile && (
          <GroupByDropdown
            activeGroupByFieldId={activeGroupByFieldId}
            onSelect={(value) => dispatch(setGroupBy(value))}
            showSprintOption={hasSprintsWithTasks}
          />
        )}

        {/* Bulk action toolbar */}
        {hasSelection && (
          <BulkActionToolbar
            selectedCount={selectedTaskIds.length}
            selectedTaskIds={selectedTaskIds}
            statusOptions={statusOptions}
            onDeleteClick={() => setShowDeleteTasksConfirm(true)}
            onClearSelection={() => dispatch(clearSelection())}
            dispatch={dispatch}
            sprints={allSprints}
          />
        )}
      </div>
    </div>

    {/* Delete tasks confirmation */}
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

interface ViewTabProps {
  icon: React.ReactNode;
  label: string;
  isActive: boolean;
  onClick: () => void;
}

function ViewTab({ icon, label, isActive, onClick }: ViewTabProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-2 md:px-2.5 py-1 text-sm rounded-md transition-colors",
        isActive
          ? "text-primary bg-primary/10"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      )}
      title={label || undefined}
    >
      {icon}
      {label && <span>{label}</span>}
    </button>
  );
}

// ===== Group By Dropdown =====

const GROUP_BY_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: "No grouping" },
  { value: SYSTEM_FIELD_IDS.STATUS, label: "Status" },
  { value: SYSTEM_FIELD_IDS.PRIORITY, label: "Priority" },
  { value: SYSTEM_FIELD_IDS.ASSIGNEE, label: "Assignee" },
  { value: "__sprint__", label: "Sprint" },
  { value: "__task_type__", label: "Task Type" },
];

interface GroupByDropdownProps {
  activeGroupByFieldId: string | null;
  onSelect: (value: string | null) => void;
  showSprintOption: boolean;
}

// ===== Quick Filter Dropdown =====

interface QuickFilterOption {
  value: string | null;
  label: string;
}

interface QuickFilterDropdownProps {
  label: string;
  value: string | null;
  options: QuickFilterOption[];
  onSelect: (value: string | null) => void;
}

function QuickFilterDropdown({ label, value, options, onSelect }: QuickFilterDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeOption = options.find((o) => o.value === value);
  const displayLabel = activeOption?.value != null ? activeOption.label : label;
  const isFiltered = value !== null;

  const handleClose = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, handleClose]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-1.5 h-8 px-2.5 rounded-md text-sm transition-colors",
          "hover:bg-muted",
          isFiltered
            ? "text-primary font-medium"
            : "text-muted-foreground"
        )}
      >
        <span>{displayLabel}</span>
        <CaretDown size={12} className={cn("transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 z-50 mt-1.5 w-48 rounded-lg border border-border bg-card shadow-lg py-1 animate-in fade-in-0 zoom-in-95">
          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {label}
          </div>
          {options.map((option) => {
            const isActive = option.value === value;
            return (
              <button
                key={option.value ?? "__none__"}
                type="button"
                onClick={() => {
                  onSelect(option.value);
                  setIsOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-muted"
                )}
              >
                <span>{option.label}</span>
                {isActive && <Check size={14} weight="bold" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GroupByDropdown({ activeGroupByFieldId, onSelect, showSprintOption }: GroupByDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const options = showSprintOption
    ? GROUP_BY_OPTIONS
    : GROUP_BY_OPTIONS.filter((o) => o.value !== "__sprint__");

  const activeOption = options.find((o) => o.value === activeGroupByFieldId);
  const displayLabel = activeOption?.value ? activeOption.label : "No grouping";

  const handleClose = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, handleClose]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-1.5 h-8 px-2.5 rounded-md text-sm transition-colors",
          "hover:bg-muted",
          activeGroupByFieldId
            ? "text-primary font-medium"
            : "text-muted-foreground"
        )}
      >
        <SquaresFour size={16} />
        <span>{displayLabel}</span>
        <CaretDown size={12} className={cn("transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 z-50 mt-1.5 w-48 rounded-lg border border-border bg-card shadow-lg py-1 animate-in fade-in-0 zoom-in-95">
          <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Group by
          </div>
          {options.map((option) => {
            const isActive = option.value === activeGroupByFieldId;
            return (
              <button
                key={option.value ?? "__none__"}
                type="button"
                onClick={() => {
                  onSelect(option.value);
                  setIsOpen(false);
                }}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-1.5 text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-muted"
                )}
              >
                <span>{option.label}</span>
                {isActive && <Check size={14} weight="bold" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ===== Bulk Action Toolbar =====

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
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
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
      <span className="text-muted-foreground whitespace-nowrap">
        {selectedCount} selected
      </span>

      {/* Status */}
      <div className="relative">
        <button
          type="button"
          onClick={() =>
            setOpenDropdown(openDropdown === "status" ? null : "status")
          }
          className="flex items-center gap-1 h-7 px-2 rounded-md text-xs hover:bg-muted transition-colors text-muted-foreground"
        >
          Status
          <CaretDown size={10} />
        </button>
        {openDropdown === "status" && (
          <div className="absolute top-full left-0 z-50 mt-1 w-40 rounded-lg border border-border bg-card shadow-lg py-1">
            {statusOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleBulkUpdate({ status: opt.id })}
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

      {/* Priority */}
      <div className="relative">
        <button
          type="button"
          onClick={() =>
            setOpenDropdown(openDropdown === "priority" ? null : "priority")
          }
          className="flex items-center gap-1 h-7 px-2 rounded-md text-xs hover:bg-muted transition-colors text-muted-foreground"
        >
          Priority
          <CaretDown size={10} />
        </button>
        {openDropdown === "priority" && (
          <div className="absolute top-full left-0 z-50 mt-1 w-40 rounded-lg border border-border bg-card shadow-lg py-1">
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

      {/* Sprint */}
      {sprints.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() =>
              setOpenDropdown(openDropdown === "sprint" ? null : "sprint")
            }
            className="flex items-center gap-1 h-7 px-2 rounded-md text-xs hover:bg-muted transition-colors text-muted-foreground"
          >
            Sprint
            <CaretDown size={10} />
          </button>
          {openDropdown === "sprint" && (
            <div className="absolute top-full left-0 z-50 mt-1 w-48 rounded-lg border border-border bg-card shadow-lg py-1">
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
                    onClick={() =>
                      handleBulkUpdate({ sprintId: sprint.id })
                    }
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

      {/* Delete */}
      <button
        onClick={onDeleteClick}
        className="p-1 rounded-md hover:bg-destructive/10 transition-colors"
        title="Delete selected tasks"
      >
        <Trash size={16} weight="duotone" className="text-destructive" />
      </button>

      {/* Clear */}
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
