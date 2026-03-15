import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";

export type AgentsTab =
  | "chat"
  | "integrations"
  | "conversations"
  | "usage"
  | "automations"
  | "agents"
  | "skills"
  | "prompts"
  | "config";

export type AgentsPanel = "overview" | "instructions" | "files" | "tools" | "skills" | "memories" | "integrations" | "automations";

export interface AgentsUiState {
  activeTab: AgentsTab;
  sidebarCollapsed: boolean;
  agentsSidebarCollapsed: boolean;
  selectedAgentId: string | null;
  agentsPanel: AgentsPanel;
  chatMessage: string;
  sidebarContent: string | null;
  skillSearch: string;
}

const initialState: AgentsUiState = {
  activeTab: "chat",
  sidebarCollapsed: false,
  agentsSidebarCollapsed: false,
  selectedAgentId: null,
  agentsPanel: "overview",
  chatMessage: "",
  sidebarContent: null,
  skillSearch: "",
};

export const agentsUiSlice = createSlice({
  name: "agentsUi",
  initialState,
  reducers: {
    setActiveTab: (state, action: PayloadAction<AgentsTab>) => {
      state.activeTab = action.payload;
    },
    toggleSidebar: (state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    setSidebarCollapsed: (state, action: PayloadAction<boolean>) => {
      state.sidebarCollapsed = action.payload;
    },
    toggleAgentsSidebar: (state) => {
      state.agentsSidebarCollapsed = !state.agentsSidebarCollapsed;
    },
    setAgentsSidebarCollapsed: (state, action: PayloadAction<boolean>) => {
      state.agentsSidebarCollapsed = action.payload;
    },
    setSelectedAgent: (state, action: PayloadAction<string | null>) => {
      state.selectedAgentId = action.payload;
    },
    setAgentsPanel: (state, action: PayloadAction<AgentsPanel>) => {
      state.agentsPanel = action.payload;
    },
    setChatMessage: (state, action: PayloadAction<string>) => {
      state.chatMessage = action.payload;
    },
    setSidebarContent: (state, action: PayloadAction<string | null>) => {
      state.sidebarContent = action.payload;
    },
    setSkillSearch: (state, action: PayloadAction<string>) => {
      state.skillSearch = action.payload;
    },
    resetState: () => initialState,
  },
});

// Actions
export const {
  setActiveTab,
  toggleSidebar,
  setSidebarCollapsed,
  toggleAgentsSidebar,
  setAgentsSidebarCollapsed,
  setSelectedAgent,
  setAgentsPanel,
  setChatMessage,
  setSidebarContent,
  setSkillSearch,
  resetState,
} = agentsUiSlice.actions;

// Selectors
export const selectActiveTab = (state: RootState) => state.agentsUi.activeTab;
export const selectSidebarCollapsed = (state: RootState) => state.agentsUi.sidebarCollapsed;
export const selectAgentsSidebarCollapsed = (state: RootState) => state.agentsUi.agentsSidebarCollapsed;
export const selectSelectedAgentId = (state: RootState) => state.agentsUi.selectedAgentId;
export const selectAgentsPanel = (state: RootState) => state.agentsUi.agentsPanel;
export const selectChatMessage = (state: RootState) => state.agentsUi.chatMessage;
export const selectSidebarContent = (state: RootState) => state.agentsUi.sidebarContent;
export const selectSkillSearch = (state: RootState) => state.agentsUi.skillSearch;

export const agentsUiReducer = agentsUiSlice.reducer;
