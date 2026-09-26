import type { ViewDefinition } from "@/features/projects/types/views";

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
  /** Personal tab order per project, independent of shared view definitions. */
  viewTabOrder: Record<string, string[]>;
  /** Drafts are scoped by project because view ids repeat across projects. */
  viewDrafts: Record<string, Record<string, ViewDefinition>>;
  viewSaveRequests: Record<string, Record<string, string>>;
  /** Expanded parent rows of the table outline per project; row state, never part of a view. */
  outlineExpanded: Record<string, string[]>;

  selectedTaskId: string | null;
  selectedTaskIds: string[];

  isDetailPanelOpen: boolean;
  isSidebarOpen: boolean;
  sidebarWidth: number;
  detailViewMode: "sidebar" | "modal";

  isCreateProjectModalOpen: boolean;
  isCreateTaskModalOpen: boolean;

  editingCell: { taskId: string; fieldId: string } | null;

  focusedCell: { taskId: string; fieldId: string } | null;

  projectScope: ProjectScope;

  /** Transient: a search never belongs to a view and never makes one dirty. */
  searchQuery: string;

  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
}

export const initialProjectsUiState: ProjectsUiState = {
  activeViewIds: {},
  viewTabOrder: {},
  viewDrafts: {},
  viewSaveRequests: {},
  outlineExpanded: {},

  selectedTaskId: null,
  selectedTaskIds: [],

  isDetailPanelOpen: false,
  isSidebarOpen: true,
  sidebarWidth: 280,
  detailViewMode: "sidebar",

  isCreateProjectModalOpen: false,
  isCreateTaskModalOpen: false,

  editingCell: null,

  focusedCell: null,

  projectScope: "all",

  searchQuery: "",

  undoStack: [],
  redoStack: [],
};
