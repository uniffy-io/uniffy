import type { ViewType, FilterConfig, SortConfig } from "./views";

export type ProjectScope = "all" | "personal" | "organization";

export interface LoadingState {
  projects: boolean;
  tasks: boolean;
  creating: boolean;
  /** ID of item being updated. */
  updating: string | null;
  /** ID of item being deleted. */
  deleting: string | null;
}

export interface ErrorState {
  projects: string | null;
  tasks: string | null;
  general: string | null;
}

export interface DragState {
  taskId: string;
  sourceColumnId?: string;
  sourceDate?: string;
  isDragging: boolean;
}

export interface AutosaveState {
  isSaving: Record<string, boolean>;
  lastSaved: Record<string, string>;
  hasChanges: Record<string, boolean>;
}

export interface HistoryEntry {
  id: string;
  actionType: string;
  taskId: string;
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
  timestamp: number;
  description: string;
}

export interface ProjectsUiState {
  viewMode: ViewType;
  currentViewId: string | null;

  selectedTaskId: string | null;
  selectedTaskIds: string[];

  isDetailPanelOpen: boolean;
  isSidebarOpen: boolean;
  detailPanelWidth: number;
  sidebarWidth: number;
  detailViewMode: "sidebar" | "modal";

  isCreateProjectModalOpen: boolean;
  editProjectId: string | null;
  isCreateTaskModalOpen: boolean;
  isFieldPickerOpen: boolean;
  isViewConfigOpen: boolean;
  editingFieldId: string | null;

  dragState: DragState | null;

  editingCell: { taskId: string; fieldId: string } | null;

  focusedCell: { taskId: string; fieldId: string } | null;

  /** Keyed by projectId -> fieldId -> px width. */
  columnWidths: Record<string, Record<string, number>>;

  /** Keyed by projectId -> hidden field ids. */
  hiddenColumns: Record<string, string[]>;

  projectScope: ProjectScope;

  /** Transient filter/sort/group state - not persisted to view config. */
  activeFilterConfig: FilterConfig | null;
  activeSortConfig: SortConfig | null;
  activeGroupByFieldId: string | null;
  searchQuery: string;

  /** Sprint ID, `__backlog__` for unassigned, or null for all. */
  sprintFilter: string | null;
  taskTypeFilter: string | null;
  /** Only top-level tasks (parent_id IS NULL). */
  rootOnlyFilter: boolean;
  /** Scope tasks to the ancestry of this epic. */
  inEpicFilter: string | null;

  tableOutlineEnabled: boolean;

  roadmapStartDate: string;
  roadmapZoomLevel: "day" | "week" | "month";

  autosave: AutosaveState;

  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
}

function localTodayString(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

import { loadColumnWidths, loadHiddenColumns } from "@/features/projects/utils/tableColumnStorage";

export const initialProjectsUiState: ProjectsUiState = {
  viewMode: "table",
  currentViewId: null,

  selectedTaskId: null,
  selectedTaskIds: [],

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

  columnWidths: loadColumnWidths(),
  hiddenColumns: loadHiddenColumns(),

  projectScope: "all",

  activeFilterConfig: null,
  activeSortConfig: null,
  activeGroupByFieldId: null,
  searchQuery: "",

  sprintFilter: null,
  taskTypeFilter: null,
  rootOnlyFilter: false,
  inEpicFilter: null,

  tableOutlineEnabled: true,

  roadmapStartDate: localTodayString(),
  roadmapZoomLevel: "week",

  autosave: {
    isSaving: {},
    lastSaved: {},
    hasChanges: {},
  },

  undoStack: [],
  redoStack: [],
};

export interface PanelConfig {
  id: string;
  minSize: number;
  maxSize: number;
  defaultSize: number;
  collapsible: boolean;
}

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
