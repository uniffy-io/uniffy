import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import type { Sprint } from "@/features/projects/types/project";

interface SprintsState {
  sprints: Record<string, Sprint>;
  sprintsByProject: Record<string, string[]>;
  loading: boolean;
  error: string | null;
}

const initialState: SprintsState = {
  sprints: {},
  sprintsByProject: {},
  loading: false,
  error: null,
};

export const sprintsSlice = createSlice({
  name: "sprints",
  initialState,
  reducers: {
    setSprintsLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setSprintsError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
    },
    setSprintsForProject: (
      state,
      action: PayloadAction<{ projectId: string; sprints: Sprint[] }>
    ) => {
      const { projectId, sprints } = action.payload;
      state.sprintsByProject[projectId] = sprints.map((s) => s.id);
      for (const sprint of sprints) {
        state.sprints[sprint.id] = sprint;
      }
    },
    upsertSprint: (state, action: PayloadAction<Sprint>) => {
      const sprint = action.payload;
      state.sprints[sprint.id] = sprint;
      const projectSprints = state.sprintsByProject[sprint.projectId] ?? [];
      if (!projectSprints.includes(sprint.id)) {
        state.sprintsByProject[sprint.projectId] = [...projectSprints, sprint.id];
      }
    },
    removeSprint: (state, action: PayloadAction<{ sprintId: string; projectId: string }>) => {
      const { sprintId, projectId } = action.payload;
      delete state.sprints[sprintId];
      state.sprintsByProject[projectId] = (
        state.sprintsByProject[projectId] ?? []
      ).filter((id) => id !== sprintId);
    },
    clearSprints: () => initialState,
  },
});

export const {
  setSprintsLoading,
  setSprintsError,
  setSprintsForProject,
  upsertSprint,
  removeSprint,
  clearSprints,
} = sprintsSlice.actions;

// Selectors
export const selectSprintsForProject = (projectId: string) => (state: RootState): Sprint[] => {
  const ids = state.sprints.sprintsByProject[projectId] ?? [];
  return ids
    .map((id) => state.sprints.sprints[id])
    .filter(Boolean)
    .sort((a, b) => a.sortOrder - b.sortOrder);
};

export const selectActiveSprint = (projectId: string) => (state: RootState): Sprint | null => {
  const ids = state.sprints.sprintsByProject[projectId] ?? [];
  for (const id of ids) {
    const sprint = state.sprints.sprints[id];
    if (sprint?.status === "active") return sprint;
  }
  return null;
};

export const selectSprintById = (sprintId: string) => (state: RootState): Sprint | null =>
  state.sprints.sprints[sprintId] ?? null;

export const selectSprintsLoading = (state: RootState) => state.sprints.loading;

export default sprintsSlice.reducer;
