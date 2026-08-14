import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import type { DragState, HistoryEntry, ProjectScope } from "../types/ui";
import type { ViewType, FilterConfig, SortConfig } from "../types/views";
import { initialProjectsUiState } from "../types/ui";
import { saveColumnWidths, saveHiddenColumns } from "@/features/projects/utils/tableColumnStorage";

export const projectsUiSlice = createSlice({
  name: "projectsUi",
  initialState: initialProjectsUiState,
  reducers: {
    setViewMode: (state, action: PayloadAction<ViewType>) => {
      state.viewMode = action.payload;
    },

    setCurrentView: (state, action: PayloadAction<string | null>) => {
      state.currentViewId = action.payload;
    },

    selectTask: (state, action: PayloadAction<string | null>) => {
      state.selectedTaskId = action.payload;
      if (!state.isMultiSelectMode) {
        state.selectedTaskIds = action.payload ? [action.payload] : [];
      }
    },

    toggleTaskSelection: (state, action: PayloadAction<string>) => {
      const taskId = action.payload;
      const index = state.selectedTaskIds.indexOf(taskId);
      if (index === -1) {
        state.selectedTaskIds.push(taskId);
      } else {
        state.selectedTaskIds.splice(index, 1);
      }
      state.selectedTaskId =
        state.selectedTaskIds.length > 0
          ? state.selectedTaskIds[state.selectedTaskIds.length - 1]
          : null;
    },

    setMultiSelectMode: (state, action: PayloadAction<boolean>) => {
      state.isMultiSelectMode = action.payload;
      if (!action.payload) {
        state.selectedTaskIds = state.selectedTaskId ? [state.selectedTaskId] : [];
      }
    },

    selectAllTasks: (state, action: PayloadAction<string[]>) => {
      state.selectedTaskIds = action.payload;
      state.isMultiSelectMode = action.payload.length > 1;
      state.selectedTaskId =
        action.payload.length > 0 ? action.payload[action.payload.length - 1] : null;
    },

    clearSelection: (state) => {
      state.selectedTaskId = null;
      state.selectedTaskIds = [];
      state.isMultiSelectMode = false;
    },

    openDetailPanel: (state) => {
      state.isDetailPanelOpen = true;
    },

    closeDetailPanel: (state) => {
      state.isDetailPanelOpen = false;
    },

    toggleDetailPanel: (state) => {
      state.isDetailPanelOpen = !state.isDetailPanelOpen;
    },

    setDetailViewMode: (state, action: PayloadAction<"sidebar" | "modal">) => {
      state.detailViewMode = action.payload;
    },

    setDetailPanelWidth: (state, action: PayloadAction<number>) => {
      state.detailPanelWidth = action.payload;
    },

    toggleSidebar: (state) => {
      state.isSidebarOpen = !state.isSidebarOpen;
    },

    setSidebarWidth: (state, action: PayloadAction<number>) => {
      state.sidebarWidth = action.payload;
    },

    openCreateProjectModal: (state) => {
      state.isCreateProjectModalOpen = true;
    },

    closeCreateProjectModal: (state) => {
      state.isCreateProjectModalOpen = false;
    },

    openEditProjectModal: (state, action: PayloadAction<string>) => {
      state.editProjectId = action.payload;
    },

    closeEditProjectModal: (state) => {
      state.editProjectId = null;
    },

    openCreateTaskModal: (state) => {
      state.isCreateTaskModalOpen = true;
    },

    closeCreateTaskModal: (state) => {
      state.isCreateTaskModalOpen = false;
    },

    openFieldPicker: (state) => {
      state.isFieldPickerOpen = true;
    },

    closeFieldPicker: (state) => {
      state.isFieldPickerOpen = false;
    },

    openViewConfig: (state) => {
      state.isViewConfigOpen = true;
    },

    closeViewConfig: (state) => {
      state.isViewConfigOpen = false;
    },

    setEditingField: (state, action: PayloadAction<string | null>) => {
      state.editingFieldId = action.payload;
    },

    startDrag: (state, action: PayloadAction<DragState>) => {
      state.dragState = action.payload;
    },

    endDrag: (state) => {
      state.dragState = null;
    },

    setEditingCell: (state, action: PayloadAction<{ taskId: string; fieldId: string } | null>) => {
      state.editingCell = action.payload;
    },

    setFocusedCell: (state, action: PayloadAction<{ taskId: string; fieldId: string } | null>) => {
      state.focusedCell = action.payload;
    },

    setColumnWidths: (
      state,
      action: PayloadAction<{ projectId: string; widths: Record<string, number> }>,
    ) => {
      if (!state.columnWidths) state.columnWidths = {};
      state.columnWidths[action.payload.projectId] = action.payload.widths;
      saveColumnWidths(state.columnWidths);
    },

    setColumnWidth: (
      state,
      action: PayloadAction<{ projectId: string; fieldId: string; width: number }>,
    ) => {
      const { projectId, fieldId, width } = action.payload;
      if (!state.columnWidths) state.columnWidths = {};
      if (!state.columnWidths[projectId]) {
        state.columnWidths[projectId] = {};
      }
      state.columnWidths[projectId][fieldId] = width;
      saveColumnWidths(state.columnWidths);
    },

    hideColumn: (state, action: PayloadAction<{ projectId: string; fieldId: string }>) => {
      const { projectId, fieldId } = action.payload;
      if (!state.hiddenColumns) state.hiddenColumns = {};
      const current = state.hiddenColumns[projectId] ?? [];
      if (!current.includes(fieldId)) {
        state.hiddenColumns[projectId] = [...current, fieldId];
        saveHiddenColumns(state.hiddenColumns);
      }
    },

    showColumn: (state, action: PayloadAction<{ projectId: string; fieldId: string }>) => {
      const { projectId, fieldId } = action.payload;
      if (!state.hiddenColumns) state.hiddenColumns = {};
      const current = state.hiddenColumns[projectId] ?? [];
      const next = current.filter((id) => id !== fieldId);
      if (next.length !== current.length) {
        state.hiddenColumns[projectId] = next;
        saveHiddenColumns(state.hiddenColumns);
      }
    },

    setProjectScope: (state, action: PayloadAction<ProjectScope>) => {
      state.projectScope = action.payload;
    },

    setFilterConfig: (state, action: PayloadAction<FilterConfig | null>) => {
      state.activeFilterConfig = action.payload;
    },

    setSortConfig: (state, action: PayloadAction<SortConfig | null>) => {
      state.activeSortConfig = action.payload;
    },

    setGroupBy: (state, action: PayloadAction<string | null>) => {
      state.activeGroupByFieldId = action.payload;
    },

    setTableOutlineEnabled: (state, action: PayloadAction<boolean>) => {
      state.tableOutlineEnabled = action.payload;
    },

    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },

    setSprintFilter: (state, action: PayloadAction<string | null>) => {
      state.sprintFilter = action.payload;
    },

    setTaskTypeFilter: (state, action: PayloadAction<string | null>) => {
      state.taskTypeFilter = action.payload;
    },

    setRootOnlyFilter: (state, action: PayloadAction<boolean>) => {
      state.rootOnlyFilter = action.payload;
    },

    setInEpicFilter: (state, action: PayloadAction<string | null>) => {
      state.inEpicFilter = action.payload;
    },

    setRoadmapStartDate: (state, action: PayloadAction<string>) => {
      state.roadmapStartDate = action.payload;
    },

    setRoadmapZoom: (state, action: PayloadAction<"day" | "week" | "month">) => {
      state.roadmapZoomLevel = action.payload;
    },

    setTaskSaving: (state, action: PayloadAction<{ taskId: string; isSaving: boolean }>) => {
      state.autosave.isSaving[action.payload.taskId] = action.payload.isSaving;
    },

    setTaskLastSaved: (state, action: PayloadAction<{ taskId: string; timestamp: string }>) => {
      state.autosave.lastSaved[action.payload.taskId] = action.payload.timestamp;
      state.autosave.hasChanges[action.payload.taskId] = false;
    },

    setTaskHasChanges: (state, action: PayloadAction<{ taskId: string; hasChanges: boolean }>) => {
      state.autosave.hasChanges[action.payload.taskId] = action.payload.hasChanges;
    },

    pushUndo: (state, action: PayloadAction<HistoryEntry>) => {
      state.undoStack.push(action.payload);
      if (state.undoStack.length > 50) {
        state.undoStack.shift();
      }
      state.redoStack = [];
    },

    popUndo: (state) => {
      const entry = state.undoStack.pop();
      if (entry) {
        state.redoStack.push(entry);
      }
    },

    popRedo: (state) => {
      const entry = state.redoStack.pop();
      if (entry) {
        state.undoStack.push(entry);
      }
    },

    clearHistory: (state) => {
      state.undoStack = [];
      state.redoStack = [];
    },

    resetUiState: () => initialProjectsUiState,
  },
});

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
  setDetailViewMode,
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
  hideColumn,
  showColumn,
  setProjectScope,
  setFilterConfig,
  setSortConfig,
  setGroupBy,
  setTableOutlineEnabled,
  setSearchQuery,
  setSprintFilter,
  setTaskTypeFilter,
  setRootOnlyFilter,
  setInEpicFilter,
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

