import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type {
  ViewMode,
  QuickAccessFilter,
  EventModalPrefill,
  DropTarget,
  SidebarSectionId,
  DetailPanelTab,
} from '@/features/calendar/types';
import { LAYOUT, SIDEBAR_SECTIONS } from '@/features/calendar/constants';
import { toDateString } from '@/features/calendar/utils';

interface CalendarUiState {
  viewMode: ViewMode;
  currentDate: string;
  quickAccessFilter: QuickAccessFilter | null;
  selectedEventId: string | null;
  isDetailPanelOpen: boolean;
  detailPanelWidth: number;
  activeDetailTab: DetailPanelTab;
  detailViewMode: 'sidebar' | 'modal';
  isEventModalOpen: boolean;
  eventModalMode: 'create' | 'edit';
  eventModalPrefill: EventModalPrefill | null;
  isEditingEventOpen: boolean;
  isSidebarCollapsed: boolean;
  sidebarWidth: number;
  collapsedSections: SidebarSectionId[];
  draggedEventId: string | null;
  dropTarget: DropTarget | null;
  isDragging: boolean;
  displayTimezone: string;
  isTravelingMode: boolean;
  isQuickCaptureOpen: boolean;
  isTimezoneModalOpen: boolean;
  isAddCategoryModalOpen: boolean;
  editingCategoryId: string | null;
  isCreateTemplateModalOpen: boolean;
  editingTemplateId: string | null;
  isMobileView: boolean;
  activeMobilePanel: 'sidebar' | 'calendar' | 'detail';
  eventScope: 'all' | 'personal' | 'organization';
}

function getDefaultCollapsedSections(): SidebarSectionId[] {
  return (Object.entries(SIDEBAR_SECTIONS) as [SidebarSectionId, boolean][])
    .filter(([, isExpanded]) => !isExpanded)
    .map(([id]) => id);
}

const initialState: CalendarUiState = {
  viewMode: 'week',
  currentDate: toDateString(new Date()),
  quickAccessFilter: null,
  selectedEventId: null,
  isDetailPanelOpen: false,
  detailPanelWidth: LAYOUT.DETAIL_PANEL_WIDTH,
  activeDetailTab: 'outline',
  detailViewMode: 'sidebar',
  isEventModalOpen: false,
  eventModalMode: 'create',
  eventModalPrefill: null,
  isEditingEventOpen: false,
  isSidebarCollapsed: false,
  sidebarWidth: LAYOUT.SIDEBAR_WIDTH,
  collapsedSections: getDefaultCollapsedSections(),
  draggedEventId: null,
  dropTarget: null,
  isDragging: false,
  displayTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  isTravelingMode: false,
  isQuickCaptureOpen: false,
  isTimezoneModalOpen: false,
  isAddCategoryModalOpen: false,
  editingCategoryId: null,
  isCreateTemplateModalOpen: false,
  editingTemplateId: null,
  isMobileView: false,
  activeMobilePanel: 'calendar',
  eventScope: 'all',
};

