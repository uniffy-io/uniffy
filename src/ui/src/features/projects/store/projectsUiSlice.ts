import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import type { HistoryEntry, ProjectScope } from "@/features/projects/types/ui";
import type { ViewDefinition } from "@/features/projects/types/views";
import { initialProjectsUiState } from "@/features/projects/types/ui";
import { deleteTasks } from "@/features/projects/store/projectsThunks";
import { definitionsEqual } from "@/features/projects/utils/viewDraft";
import { AUTH_ACTION_TYPES } from "@/features/auth/store/authActions";

interface ViewKey {
  projectId: string;
  viewId: string;
}

export const projectsUiSlice = createSlice({
  name: "projectsUi",
  initialState: initialProjectsUiState,
  reducers: {
    // Checkbox selection is a per-view gesture: not every view can show it, so it never carries across.
    openView: (state, action: PayloadAction<ViewKey>) => {
      const { projectId, viewId } = action.payload;
      if (state.activeViewIds[projectId] !== viewId) state.selectedTaskIds = [];
      state.activeViewIds[projectId] = viewId;
    },

    setViewTabOrder: (state, action: PayloadAction<{ projectId: string; viewIds: string[] }>) => {
      state.viewTabOrder[action.payload.projectId] = action.payload.viewIds;
    },

    putViewDraft: (state, action: PayloadAction<ViewKey & { definition: ViewDefinition }>) => {
      const { projectId, viewId, definition } = action.payload;
      state.viewDrafts[projectId] = { ...state.viewDrafts[projectId], [viewId]: definition };
    },

    dropViewDraft: (state, action: PayloadAction<ViewKey>) => {
      const { projectId, viewId } = action.payload;
      const drafts = state.viewDrafts[projectId];
      if (!drafts || !(viewId in drafts)) return;
      delete drafts[viewId];
      if (Object.keys(drafts).length === 0) delete state.viewDrafts[projectId];
    },

    beginViewSave: (state, action: PayloadAction<ViewKey & { requestId: string }>) => {
      const { projectId, viewId, requestId } = action.payload;
      state.viewSaveRequests[projectId] = {
        ...state.viewSaveRequests[projectId],
        [viewId]: requestId,
      };
    },

    finishViewSave: (
      state,
      action: PayloadAction<ViewKey & { requestId: string; definition?: ViewDefinition }>,
    ) => {
      const { projectId, viewId, requestId, definition } = action.payload;
      const requests = state.viewSaveRequests[projectId];
      if (requests?.[viewId] !== requestId) return;
      delete requests[viewId];
      if (Object.keys(requests).length === 0) delete state.viewSaveRequests[projectId];
      const drafts = state.viewDrafts[projectId];
      if (drafts?.[viewId] && definition && definitionsEqual(drafts[viewId], definition)) {
        delete drafts[viewId];
        if (Object.keys(drafts).length === 0) delete state.viewDrafts[projectId];
      }
    },

    toggleOutlineRow: (state, action: PayloadAction<{ projectId: string; taskId: string }>) => {
      const { projectId, taskId } = action.payload;
      const expanded = state.outlineExpanded[projectId] ?? [];
      state.outlineExpanded[projectId] = expanded.includes(taskId)
        ? expanded.filter((id) => id !== taskId)
        : [...expanded, taskId];
    },

    expandOutlineRow: (state, action: PayloadAction<{ projectId: string; taskId: string }>) => {
      const { projectId, taskId } = action.payload;
      const expanded = state.outlineExpanded[projectId] ?? [];
      if (!expanded.includes(taskId)) state.outlineExpanded[projectId] = [...expanded, taskId];
    },

    // The task open in the detail panel and the checkbox selection are independent:
    // opening a task never checks it, and checking a task never changes what is open.
    selectTask: (state, action: PayloadAction<string | null>) => {
      state.selectedTaskId = action.payload;
    },

    toggleTaskSelection: (state, action: PayloadAction<string>) => {
      const taskId = action.payload;
      const index = state.selectedTaskIds.indexOf(taskId);
      if (index === -1) {
        state.selectedTaskIds.push(taskId);
      } else {
        state.selectedTaskIds.splice(index, 1);
      }
    },

    selectAllTasks: (state, action: PayloadAction<string[]>) => {
      state.selectedTaskIds = action.payload;
    },

    clearSelection: (state) => {
      state.selectedTaskIds = [];
    },

    openDetailPanel: (state) => {
      state.isDetailPanelOpen = true;
    },

    closeDetailPanel: (state) => {
      state.isDetailPanelOpen = false;
    },

    setDetailViewMode: (state, action: PayloadAction<"sidebar" | "modal">) => {
      state.detailViewMode = action.payload;
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

    openCreateTaskModal: (state) => {
      state.isCreateTaskModalOpen = true;
    },

    closeCreateTaskModal: (state) => {
      state.isCreateTaskModalOpen = false;
    },

    setEditingCell: (state, action: PayloadAction<{ taskId: string; fieldId: string } | null>) => {
      state.editingCell = action.payload;
    },

    setFocusedCell: (state, action: PayloadAction<{ taskId: string; fieldId: string } | null>) => {
      state.focusedCell = action.payload;
    },

    setProjectScope: (state, action: PayloadAction<ProjectScope>) => {
      state.projectScope = action.payload;
    },

    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
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
  },
  extraReducers: (builder) => {
    // Drafts and the last opened views describe one person's work; the next account starts clean.
    builder.addCase(AUTH_ACTION_TYPES.LOGOUT, (state) => {
      state.activeViewIds = {};
      state.viewTabOrder = {};
      state.viewDrafts = {};
      state.viewSaveRequests = {};
      state.outlineExpanded = {};
      state.searchQuery = "";
    });
    builder.addCase(deleteTasks.fulfilled, (state, action) => {
      const deleted = new Set(action.payload);
      state.selectedTaskIds = state.selectedTaskIds.filter((id) => !deleted.has(id));
      if (state.selectedTaskId && deleted.has(state.selectedTaskId)) {
        state.selectedTaskId = null;
        state.isDetailPanelOpen = false;
      }
    });
  },
});

export const {
  openView,
  setViewTabOrder,
  putViewDraft,
  dropViewDraft,
  beginViewSave,
  finishViewSave,
  toggleOutlineRow,
  expandOutlineRow,
  selectTask,
  toggleTaskSelection,
  selectAllTasks,
  clearSelection,
  openDetailPanel,
  closeDetailPanel,
  setDetailViewMode,
  toggleSidebar,
  setSidebarWidth,
  openCreateProjectModal,
  closeCreateProjectModal,
  openCreateTaskModal,
  closeCreateTaskModal,
  setEditingCell,
  setFocusedCell,
  setProjectScope,
  setSearchQuery,
  pushUndo,
  popUndo,
  popRedo,
} = projectsUiSlice.actions;

export const selectSelectedTaskId = (state: RootState) => state.projectsUi.selectedTaskId;
export const selectSelectedTaskIds = (state: RootState) => state.projectsUi.selectedTaskIds;
export const selectIsDetailPanelOpen = (state: RootState) => state.projectsUi.isDetailPanelOpen;
export const selectDetailViewMode = (state: RootState) => state.projectsUi.detailViewMode;
export const selectIsSidebarOpen = (state: RootState) => state.projectsUi.isSidebarOpen;
export const selectProjectScope = (state: RootState) => state.projectsUi.projectScope;
export const selectSearchQuery = (state: RootState) => state.projectsUi.searchQuery;
export const selectEditingCell = (state: RootState) => state.projectsUi.editingCell;
export const selectFocusedCell = (state: RootState) => state.projectsUi.focusedCell;
const NO_EXPANDED_ROWS: readonly string[] = Object.freeze([]);

export const selectOutlineExpanded =
  (projectId: string) =>
  (state: RootState): readonly string[] =>
    state.projectsUi.outlineExpanded[projectId] ?? NO_EXPANDED_ROWS;
export const selectUndoStack = (state: RootState) => state.projectsUi.undoStack;
export const selectRedoStack = (state: RootState) => state.projectsUi.redoStack;
export const selectCanUndo = (state: RootState) => state.projectsUi.undoStack.length > 0;
export const selectCanRedo = (state: RootState) => state.projectsUi.redoStack.length > 0;

export const projectsUiReducer = projectsUiSlice.reducer;
