/**
 * Calendar UI Redux slice
 * Manages UI state: view mode, navigation, panel visibility, etc.
 */

import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type {
  ViewMode,
  QuickAccessFilter,
  EventModalPrefill,
  DropTarget,
  SidebarSectionId,
  DetailPanelTab,
} from '../types';
import { LAYOUT, SIDEBAR_SECTIONS } from '../constants';
import { toDateString } from '../utils';

/**
 * Calendar UI state
 */
interface CalendarUiState {
  // View mode (day, week, month)
  viewMode: ViewMode;

  // Currently displayed date (ISO string)
  currentDate: string;

  // Active quick access filter
  quickAccessFilter: QuickAccessFilter | null;

  // Selected event for detail panel
  selectedEventId: string | null;

  // Detail panel state
  isDetailPanelOpen: boolean;
  detailPanelWidth: number;
  activeDetailTab: DetailPanelTab;

  // Event modal state
  isEventModalOpen: boolean;
  eventModalMode: 'create' | 'edit';
  eventModalPrefill: EventModalPrefill | null;

  // Sidebar state
  isSidebarCollapsed: boolean;
  sidebarWidth: number;
  collapsedSections: SidebarSectionId[];

  // Drag and drop
  draggedEventId: string | null;
  dropTarget: DropTarget | null;
  isDragging: boolean;

  // Timezone
  displayTimezone: string;
  isTravelingMode: boolean;

  // Quick capture modal
  isQuickCaptureOpen: boolean;

  // Timezone modal
  isTimezoneModalOpen: boolean;

  // Calendar/Category/Template modals
  isAddCalendarModalOpen: boolean;
  editingCalendarId: string | null;
  isAddCategoryModalOpen: boolean;
  editingCategoryId: string | null;
  isCreateTemplateModalOpen: boolean;
  editingTemplateId: string | null;

  // Mobile state
  isMobileView: boolean;
  activeMobilePanel: 'sidebar' | 'calendar' | 'detail';
}

/**
 * Get default collapsed sections
 */
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
  isEventModalOpen: false,
  eventModalMode: 'create',
  eventModalPrefill: null,
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
  isAddCalendarModalOpen: false,
  editingCalendarId: null,
  isAddCategoryModalOpen: false,
  editingCategoryId: null,
  isCreateTemplateModalOpen: false,
  editingTemplateId: null,
  isMobileView: false,
  activeMobilePanel: 'calendar',
};

const calendarUiSlice = createSlice({
  name: 'calendarUi',
  initialState,
  reducers: {
    // View mode
    setViewMode: (state, action: PayloadAction<ViewMode>) => {
      state.viewMode = action.payload;
    },

    // Date navigation
    setCurrentDate: (state, action: PayloadAction<string>) => {
      state.currentDate = action.payload;
    },

    goToToday: (state) => {
      state.currentDate = toDateString(new Date());
    },

    // Quick access filter
    setQuickAccessFilter: (
      state,
      action: PayloadAction<QuickAccessFilter | null>
    ) => {
      state.quickAccessFilter = action.payload;
    },

    // Event selection and detail panel
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

    setDetailPanelWidth: (state, action: PayloadAction<number>) => {
      state.detailPanelWidth = Math.max(
        LAYOUT.DETAIL_PANEL_MIN_WIDTH,
        Math.min(action.payload, LAYOUT.DETAIL_PANEL_MAX_WIDTH)
      );
    },

    setActiveDetailTab: (state, action: PayloadAction<DetailPanelTab>) => {
      state.activeDetailTab = action.payload;
    },

    // Event modal
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

    // Sidebar
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

    // Drag and drop
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

    // Timezone
    setDisplayTimezone: (state, action: PayloadAction<string>) => {
      state.displayTimezone = action.payload;
    },

    toggleTravelingMode: (state) => {
      state.isTravelingMode = !state.isTravelingMode;
    },

    setTravelingMode: (state, action: PayloadAction<boolean>) => {
      state.isTravelingMode = action.payload;
    },

    // Quick capture
    openQuickCapture: (state) => {
      state.isQuickCaptureOpen = true;
    },

    closeQuickCapture: (state) => {
      state.isQuickCaptureOpen = false;
    },

    // Timezone modal
    openTimezoneModal: (state) => {
      state.isTimezoneModalOpen = true;
    },

    closeTimezoneModal: (state) => {
      state.isTimezoneModalOpen = false;
    },

    // Calendar/Category/Template modals
    openAddCalendarModal: (state) => {
      state.isAddCalendarModalOpen = true;
      state.editingCalendarId = null;
    },

    openEditCalendarModal: (state, action: PayloadAction<string>) => {
      state.isAddCalendarModalOpen = true;
      state.editingCalendarId = action.payload;
    },

    closeAddCalendarModal: (state) => {
      state.isAddCalendarModalOpen = false;
      state.editingCalendarId = null;
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

    // Mobile state
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

    // Reset
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
  setDetailPanelWidth,
  setActiveDetailTab,
  openEventModal,
  closeEventModal,
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
  openAddCalendarModal,
  openEditCalendarModal,
  closeAddCalendarModal,
  openAddCategoryModal,
  openEditCategoryModal,
  closeAddCategoryModal,
  openCreateTemplateModal,
  openEditTemplateModal,
  closeCreateTemplateModal,
  setMobileView,
  setActiveMobilePanel,
  resetCalendarUiState,
} = calendarUiSlice.actions;

export default calendarUiSlice.reducer;