export const selectViewMode = (state: RootState) => state.projectsUi.viewMode;
export const selectCurrentViewId = (state: RootState) => state.projectsUi.currentViewId;
export const selectSelectedTaskId = (state: RootState) => state.projectsUi.selectedTaskId;
export const selectSelectedTaskIds = (state: RootState) => state.projectsUi.selectedTaskIds;
export const selectIsMultiSelectMode = (state: RootState) => state.projectsUi.isMultiSelectMode;
export const selectIsDetailPanelOpen = (state: RootState) => state.projectsUi.isDetailPanelOpen;
export const selectDetailViewMode = (state: RootState) => state.projectsUi.detailViewMode;
export const selectIsSidebarOpen = (state: RootState) => state.projectsUi.isSidebarOpen;
export const selectDragState = (state: RootState) => state.projectsUi.dragState;
export const selectProjectScope = (state: RootState) => state.projectsUi.projectScope;
export const selectSearchQuery = (state: RootState) => state.projectsUi.searchQuery;
export const selectAutosaveState = (state: RootState) => state.projectsUi.autosave;
export const selectActiveSortConfig = (state: RootState) => state.projectsUi.activeSortConfig;
export const selectActiveFilterConfig = (state: RootState) => state.projectsUi.activeFilterConfig;
export const selectActiveGroupByFieldId = (state: RootState) =>
  state.projectsUi.activeGroupByFieldId;
