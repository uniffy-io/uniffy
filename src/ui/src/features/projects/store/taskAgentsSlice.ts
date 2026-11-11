import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import {
  fetchAgentAssignmentPolicy,
  fetchAssignableAgents,
  updateAgentAssignmentPolicy,
  type AssignableAgent,
} from "@/features/projects/store/taskAgentsThunks";

interface Loaded {
  /** Organization the data was loaded for; a switch refetches. */
  loadedFor: string | null;
  loadedAt: number;
  loading: boolean;
}

/** An agent picked for a task, waiting for the person to choose when it starts. */
export interface AgentStartPromptTarget {
  taskId: string;
  agentId: string;
}

interface TaskAgentsState {
  list: Loaded & { agents: AssignableAgent[] };
  policy: Loaded & { enabled: boolean };
  startPrompt: AgentStartPromptTarget | null;
}

const initialState: TaskAgentsState = {
  list: { agents: [], loadedFor: null, loadedAt: 0, loading: false },
  policy: { enabled: true, loadedFor: null, loadedAt: 0, loading: false },
  startPrompt: null,
};

const taskAgentsSlice = createSlice({
  name: "taskAgents",
  initialState,
  reducers: {
    // Pickers close when a dialog opens over them, so the prompt lives here, not in the picker.
    promptAgentStart(state, action: PayloadAction<AgentStartPromptTarget>) {
      state.startPrompt = action.payload;
    },
    closeAgentStartPrompt(state) {
      state.startPrompt = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchAssignableAgents.pending, (state) => {
        state.list.loading = true;
      })
      .addCase(fetchAssignableAgents.fulfilled, (state, action) => {
        state.list = {
          agents: action.payload.agents,
          loadedFor: action.payload.organizationId,
          loadedAt: Date.now(),
          loading: false,
        };
      })
      .addCase(fetchAssignableAgents.rejected, (state) => {
        state.list.loading = false;
      })
      .addCase(fetchAgentAssignmentPolicy.pending, (state) => {
        state.policy.loading = true;
      })
      .addCase(fetchAgentAssignmentPolicy.fulfilled, (state, action) => {
        state.policy = {
          enabled: action.payload.enabled,
          loadedFor: action.payload.organizationId,
          loadedAt: Date.now(),
          loading: false,
        };
      })
      .addCase(fetchAgentAssignmentPolicy.rejected, (state) => {
        state.policy.loading = false;
      })
      .addCase(updateAgentAssignmentPolicy.fulfilled, (state, action) => {
        state.policy.enabled = action.payload;
      });
  },
});

export const { promptAgentStart, closeAgentStartPrompt } = taskAgentsSlice.actions;
export const taskAgentsReducer = taskAgentsSlice.reducer;
