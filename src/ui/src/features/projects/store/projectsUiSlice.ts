import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import type { DragState, HistoryEntry, ProjectScope } from "../types/ui";
import type { ViewType, FilterConfig, SortConfig } from "../types/views";
import { initialProjectsUiState } from "../types/ui";

export const projectsUiSlice = createSlice({
  name: "projectsUi",
  initialState: initialProjectsUiState,
  reducers: {
    // ===== View State =====

    /**
     * Set the current view mode (table/board/roadmap)
     */
    setViewMode: (state, action: PayloadAction<ViewType>) => {
      state.viewMode = action.payload;
    },

    /**
     * Set the current view configuration ID
     */
    setCurrentView: (state, action: PayloadAction<string | null>) => {
      state.currentViewId = action.payload;
    },

    // ===== Selection State =====

    /**
     * Select a single task
     */
    selectTask: (state, action: PayloadAction<string | null>) => {
      state.selectedTaskId = action.payload;
      // Clear multi-select when single-selecting
      if (!state.isMultiSelectMode) {
        state.selectedTaskIds = action.payload ? [action.payload] : [];
      }
    },

    /**
     * Toggle task selection (for multi-select)
     */
    toggleTaskSelection: (state, action: PayloadAction<string>) => {
      const taskId = action.payload;
      const index = state.selectedTaskIds.indexOf(taskId);
      if (index === -1) {
        state.selectedTaskIds.push(taskId);
      } else {
        state.selectedTaskIds.splice(index, 1);
      }
      // Update primary selection
      state.selectedTaskId = state.selectedTaskIds.length > 0
        ? state.selectedTaskIds[state.selectedTaskIds.length - 1]
        : null;
    },

    /**
     * Set multi-select mode
     */
    setMultiSelectMode: (state, action: PayloadAction<boolean>) => {
      state.isMultiSelectMode = action.payload;
      if (!action.payload) {
        // Keep only the primary selection when exiting multi-select
        state.selectedTaskIds = state.selectedTaskId ? [state.selectedTaskId] : [];
      }
    },

    /**
     * Select all tasks (from a given list of IDs)
     */
    selectAllTasks: (state, action: PayloadAction<string[]>) => {
      state.selectedTaskIds = action.payload;
      state.isMultiSelectMode = action.payload.length > 1;
      state.selectedTaskId = action.payload.length > 0
        ? action.payload[action.payload.length - 1]
        : null;
    },

    /**
     * Clear all task selections
     */
    clearSelection: (state) => {
      state.selectedTaskId = null;
      state.selectedTaskIds = [];
      state.isMultiSelectMode = false;
    },

    // ===== Panel State =====

    /**
     * Open the task detail panel
     */
    openDetailPanel: (state) => {
      state.isDetailPanelOpen = true;
    },

    /**
     * Close the task detail panel
     */
    closeDetailPanel: (state) => {
      state.isDetailPanelOpen = false;
    },

    /**
     * Toggle the task detail panel
     */
    toggleDetailPanel: (state) => {
      state.isDetailPanelOpen = !state.isDetailPanelOpen;
    },

    /**
     * Set detail panel width
     */
    setDetailPanelWidth: (state, action: PayloadAction<number>) => {
      state.detailPanelWidth = action.payload;
    },

    /**
     * Toggle the sidebar
     */
    toggleSidebar: (state) => {
      state.isSidebarOpen = !state.isSidebarOpen;
    },

    /**
     * Set sidebar width
     */
    setSidebarWidth: (state, action: PayloadAction<number>) => {
      state.sidebarWidth = action.payload;
    },

    // ===== Modal State =====

    /**
     * Open create project modal
     */
    openCreateProjectModal: (state) => {
      state.isCreateProjectModalOpen = true;
    },

    /**
     * Close create project modal
     */
    closeCreateProjectModal: (state) => {
      state.isCreateProjectModalOpen = false;
    },

    /**
     * Open edit project modal for a specific project
     */
    openEditProjectModal: (state, action: PayloadAction<string>) => {
      state.editProjectId = action.payload;
    },

    /**
     * Close edit project modal
     */
    closeEditProjectModal: (state) => {
      state.editProjectId = null;
    },

    /**
     * Open create task modal
     */
    openCreateTaskModal: (state) => {
      state.isCreateTaskModalOpen = true;
    },

    /**
     * Close create task modal
     */
    closeCreateTaskModal: (state) => {
      state.isCreateTaskModalOpen = false;
    },

    /**
     * Open field type picker
     */
    openFieldPicker: (state) => {
      state.isFieldPickerOpen = true;
    },

    /**
     * Close field type picker
     */
    closeFieldPicker: (state) => {
      state.isFieldPickerOpen = false;
    },

    /**
     * Open view configuration
     */
    openViewConfig: (state) => {
      state.isViewConfigOpen = true;
    },

    /**
     * Close view configuration
     */
    closeViewConfig: (state) => {
      state.isViewConfigOpen = false;
    },

    /**
     * Set the field being edited
     */
    setEditingField: (state, action: PayloadAction<string | null>) => {
      state.editingFieldId = action.payload;
    },

    // ===== Drag State =====

    /**
     * Start dragging a task
     */
    startDrag: (state, action: PayloadAction<DragState>) => {
      state.dragState = action.payload;
    },

    /**
     * End dragging
     */
    endDrag: (state) => {
      state.dragState = null;
    },

    // ===== Inline Editing =====

    /**
     * Set the cell being edited (taskId + fieldId) or null to clear
     */
    setEditingCell: (state, action: PayloadAction<{ taskId: string; fieldId: string } | null>) => {
      state.editingCell = action.payload;
    },

    // ===== Keyboard Navigation =====

    /**
     * Set the focused cell for keyboard navigation
     */
    setFocusedCell: (state, action: PayloadAction<{ taskId: string; fieldId: string } | null>) => {
      state.focusedCell = action.payload;
    },

    // ===== Table View State =====

    /**
     * Set column widths
     */
    setColumnWidths: (state, action: PayloadAction<Record<string, number>>) => {
      state.columnWidths = action.payload;
    },

    /**
     * Update a single column width
     */
    setColumnWidth: (state, action: PayloadAction<{ fieldId: string; width: number }>) => {
      state.columnWidths[action.payload.fieldId] = action.payload.width;
    },

    // ===== Scope Filter =====

    /**
     * Set the project scope filter (all/personal/organization)
     */
    setProjectScope: (state, action: PayloadAction<ProjectScope>) => {
      state.projectScope = action.payload;
    },

    // ===== Filter and Sort State =====

    /**
     * Set active filter configuration
     */
    setFilterConfig: (state, action: PayloadAction<FilterConfig | null>) => {
      state.activeFilterConfig = action.payload;
    },

    /**
     * Set active sort configuration
     */
    setSortConfig: (state, action: PayloadAction<SortConfig | null>) => {
      state.activeSortConfig = action.payload;
    },

    /**
     * Set group by field
     */
    setGroupBy: (state, action: PayloadAction<string | null>) => {
      state.activeGroupByFieldId = action.payload;
    },

    /**
     * Set search query
     */
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },

    /**
     * Set sprint quick filter
     */
    setSprintFilter: (state, action: PayloadAction<string | null>) => {
      state.sprintFilter = action.payload;
    },

    /**
     * Set task type quick filter
     */
    setTaskTypeFilter: (state, action: PayloadAction<string | null>) => {
      state.taskTypeFilter = action.payload;
    },

    // ===== Roadmap State =====

    /**
     * Set roadmap start date
     */
    setRoadmapStartDate: (state, action: PayloadAction<string>) => {
      state.roadmapStartDate = action.payload;
    },

    /**
     * Set roadmap zoom level
     */
    setRoadmapZoom: (state, action: PayloadAction<"day" | "week" | "month">) => {
      state.roadmapZoomLevel = action.payload;
    },

    // ===== Autosave State =====

    /**
     * Set autosave state for a task
     */
    setTaskSaving: (state, action: PayloadAction<{ taskId: string; isSaving: boolean }>) => {
      state.autosave.isSaving[action.payload.taskId] = action.payload.isSaving;
    },

    /**
     * Set last saved timestamp for a task
     */
    setTaskLastSaved: (state, action: PayloadAction<{ taskId: string; timestamp: string }>) => {
      state.autosave.lastSaved[action.payload.taskId] = action.payload.timestamp;
      state.autosave.hasChanges[action.payload.taskId] = false;
    },

    /**
     * Mark task as having unsaved changes
     */
    setTaskHasChanges: (state, action: PayloadAction<{ taskId: string; hasChanges: boolean }>) => {
      state.autosave.hasChanges[action.payload.taskId] = action.payload.hasChanges;
    },

    // ===== Reset =====

    // ===== Undo/Redo =====

    /**
     * Push an entry to the undo stack (clears redo stack)
     */
    pushUndo: (state, action: PayloadAction<HistoryEntry>) => {
      state.undoStack.push(action.payload);
      // Limit stack to 50 entries
      if (state.undoStack.length > 50) {
        state.undoStack.shift();
      }
      state.redoStack = [];
    },

    /**
     * Pop from undo stack and push to redo stack
     */
    popUndo: (state) => {
      const entry = state.undoStack.pop();
      if (entry) {
        state.redoStack.push(entry);
      }
    },

    /**
     * Pop from redo stack and push to undo stack
     */
    popRedo: (state) => {
      const entry = state.redoStack.pop();
      if (entry) {
        state.undoStack.push(entry);
      }
    },

    /**
     * Clear all history
     */
    clearHistory: (state) => {
      state.undoStack = [];
      state.redoStack = [];
    },

    /**
     * Reset UI state (e.g., on logout)
     */
    resetUiState: () => initialProjectsUiState,
  },
});