export const selectTableOutlineEnabled = (state: RootState) => state.projectsUi.tableOutlineEnabled;
export const selectSprintFilter = (state: RootState) => state.projectsUi.sprintFilter;
export const selectTaskTypeFilter = (state: RootState) => state.projectsUi.taskTypeFilter;
export const selectRootOnlyFilter = (state: RootState) => state.projectsUi.rootOnlyFilter;
export const selectInEpicFilter = (state: RootState) => state.projectsUi.inEpicFilter;
export const selectEditingCell = (state: RootState) => state.projectsUi.editingCell;
export const selectFocusedCell = (state: RootState) => state.projectsUi.focusedCell;
export const selectColumnWidthsForProject =
  (projectId: string) =>
  (state: RootState): Record<string, number> =>
    state.projectsUi.columnWidths?.[projectId] ?? {};
export const selectHiddenColumnsForProject =
  (projectId: string) =>
  (state: RootState): string[] =>
    state.projectsUi.hiddenColumns?.[projectId] ?? [];
export const selectUndoStack = (state: RootState) => state.projectsUi.undoStack;
export const selectRedoStack = (state: RootState) => state.projectsUi.redoStack;
export const selectEditProjectId = (state: RootState) => state.projectsUi.editProjectId;
export const selectCanUndo = (state: RootState) => state.projectsUi.undoStack.length > 0;
export const selectCanRedo = (state: RootState) => state.projectsUi.redoStack.length > 0;

export const projectsUiReducer = projectsUiSlice.reducer;
