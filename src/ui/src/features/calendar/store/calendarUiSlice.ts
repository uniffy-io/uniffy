import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import type {
  ViewMode,
  QuickAccessFilter,
  EventModalPrefill,
  DropTarget,
  SidebarSectionId,
} from "@/features/calendar/types";
import { LAYOUT, SIDEBAR_SECTIONS } from "@/features/calendar/constants";
import { instantDayKey } from "@/features/calendar/utils";

interface CalendarUiState {
  viewMode: ViewMode;
  currentDate: string;
  quickAccessFilter: QuickAccessFilter | null;
  selectedEventId: string | null;
  isEventModalOpen: boolean;
  eventModalMode: "create" | "edit";
  eventModalPrefill: EventModalPrefill | null;
  isSidebarCollapsed: boolean;
  sidebarWidth: number;
  collapsedSections: SidebarSectionId[];
  draggedEventId: string | null;
  dropTarget: DropTarget | null;
  isDragging: boolean;
  isAddCategoryModalOpen: boolean;
  editingCategoryId: string | null;
  isCreateTemplateModalOpen: boolean;
  editingTemplateId: string | null;
}

function getDefaultCollapsedSections(): SidebarSectionId[] {
  return (Object.entries(SIDEBAR_SECTIONS) as [SidebarSectionId, boolean][])
    .filter(([, isExpanded]) => !isExpanded)
    .map(([id]) => id);
}

const initialState: CalendarUiState = {
  viewMode: "week",
  currentDate: instantDayKey(new Date()),
  quickAccessFilter: null,
  selectedEventId: null,
  isEventModalOpen: false,
  eventModalMode: "create",
  eventModalPrefill: null,
  isSidebarCollapsed: false,
  sidebarWidth: LAYOUT.SIDEBAR_WIDTH,
  collapsedSections: getDefaultCollapsedSections(),
  draggedEventId: null,
  dropTarget: null,
  isDragging: false,
  isAddCategoryModalOpen: false,
  editingCategoryId: null,
  isCreateTemplateModalOpen: false,
  editingTemplateId: null,
};

const calendarUiSlice = createSlice({
  name: "calendarUi",
  initialState,
  reducers: {
    setViewMode: (state, action: PayloadAction<ViewMode>) => {
      state.viewMode = action.payload;
    },

    setCurrentDate: (state, action: PayloadAction<string>) => {
      state.currentDate = action.payload;
    },

    goToToday: (state) => {
      state.currentDate = instantDayKey(new Date());
    },

    setQuickAccessFilter: (state, action: PayloadAction<QuickAccessFilter | null>) => {
      state.quickAccessFilter = action.payload;
    },

    selectEvent: (state, action: PayloadAction<string | null>) => {
      state.selectedEventId = action.payload;
    },

    deselectEvent: (state) => {
      state.selectedEventId = null;
    },

    openEventModal: (
      state,
      action: PayloadAction<{
        mode: "create" | "edit";
        prefill?: EventModalPrefill;
      }>,
    ) => {
      state.isEventModalOpen = true;
      state.eventModalMode = action.payload.mode;
      state.eventModalPrefill = action.payload.prefill ?? null;
    },

    closeEventModal: (state) => {
      state.isEventModalOpen = false;
      state.eventModalPrefill = null;
    },

    toggleSidebar: (state) => {
      state.isSidebarCollapsed = !state.isSidebarCollapsed;
    },

    setSidebarCollapsed: (state, action: PayloadAction<boolean>) => {
      state.isSidebarCollapsed = action.payload;
    },

    setSidebarWidth: (state, action: PayloadAction<number>) => {
      state.sidebarWidth = Math.max(
        LAYOUT.SIDEBAR_MIN_WIDTH,
        Math.min(action.payload, LAYOUT.SIDEBAR_MAX_WIDTH),
      );
    },

    toggleSectionCollapse: (state, action: PayloadAction<SidebarSectionId>) => {
      const sectionId = action.payload;
      const index = state.collapsedSections.indexOf(sectionId);

      if (index === -1) {
        state.collapsedSections.push(sectionId);
      } else {
        state.collapsedSections.splice(index, 1);
      }
    },

    startDrag: (state, action: PayloadAction<string>) => {
      state.draggedEventId = action.payload;
      state.isDragging = true;
    },

    setDropTarget: (state, action: PayloadAction<DropTarget | null>) => {
      state.dropTarget = action.payload;
    },

    endDrag: (state) => {
      state.draggedEventId = null;
      state.dropTarget = null;
      state.isDragging = false;
    },

    openAddCategoryModal: (state) => {
      state.isAddCategoryModalOpen = true;
      state.editingCategoryId = null;
    },

    openEditCategoryModal: (state, action: PayloadAction<string>) => {
      state.isAddCategoryModalOpen = true;
      state.editingCategoryId = action.payload;
    },

    closeAddCategoryModal: (state) => {
      state.isAddCategoryModalOpen = false;
      state.editingCategoryId = null;
    },

    openCreateTemplateModal: (state) => {
      state.isCreateTemplateModalOpen = true;
      state.editingTemplateId = null;
    },

    openEditTemplateModal: (state, action: PayloadAction<string>) => {
      state.isCreateTemplateModalOpen = true;
      state.editingTemplateId = action.payload;
    },

    closeCreateTemplateModal: (state) => {
      state.isCreateTemplateModalOpen = false;
      state.editingTemplateId = null;
    },

    resetCalendarUiState: () => initialState,
  },
});

export const {
  setViewMode,
  setCurrentDate,
  goToToday,
  setQuickAccessFilter,
  selectEvent,
  deselectEvent,
  openEventModal,
  closeEventModal,
  toggleSidebar,
  setSidebarCollapsed,
  setSidebarWidth,
  toggleSectionCollapse,
  startDrag,
  setDropTarget,
  endDrag,
  openAddCategoryModal,
  openEditCategoryModal,
  closeAddCategoryModal,
  openCreateTemplateModal,
  openEditTemplateModal,
  closeCreateTemplateModal,
  resetCalendarUiState,
} = calendarUiSlice.actions;

export const calendarUiReducer = calendarUiSlice.reducer;
