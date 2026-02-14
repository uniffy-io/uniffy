/**
 * ProjectHeader - Header section for the project view
 *
 * Contains:
 * - Project icon and title
 * - Task/member counts
 * - View tabs (Table/Board/Roadmap)
 * - Filter bar with search, filter builder, group by
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { MagnifyingGlass, Table, Columns, ChartLine, Check, Trash, X, Funnel, SquaresFour, CaretDown, Plus } from "@phosphor-icons/react";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  setViewMode,
  setSearchQuery,
  setFilterConfig,
  setGroupBy,
  selectViewMode,
  selectSearchQuery,
  selectSelectedTaskIds,
  selectActiveFilterConfig,
  selectActiveGroupByFieldId,
  clearSelection,
  openCreateTaskModal,
} from "@/features/projects/store/projectsUiSlice";
import { deleteTasks } from "@/features/projects/store/projectsThunks";
import { ProjectIcon } from "@/features/projects/utils/projectIcons";
import { SYSTEM_FIELD_IDS } from "@/features/projects/types";
import type { Project, ViewType } from "@/features/projects/types";
import { FilterBuilder } from "@/features/projects/components/views/table/FilterBuilder";
import { ManageStatusesDialog } from "@/features/projects/components/views/board/ManageStatusesDialog";
import { updateFieldDefinition } from "@/features/projects/store/projectsSlice";
import { updateFieldThunk } from "@/features/projects/store/projectsThunks";
import type { SelectOption } from "@/features/projects/types";

interface ProjectHeaderProps {
  project: Project;
  taskCount: number;
}

export function ProjectHeader({ project, taskCount }: ProjectHeaderProps) {
  const dispatch = useAppDispatch();
  const viewMode = useAppSelector(selectViewMode);
  const searchQuery = useAppSelector(selectSearchQuery);
  const selectedTaskIds = useAppSelector(selectSelectedTaskIds);
  const activeFilterConfig = useAppSelector(selectActiveFilterConfig);
  const activeGroupByFieldId = useAppSelector(selectActiveGroupByFieldId);
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
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <ProjectIcon
          icon={project.icon}
          size={20}
          weight="duotone"
          className="text-primary shrink-0"
        />
        <div className="min-w-0">
          <h1 className="font-medium text-foreground truncate">{project.name}</h1>
          <p className="text-xs text-muted-foreground">
            {taskCount} task{taskCount !== 1 ? "s" : ""} · {project.memberIds.length} member
            {project.memberIds.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          type="button"
          className="flex items-center gap-2 px-3 py-1.5 text-sm text-primary bg-transparent hover:bg-muted rounded-md transition-colors shrink-0"
          onClick={() => dispatch(openCreateTaskModal())}
        >
          <Plus size={16} weight="bold" />
          New Task
        </button>
      </div>

      {/* View Tabs + Filter Bar */}
      <div className="flex items-center gap-4 px-4 py-2">
        <div className="flex items-center gap-1">
          <ViewTab
            icon={<Table size={16} />}
            label="Table"
            isActive={viewMode === "table"}
            onClick={() => handleViewChange("table")}
          />
          <ViewTab
            icon={<Columns size={16} />}
            label="Board"
            isActive={viewMode === "board"}
            onClick={() => handleViewChange("board")}
          />
          <ViewTab
            icon={<ChartLine size={16} />}
            label="Roadmap"
            isActive={viewMode === "roadmap"}
            onClick={() => handleViewChange("roadmap")}
          />
        </div>

        <div className="h-5 w-px bg-border" />

        {/* Search */}
        <div className="relative flex-1 max-w-sm">
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
            <Funnel size={16} className="mr-1" />
            Filter
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

        {/* Manage Statuses Button (Board view only) */}
        {viewMode === "board" && (
            <div className="relative">
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsManageStatusesOpen(!isManageStatusesOpen)}
                >
                    <SquaresFour size={16} className="mr-1" />
                    Manage Statuses
                </Button>
                {isManageStatusesOpen && (
                    <div className="absolute top-9 left-0 z-50">
                        <ManageStatusesDialog
                            options={statusOptions}
                            onSave={handleUpdateStatuses}
                            onClose={() => setIsManageStatusesOpen(false)}
                        />
                    </div>
                )}
            </div>
        )}

        {/* Group By (Table view only) */}
        {viewMode === "table" && (
          <GroupByDropdown
            activeGroupByFieldId={activeGroupByFieldId}
            onSelect={(value) => dispatch(setGroupBy(value))}
          />
        )}

        {/* Selection actions or auto-save indicator */}
        {hasSelection ? (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">
              {selectedTaskIds.length} selected
            </span>
            <button
              onClick={() => setShowDeleteTasksConfirm(true)}
              className="p-1 rounded-md hover:bg-destructive/10 transition-colors"
              title="Delete selected tasks"
            >
              <Trash size={16} weight="duotone" className="text-destructive" />
            </button>
            <button
              onClick={() => dispatch(clearSelection())}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Clear selection"
            >
              <X size={14} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check size={14} weight="bold" />
            <span>Saved</span>
          </div>
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
        "flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-md transition-colors",
        isActive
          ? "text-primary bg-primary/10"
          : "text-muted-foreground hover:text-foreground hover:bg-muted"
      )}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

// ===== Group By Dropdown =====

const GROUP_BY_OPTIONS: { value: string | null; label: string }[] = [
  { value: null, label: "No grouping" },
  { value: SYSTEM_FIELD_IDS.STATUS, label: "Status" },
  { value: SYSTEM_FIELD_IDS.PRIORITY, label: "Priority" },
  { value: SYSTEM_FIELD_IDS.ASSIGNEE, label: "Assignee" },
];

interface GroupByDropdownProps {
  activeGroupByFieldId: string | null;
  onSelect: (value: string | null) => void;
}

function GroupByDropdown({ activeGroupByFieldId, onSelect }: GroupByDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeOption = GROUP_BY_OPTIONS.find((o) => o.value === activeGroupByFieldId);
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
          {GROUP_BY_OPTIONS.map((option) => {
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