// Actions
export const {
  setViewMode,
  setCurrentView,
  selectTask,
  toggleTaskSelection,
  selectAllTasks,
  setMultiSelectMode,
  clearSelection,
  openDetailPanel,
  closeDetailPanel,
  toggleDetailPanel,
  setDetailPanelWidth,
  toggleSidebar,
  setSidebarWidth,
  openCreateProjectModal,
  closeCreateProjectModal,
  openEditProjectModal,
  closeEditProjectModal,
  openCreateTaskModal,
  closeCreateTaskModal,
  openFieldPicker,
  closeFieldPicker,
  openViewConfig,
  closeViewConfig,
  setEditingField,
  setEditingCell,
  setFocusedCell,
  startDrag,
  endDrag,
  setColumnWidths,
  setColumnWidth,
  setProjectScope,
  setFilterConfig,
  setSortConfig,
  setGroupBy,
  setSearchQuery,
  setSprintFilter,
  setTaskTypeFilter,
  setRoadmapStartDate,
  setRoadmapZoom,
  setTaskSaving,
  setTaskLastSaved,
  setTaskHasChanges,
  pushUndo,
  popUndo,
  popRedo,
  clearHistory,
  resetUiState,
} = projectsUiSlice.actions;

// Selectors
export const selectViewMode = (state: RootState) => state.projectsUi.viewMode;
export const selectCurrentViewId = (state: RootState) => state.projectsUi.currentViewId;
export const selectSelectedTaskId = (state: RootState) => state.projectsUi.selectedTaskId;
export const selectSelectedTaskIds = (state: RootState) => state.projectsUi.selectedTaskIds;
export const selectIsMultiSelectMode = (state: RootState) => state.projectsUi.isMultiSelectMode;
export const selectIsDetailPanelOpen = (state: RootState) => state.projectsUi.isDetailPanelOpen;
export const selectIsSidebarOpen = (state: RootState) => state.projectsUi.isSidebarOpen;
export const selectDragState = (state: RootState) => state.projectsUi.dragState;
export const selectProjectScope = (state: RootState) => state.projectsUi.projectScope;
export const selectSearchQuery = (state: RootState) => state.projectsUi.searchQuery;
export const selectAutosaveState = (state: RootState) => state.projectsUi.autosave;
export const selectActiveSortConfig = (state: RootState) => state.projectsUi.activeSortConfig;
export const selectActiveFilterConfig = (state: RootState) => state.projectsUi.activeFilterConfig;
export const selectActiveGroupByFieldId = (state: RootState) => state.projectsUi.activeGroupByFieldId;
export const selectSprintFilter = (state: RootState) => state.projectsUi.sprintFilter;
export const selectTaskTypeFilter = (state: RootState) => state.projectsUi.taskTypeFilter;
export const selectEditingCell = (state: RootState) => state.projectsUi.editingCell;
export const selectFocusedCell = (state: RootState) => state.projectsUi.focusedCell;
export const selectUndoStack = (state: RootState) => state.projectsUi.undoStack;
export const selectRedoStack = (state: RootState) => state.projectsUi.redoStack;
export const selectEditProjectId = (state: RootState) => state.projectsUi.editProjectId;
export const selectCanUndo = (state: RootState) => state.projectsUi.undoStack.length > 0;
export const selectCanRedo = (state: RootState) => state.projectsUi.redoStack.length > 0;

export const projectsUiReducer = projectsUiSlice.reducer;
