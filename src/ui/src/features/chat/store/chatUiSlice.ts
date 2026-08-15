import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";

type ChatDensity = "comfortable" | "compact";
type ChatActivePanel = "thread" | "resources" | null;

interface ChatUiState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  threadPanelOpen: boolean;
  resourcePanelOpen: boolean;
  density: ChatDensity;
  activePanel: ChatActivePanel;
  channelHeaderExpanded: boolean;
  channelsSectionCollapsed: boolean;
  dmSectionCollapsed: boolean;
  agentChatsSectionCollapsed: boolean;
  collapsedAgentFolders: Record<string, boolean>;
  agentChatPickerOpen: boolean;
  renameAgentChatChannelId: string | null;
  splitActive: boolean;
  focusedPane: "left" | "right";
  jumpToMessageId: string | null;
  createChannelModalOpen: boolean;
  createChannelCategoryId: string | null;
  createCategoryModalOpen: boolean;
  browseChannelsModalOpen: boolean;
  newDmModalOpen: boolean;
  channelSettingsModalOpen: boolean;
  channelSettingsModalTab: "overview" | "members";
  replyToMessage: {
    id: string;
    channelId: string;
    senderName: string;
    contentPreview: string;
  } | null;
  editingMessage: {
    id: string;
    channelId: string;
    content: string;
  } | null;
}

const initialState: ChatUiState = {
  sidebarOpen: true,
  sidebarCollapsed: false,
  threadPanelOpen: false,
  resourcePanelOpen: false,
  density: "comfortable",
  activePanel: null,
  channelHeaderExpanded: false,
  channelsSectionCollapsed: false,
  dmSectionCollapsed: false,
  agentChatsSectionCollapsed: false,
  collapsedAgentFolders: {},
  agentChatPickerOpen: false,
  renameAgentChatChannelId: null,
  splitActive: false,
  focusedPane: "left",
  jumpToMessageId: null,
  createChannelModalOpen: false,
  createChannelCategoryId: null,
  createCategoryModalOpen: false,
  browseChannelsModalOpen: false,
  newDmModalOpen: false,
  channelSettingsModalOpen: false,
  channelSettingsModalTab: "overview" as const,
  replyToMessage: null,
  editingMessage: null,
};

