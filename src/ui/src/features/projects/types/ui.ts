import type { ViewType, FilterConfig, SortConfig } from "./views";

/**
 * Scope filter for project list (matches Calendar's EventScope pattern)
 */
export type ProjectScope = "all" | "personal" | "organization";

/**
 * Loading state for async operations
 */
export interface LoadingState {
  projects: boolean;
  tasks: boolean;
  creating: boolean;
  updating: string | null; // ID of item being updated
  deleting: string | null; // ID of item being deleted
}

/**
 * Error state for async operations
 */
export interface ErrorState {
  projects: string | null;
  tasks: string | null;
  general: string | null;
}

/**
 * Drag state for board and roadmap views
 */
export interface DragState {
  taskId: string;
  sourceColumnId?: string; // For board view
  sourceDate?: string; // For roadmap view
  isDragging: boolean;
}

/**
 * Autosave state
 */
export interface AutosaveState {
  isSaving: Record<string, boolean>; // taskId -> isSaving
  lastSaved: Record<string, string>; // taskId -> timestamp
  hasChanges: Record<string, boolean>; // taskId -> hasUnsavedChanges
}

/**
 * A single undo/redo history entry
 */
export interface HistoryEntry {
  id: string;
  actionType: string;
  taskId: string;
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  timestamp: number;
  description: string;
}

/**
 * UI state for the projects feature
 */
export interface ProjectsUiState {
  // View state
  viewMode: ViewType;
  currentViewId: string | null;

  // Selection state
  selectedTaskId: string | null;
  selectedTaskIds: string[]; // For multi-select
  isMultiSelectMode: boolean;

  // Panel state
  isDetailPanelOpen: boolean;
  isSidebarOpen: boolean;
  detailPanelWidth: number;
  sidebarWidth: number;
  detailViewMode: "sidebar" | "modal";

  // Modal state
  isCreateProjectModalOpen: boolean;
  editProjectId: string | null;
  isCreateTaskModalOpen: boolean;
  isFieldPickerOpen: boolean;
  isViewConfigOpen: boolean;
  editingFieldId: string | null;

  // Drag state
  dragState: DragState | null;

  // Inline editing state
  editingCell: { taskId: string; fieldId: string } | null;

  // Keyboard navigation state
  focusedCell: { taskId: string; fieldId: string } | null;

  // Table view state
  columnWidths: Record<string, number>;

  // Scope filter (all/personal/organization)
  projectScope: ProjectScope;

  // Filter and sort (transient, not saved to view config)
  activeFilterConfig: FilterConfig | null;
  activeSortConfig: SortConfig | null;
  activeGroupByFieldId: string | null;
  searchQuery: string;

  // Quick filters
  sprintFilter: string | null; // sprint ID, "__backlog__" for unassigned, or null for all
  taskTypeFilter: string | null; // task type value or null for all

  // Roadmap view state
  roadmapStartDate: string; // ISO date string
  roadmapZoomLevel: "day" | "week" | "month";

  // Autosave
  autosave: AutosaveState;

  // Undo/Redo history
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
}

/**
 * Initial UI state
 */
export const initialProjectsUiState: ProjectsUiState = {
  viewMode: "table",
  currentViewId: null,

  selectedTaskId: null,
  selectedTaskIds: [],
  isMultiSelectMode: false,

  isDetailPanelOpen: false,
  isSidebarOpen: true,
  detailPanelWidth: 400,
  sidebarWidth: 280,
  detailViewMode: "sidebar",

  isCreateProjectModalOpen: false,
  editProjectId: null,
  isCreateTaskModalOpen: false,
  isFieldPickerOpen: false,
  isViewConfigOpen: false,
  editingFieldId: null,

  dragState: null,

  editingCell: null,

  focusedCell: null,

  columnWidths: {},

  projectScope: "all",

  activeFilterConfig: null,
  activeSortConfig: null,
  activeGroupByFieldId: null,
  searchQuery: "",

  sprintFilter: null,
  taskTypeFilter: null,

  roadmapStartDate: new Date().toISOString().split("T")[0],
  roadmapZoomLevel: "week",

  autosave: {
    isSaving: {},
    lastSaved: {},
    hasChanges: {},
  },

  undoStack: [],
  redoStack: [],
};

/**
 * Panel configuration for resizable layout
 */
export interface PanelConfig {
  id: string;
  minSize: number;
  maxSize: number;
  defaultSize: number;
  collapsible: boolean;
}

/**
 * Layout panel configurations
 */
export const PANEL_CONFIG = {
  sidebar: {
    id: "projects-sidebar",
    minSize: 200,
    maxSize: 400,
    defaultSize: 280,
    collapsible: true,
  } as PanelConfig,
  main: {
    id: "projects-main",
    minSize: 500,
    maxSize: Infinity,
    defaultSize: 800,
    collapsible: false,
  } as PanelConfig,
  detail: {
    id: "projects-detail",
    minSize: 300,
    maxSize: 600,
    defaultSize: 400,
    collapsible: true,
  } as PanelConfig,
};