const calendarUiSlice = createSlice({
  name: 'calendarUi',
  initialState,
  reducers: {
    setViewMode: (state, action: PayloadAction<ViewMode>) => {
      state.viewMode = action.payload;
    },

    setCurrentDate: (state, action: PayloadAction<string>) => {
      state.currentDate = action.payload;
    },

    goToToday: (state) => {
      state.currentDate = toDateString(new Date());
    },

    setQuickAccessFilter: (
      state,
      action: PayloadAction<QuickAccessFilter | null>
    ) => {
      state.quickAccessFilter = action.payload;
    },

    selectEvent: (state, action: PayloadAction<string | null>) => {
      state.selectedEventId = action.payload;
      if (action.payload) {
        state.isDetailPanelOpen = true;
      }
    },

    deselectEvent: (state) => {
      state.selectedEventId = null;
      state.isDetailPanelOpen = false;
    },

    toggleDetailPanel: (state) => {
      state.isDetailPanelOpen = !state.isDetailPanelOpen;
      if (!state.isDetailPanelOpen) {
        state.selectedEventId = null;
      }
    },

    openDetailPanel: (state) => {
      state.isDetailPanelOpen = true;
    },

    closeDetailPanel: (state) => {
      state.isDetailPanelOpen = false;
      state.selectedEventId = null;
    },

    setDetailViewMode: (state, action: PayloadAction<'sidebar' | 'modal'>) => {
      state.detailViewMode = action.payload;
    },

    setDetailPanelWidth: (state, action: PayloadAction<number>) => {
      state.detailPanelWidth = Math.max(
        LAYOUT.DETAIL_PANEL_MIN_WIDTH,
        Math.min(action.payload, LAYOUT.DETAIL_PANEL_MAX_WIDTH)
      );
    },

    setActiveDetailTab: (state, action: PayloadAction<DetailPanelTab>) => {
      state.activeDetailTab = action.payload;
    },

    openEventModal: (
      state,
      action: PayloadAction<{
        mode: 'create' | 'edit';
        prefill?: EventModalPrefill;
      }>
    ) => {
      state.isEventModalOpen = true;
      state.eventModalMode = action.payload.mode;
      state.eventModalPrefill = action.payload.prefill ?? null;
    },

    closeEventModal: (state) => {
      state.isEventModalOpen = false;
      state.eventModalPrefill = null;
    },

    openEditEvent: (state, action: PayloadAction<string>) => {
      state.selectedEventId = action.payload;
      state.isEditingEventOpen = true;
    },

    closeEditEvent: (state) => {
      state.isEditingEventOpen = false;
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
        Math.min(action.payload, LAYOUT.SIDEBAR_MAX_WIDTH)
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

    setSectionCollapsed: (
      state,
      action: PayloadAction<{ sectionId: SidebarSectionId; collapsed: boolean }>
    ) => {
      const { sectionId, collapsed } = action.payload;
      const index = state.collapsedSections.indexOf(sectionId);

      if (collapsed && index === -1) {
        state.collapsedSections.push(sectionId);
      } else if (!collapsed && index !== -1) {
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

    setDisplayTimezone: (state, action: PayloadAction<string>) => {
      state.displayTimezone = action.payload;
    },

    toggleTravelingMode: (state) => {
      state.isTravelingMode = !state.isTravelingMode;
    },

    setTravelingMode: (state, action: PayloadAction<boolean>) => {
      state.isTravelingMode = action.payload;
    },

    openQuickCapture: (state) => {
      state.isQuickCaptureOpen = true;
    },

    closeQuickCapture: (state) => {
      state.isQuickCaptureOpen = false;
    },

    openTimezoneModal: (state) => {
      state.isTimezoneModalOpen = true;
    },

    closeTimezoneModal: (state) => {
      state.isTimezoneModalOpen = false;
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

    setMobileView: (state, action: PayloadAction<boolean>) => {
      state.isMobileView = action.payload;
      if (action.payload) {
        state.activeMobilePanel = 'calendar';
      }
    },

    setActiveMobilePanel: (
      state,
      action: PayloadAction<'sidebar' | 'calendar' | 'detail'>
    ) => {
      state.activeMobilePanel = action.payload;
    },

    setEventScope: (state, action: PayloadAction<'all' | 'personal' | 'organization'>) => {
      state.eventScope = action.payload;
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
  toggleDetailPanel,
  openDetailPanel,
  closeDetailPanel,
  setDetailViewMode,
  setDetailPanelWidth,
  setActiveDetailTab,
  openEventModal,
  closeEventModal,
  openEditEvent,
  closeEditEvent,
  toggleSidebar,
  setSidebarCollapsed,
  setSidebarWidth,
  toggleSectionCollapse,
  setSectionCollapsed,
  startDrag,
  setDropTarget,
  endDrag,
  setDisplayTimezone,
  toggleTravelingMode,
  setTravelingMode,
  openQuickCapture,
  closeQuickCapture,
  openTimezoneModal,
  closeTimezoneModal,
  openAddCategoryModal,
  openEditCategoryModal,
  closeAddCategoryModal,
  openCreateTemplateModal,
  openEditTemplateModal,
  closeCreateTemplateModal,
  setMobileView,
  setActiveMobilePanel,
  setEventScope,
  resetCalendarUiState,
} = calendarUiSlice.actions;

export const calendarUiReducer = calendarUiSlice.reducer;