export const chatUiSlice = createSlice({
  name: "chatUi",
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
      state.activePanel = "thread";
    },
    closeThreadPanel: (state) => {
      state.threadPanelOpen = false;
      if (state.activePanel === "thread") {
        state.activePanel = null;
      }
    },
    openResourcePanel: (state) => {
      state.resourcePanelOpen = true;
      state.threadPanelOpen = false;
      state.activePanel = "resources";
    },
    closeResourcePanel: (state) => {
      state.resourcePanelOpen = false;
      if (state.activePanel === "resources") {
        state.activePanel = null;
      }
    },
    setDensity: (state, action: PayloadAction<ChatDensity>) => {
      state.density = action.payload;
    },
    toggleDensity: (state) => {
      state.density = state.density === "comfortable" ? "compact" : "comfortable";
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
    toggleAgentChatsSection: (state) => {
      state.agentChatsSectionCollapsed = !state.agentChatsSectionCollapsed;
    },
    toggleAgentFolderCollapsed: (state, action: PayloadAction<string>) => {
      // Rehydrated persisted state from before this key existed lacks the map.
      if (!state.collapsedAgentFolders) state.collapsedAgentFolders = {};
      state.collapsedAgentFolders[action.payload] = !state.collapsedAgentFolders[action.payload];
    },
    revealAgentFolder: (state, action: PayloadAction<string>) => {
      // Deep link (search result click): the folder and its section both open.
      state.agentChatsSectionCollapsed = false;
      if (!state.collapsedAgentFolders) state.collapsedAgentFolders = {};
      state.collapsedAgentFolders[action.payload] = false;
    },
    openAgentChatPicker: (state) => {
      state.agentChatPickerOpen = true;
    },
    closeAgentChatPicker: (state) => {
      state.agentChatPickerOpen = false;
    },
    openRenameAgentChatDialog: (state, action: PayloadAction<string>) => {
      state.renameAgentChatChannelId = action.payload;
    },
    closeRenameAgentChatDialog: (state) => {
      state.renameAgentChatChannelId = null;
    },
    activateSplit: (state) => {
      state.splitActive = true;
    },
    deactivateSplit: (state) => {
      state.splitActive = false;
      state.focusedPane = "left";
    },
    setFocusedPane: (state, action: PayloadAction<"left" | "right">) => {
      state.focusedPane = action.payload;
    },
    jumpToMessage: (state, action: PayloadAction<string>) => {
      state.jumpToMessageId = action.payload;
    },
    clearJumpToMessage: (state) => {
      state.jumpToMessageId = null;
    },
    openCreateChannelModal: (state, action: PayloadAction<string | null>) => {
      state.createChannelModalOpen = true;
      state.createChannelCategoryId = action.payload;
    },
    closeCreateChannelModal: (state) => {
      state.createChannelModalOpen = false;
      state.createChannelCategoryId = null;
    },
    openCreateCategoryModal: (state) => {
      state.createCategoryModalOpen = true;
    },
    closeCreateCategoryModal: (state) => {
      state.createCategoryModalOpen = false;
    },
    openBrowseChannelsModal: (state) => {
      state.browseChannelsModalOpen = true;
    },
    closeBrowseChannelsModal: (state) => {
      state.browseChannelsModalOpen = false;
    },
    openNewDmModal: (state) => {
      state.newDmModalOpen = true;
    },
    closeNewDmModal: (state) => {
      state.newDmModalOpen = false;
    },
    openChannelSettingsModal: (state, action: PayloadAction<"overview" | "members">) => {
      state.channelSettingsModalOpen = true;
      state.channelSettingsModalTab = action.payload;
    },
    closeChannelSettingsModal: (state) => {
      state.channelSettingsModalOpen = false;
      state.channelSettingsModalTab = "overview";
    },
    setReplyToMessage: (
      state,
      action: PayloadAction<{
        id: string;
        channelId: string;
        senderName: string;
        contentPreview: string;
      }>,
    ) => {
      state.replyToMessage = action.payload;
    },
    clearReplyToMessage: (state) => {
      state.replyToMessage = null;
    },
    setEditingMessage: (
      state,
      action: PayloadAction<{
        id: string;
        channelId: string;
        content: string;
      }>,
    ) => {
      state.editingMessage = action.payload;
      state.replyToMessage = null;
    },
    clearEditingMessage: (state) => {
      state.editingMessage = null;
    },
    clearChatUi: () => initialState,
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
  toggleChannelHeaderExpanded,
  toggleChannelsSection,
  toggleDmSection,
  toggleAgentChatsSection,
  toggleAgentFolderCollapsed,
  revealAgentFolder,
  openAgentChatPicker,
  closeAgentChatPicker,
  openRenameAgentChatDialog,
  closeRenameAgentChatDialog,
  activateSplit,
  deactivateSplit,
  setFocusedPane,
  jumpToMessage,
  clearJumpToMessage,
  openCreateChannelModal,
  closeCreateChannelModal,
  openCreateCategoryModal,
  closeCreateCategoryModal,
  openBrowseChannelsModal,
  closeBrowseChannelsModal,
  openNewDmModal,
  closeNewDmModal,
  openChannelSettingsModal,
  closeChannelSettingsModal,
  setReplyToMessage,
  clearReplyToMessage,
  setEditingMessage,
  clearEditingMessage,
  clearChatUi,
} = chatUiSlice.actions;

export const selectSidebarOpen = (state: RootState): boolean => state.chatUi.sidebarOpen;

export const selectSidebarCollapsed = (state: RootState): boolean => state.chatUi.sidebarCollapsed;

export const selectThreadPanelOpen = (state: RootState): boolean => state.chatUi.threadPanelOpen;

export const selectResourcePanelOpen = (state: RootState): boolean =>
  state.chatUi.resourcePanelOpen;

export const selectDensity = (state: RootState): ChatDensity => state.chatUi.density;

export const selectActivePanel = (state: RootState): ChatActivePanel => state.chatUi.activePanel;

export const selectChannelHeaderExpanded = (state: RootState): boolean =>
  state.chatUi.channelHeaderExpanded;

export const selectChannelsSectionCollapsed = (state: RootState): boolean =>
  state.chatUi.channelsSectionCollapsed;

export const selectDmSectionCollapsed = (state: RootState): boolean =>
  state.chatUi.dmSectionCollapsed;

export const selectAgentChatsSectionCollapsed = (state: RootState): boolean =>
  state.chatUi.agentChatsSectionCollapsed;

export const selectAgentChatPickerOpen = (state: RootState): boolean =>
  state.chatUi.agentChatPickerOpen;

export const selectRenameAgentChatChannelId = (state: RootState): string | null =>
  state.chatUi.renameAgentChatChannelId;

export const selectSplitActive = (state: RootState): boolean => state.chatUi.splitActive;

export const selectFocusedPane = (state: RootState): "left" | "right" => state.chatUi.focusedPane;

export const selectJumpToMessageId = (state: RootState): string | null =>
  state.chatUi.jumpToMessageId;

export const selectChannelSettingsModalOpen = (state: RootState): boolean =>
  state.chatUi.channelSettingsModalOpen;

export const selectChannelSettingsModalTab = (state: RootState): "overview" | "members" =>
  state.chatUi.channelSettingsModalTab;

export const selectReplyToMessage = (state: RootState) => state.chatUi.replyToMessage;

export const selectEditingMessage = (state: RootState) => state.chatUi.editingMessage;

export const chatUiReducer = chatUiSlice.reducer;
