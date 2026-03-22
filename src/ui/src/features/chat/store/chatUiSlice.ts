import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';

type ChatDensity = 'comfortable' | 'compact';
type ChatActivePanel = 'thread' | 'resources' | null;

interface ChatUiState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  threadPanelOpen: boolean;
  resourcePanelOpen: boolean;
  density: ChatDensity;
  activePanel: ChatActivePanel;
  selectedMessageIds: string[];
  searchOpen: boolean;
  channelHeaderExpanded: boolean;
  channelsSectionCollapsed: boolean;
  dmSectionCollapsed: boolean;
  splitActive: boolean;
  focusedPane: 'left' | 'right';
  jumpToMessageId: string | null;
}

const initialState: ChatUiState = {
  sidebarOpen: true,
  sidebarCollapsed: false,
  threadPanelOpen: false,
  resourcePanelOpen: false,
  density: 'comfortable',
  activePanel: null,
  selectedMessageIds: [],
  searchOpen: false,
  channelHeaderExpanded: false,
  channelsSectionCollapsed: false,
  dmSectionCollapsed: false,
  splitActive: false,
  focusedPane: 'left',
  jumpToMessageId: null,
};

export const chatUiSlice = createSlice({
  name: 'chatUi',
  initialState,
  reducers: {
    toggleSidebar: (state) => {
      state.sidebarOpen = !state.sidebarOpen;
    },
    setSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.sidebarOpen = action.payload;
    },
    toggleSidebarCollapsed: (state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    setSidebarCollapsed: (state, action: PayloadAction<boolean>) => {
      state.sidebarCollapsed = action.payload;
    },
    collapseSidebar: (state) => {
      state.sidebarOpen = false;
    },
    expandSidebar: (state) => {
      state.sidebarOpen = true;
    },
    openThreadPanel: (state) => {
      state.threadPanelOpen = true;
      state.resourcePanelOpen = false;
      state.activePanel = 'thread';
    },
    closeThreadPanel: (state) => {
      state.threadPanelOpen = false;
      if (state.activePanel === 'thread') {
        state.activePanel = null;
      }
    },
    openResourcePanel: (state) => {
      state.resourcePanelOpen = true;
      state.threadPanelOpen = false;
      state.activePanel = 'resources';
    },
    closeResourcePanel: (state) => {
      state.resourcePanelOpen = false;
      if (state.activePanel === 'resources') {
        state.activePanel = null;
      }
    },
    setDensity: (state, action: PayloadAction<ChatDensity>) => {
      state.density = action.payload;
    },
    toggleDensity: (state) => {
      state.density = state.density === 'comfortable' ? 'compact' : 'comfortable';
    },
    selectMessage: (state, action: PayloadAction<string>) => {
      if (!state.selectedMessageIds.includes(action.payload)) {
        state.selectedMessageIds.push(action.payload);
      }
    },
    deselectMessage: (state, action: PayloadAction<string>) => {
      state.selectedMessageIds = state.selectedMessageIds.filter(
        (id) => id !== action.payload,
      );
    },
    clearSelection: (state) => {
      state.selectedMessageIds = [];
    },
    toggleSearch: (state) => {
      state.searchOpen = !state.searchOpen;
    },
    setSearchOpen: (state, action: PayloadAction<boolean>) => {
      state.searchOpen = action.payload;
    },
    toggleChannelHeaderExpanded: (state) => {
      state.channelHeaderExpanded = !state.channelHeaderExpanded;
    },
    toggleChannelsSection: (state) => {
      state.channelsSectionCollapsed = !state.channelsSectionCollapsed;
    },
    toggleDmSection: (state) => {
      state.dmSectionCollapsed = !state.dmSectionCollapsed;
    },
    activateSplit: (state) => {
      state.splitActive = true;
    },
    deactivateSplit: (state) => {
      state.splitActive = false;
      state.focusedPane = 'left';
    },
    setFocusedPane: (state, action: PayloadAction<'left' | 'right'>) => {
      state.focusedPane = action.payload;
    },
    jumpToMessage: (state, action: PayloadAction<string>) => {
      state.jumpToMessageId = action.payload;
    },
    clearJumpToMessage: (state) => {
      state.jumpToMessageId = null;
    },
  },
});

export const {
  toggleSidebar,
  setSidebarOpen,
  toggleSidebarCollapsed,
  setSidebarCollapsed,
  collapseSidebar,
  expandSidebar,
  openThreadPanel,
  closeThreadPanel,
  openResourcePanel,
  closeResourcePanel,
  setDensity,
  toggleDensity,
  selectMessage,
  deselectMessage,
  clearSelection,
  toggleSearch,
  setSearchOpen,
  toggleChannelHeaderExpanded,
  toggleChannelsSection,
  toggleDmSection,
  activateSplit,
  deactivateSplit,
  setFocusedPane,
  jumpToMessage,
  clearJumpToMessage,
} = chatUiSlice.actions;

// -- Selectors --

export const selectSidebarOpen = (state: RootState): boolean =>
  state.chatUi.sidebarOpen;

export const selectSidebarCollapsed = (state: RootState): boolean =>
  state.chatUi.sidebarCollapsed;

export const selectThreadPanelOpen = (state: RootState): boolean =>
  state.chatUi.threadPanelOpen;

export const selectResourcePanelOpen = (state: RootState): boolean =>
  state.chatUi.resourcePanelOpen;

export const selectDensity = (state: RootState): ChatDensity =>
  state.chatUi.density;

export const selectActivePanel = (state: RootState): ChatActivePanel =>
  state.chatUi.activePanel;

export const selectSelectedMessageIds = (state: RootState): string[] =>
  state.chatUi.selectedMessageIds;

export const selectSearchOpen = (state: RootState): boolean =>
  state.chatUi.searchOpen;

export const selectChannelHeaderExpanded = (state: RootState): boolean =>
  state.chatUi.channelHeaderExpanded;

export const selectChannelsSectionCollapsed = (state: RootState): boolean =>
  state.chatUi.channelsSectionCollapsed;

export const selectDmSectionCollapsed = (state: RootState): boolean =>
  state.chatUi.dmSectionCollapsed;

export const selectSplitActive = (state: RootState): boolean =>
  state.chatUi.splitActive;

export const selectFocusedPane = (state: RootState): 'left' | 'right' =>
  state.chatUi.focusedPane;

export const selectJumpToMessageId = (state: RootState): string | null =>
  state.chatUi.jumpToMessageId;

export const chatUiReducer = chatUiSlice.reducer;
