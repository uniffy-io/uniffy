import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";

export type AgentsSection = "agents" | "catalog" | "skills" | "automations";

export const AGENTS_SECTIONS: AgentsSection[] = ["agents", "catalog", "skills", "automations"];

export const AGENT_PANELS = ["overview", "instructions", "capabilities", "memory"] as const;
export type AgentPanel = (typeof AGENT_PANELS)[number];

export interface AgentsUiState {
  lastSection: AgentsSection;
  sidebarCollapsed: boolean;
}

const initialState: AgentsUiState = {
  lastSection: "agents",
  sidebarCollapsed: false,
};

export const agentsUiSlice = createSlice({
  name: "agentsUi",
  initialState,
  reducers: {
    setLastSection: (state, action: PayloadAction<AgentsSection>) => {
      state.lastSection = action.payload;
    },
    toggleSidebar: (state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    setSidebarCollapsed: (state, action: PayloadAction<boolean>) => {
      state.sidebarCollapsed = action.payload;
    },
    resetState: () => initialState,
  },
});

export const { setLastSection, toggleSidebar, setSidebarCollapsed, resetState } =
  agentsUiSlice.actions;

// A stale persisted value (removed section names, old tab ids) resolves to Agents.
export const selectLastSection = (state: RootState): AgentsSection =>
  AGENTS_SECTIONS.includes(state.agentsUi.lastSection) ? state.agentsUi.lastSection : "agents";
export const selectSidebarCollapsed = (state: RootState) => state.agentsUi.sidebarCollapsed;

export const agentsUiReducer = agentsUiSlice.reducer;
