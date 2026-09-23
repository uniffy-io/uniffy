import type { ViewDefinition } from "./views";

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
  /** Last opened view per project id. */
  activeViewIds: Record<string, string>;
  /**
   * Unsaved edits per project id, then per view id (view ids repeat across projects). A view with
   * no entry shows its saved definition; an entry is dropped once it matches the saved one again.
   */
  viewDrafts: Record<string, Record<string, ViewDefinition>>;
  /** Expanded parent rows of the table outline per project; row state, never part of a view. */
  outlineExpanded: Record<string, string[]>;

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

  projectScope: ProjectScope;

  /** Transient: a search never belongs to a view and never makes one dirty. */
  searchQuery: string;

  roadmapStartDate: string;

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

export const initialProjectsUiState: ProjectsUiState = {
  activeViewIds: {},
  viewDrafts: {},
  outlineExpanded: {},

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

  projectScope: "all",

  searchQuery: "",

  roadmapStartDate: localTodayString(),

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
