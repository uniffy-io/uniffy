import { createSlice } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import type {
  SerializedCronTask,
  SerializedCronRunLog,
} from "@/features/agents/store/agentCronThunks";
import {
  fetchCronTasks,
  createCronTask,
  updateCronTask,
  deleteCronTask,
  fetchCronRunLogs,
  triggerCronTask,
} from "@/features/agents/store/agentCronThunks";

interface AgentCronState {
  tasks: Record<string, SerializedCronTask>;
  runLogs: Record<string, SerializedCronRunLog[]>;
  loading: boolean;
  error: string | null;
}

const initialState: AgentCronState = {
  tasks: {},
  runLogs: {},
  loading: false,
  error: null,
};

export const agentCronSlice = createSlice({
  name: "agentCron",
  initialState,
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchCronTasks.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCronTasks.fulfilled, (state, action) => {
        state.loading = false;
        state.tasks = {};
        for (const task of action.payload) {
          state.tasks[task.id] = task;
        }
      })
      .addCase(fetchCronTasks.rejected, (state, action) => {
        state.loading = false;
        state.error = action.payload ?? "Failed to fetch cron tasks";
      })
      .addCase(createCronTask.fulfilled, (state, action) => {
        state.tasks[action.payload.id] = action.payload;
      })
      .addCase(updateCronTask.fulfilled, (state, action) => {
        state.tasks[action.payload.id] = action.payload;
      })
      .addCase(deleteCronTask.fulfilled, (state, action) => {
        delete state.tasks[action.payload];
        delete state.runLogs[action.payload];
      })
      .addCase(fetchCronRunLogs.fulfilled, (state, action) => {
        state.runLogs[action.payload.taskId] = action.payload.logs;
      })
      .addCase(triggerCronTask.fulfilled, (state, action) => {
        const { task, runLog } = action.payload;
        state.tasks[task.id] = task;
        const existing = state.runLogs[task.id] ?? [];
        state.runLogs[task.id] = [runLog, ...existing];
      });
  },
});

export const selectCronTasks = (state: RootState) => state.agentCron.tasks;
export const selectCronTasksList = (state: RootState) => Object.values(state.agentCron.tasks);
export const selectCronLoading = (state: RootState) => state.agentCron.loading;
export const selectCronRunLogs = (taskId: string) => (state: RootState) =>
  state.agentCron.runLogs[taskId] ?? [];

export const agentCronReducer = agentCronSlice.reducer;
