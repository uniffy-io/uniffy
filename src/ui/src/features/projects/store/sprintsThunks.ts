import { createAsyncThunk } from "@reduxjs/toolkit";
import { projectsApi } from "@/features/projects/api/projectsApi";
import {
  setSprintsLoading,
  setSprintsError,
  setSprintsForProject,
  upsertSprint,
  removeSprint,
} from "@/features/projects/store/sprintsSlice";
import { bulkUpdateTasks } from "@/features/projects/store/projectsSlice";
import type { RootState } from "@/app/store";
import type { Task } from "@/features/projects/types/project";
import type {
  CreateSprintRequest,
  UpdateSprintRequest,
  StartSprintRequest,
} from "@/features/projects/types/project";

export const fetchSprints = createAsyncThunk(
  "sprints/fetchSprints",
  async (projectId: string, { dispatch, getState }) => {
    const state = getState() as RootState;
    const organizationId = state.auth.currentOrganizationId;
    if (!organizationId) return;

    dispatch(setSprintsLoading(true));
    dispatch(setSprintsError(null));
    try {
      const result = await projectsApi.listSprints(projectId, organizationId);
      dispatch(setSprintsForProject({ projectId, sprints: result.sprints }));
    } catch (err) {
      dispatch(setSprintsError(String(err)));
    } finally {
      dispatch(setSprintsLoading(false));
    }
  },
);

export const createSprint = createAsyncThunk(
  "sprints/createSprint",
  async (request: CreateSprintRequest, { dispatch, getState }) => {
    const state = getState() as RootState;
    const organizationId = state.auth.currentOrganizationId;
    if (!organizationId) throw new Error("No organization selected");

    const result = await projectsApi.createSprint(request, organizationId);
    dispatch(upsertSprint(result.sprint));
    return result.sprint;
  },
);

export const updateSprint = createAsyncThunk(
  "sprints/updateSprint",
  async (request: UpdateSprintRequest, { dispatch, getState }) => {
    const state = getState() as RootState;
    const organizationId = state.auth.currentOrganizationId;
    if (!organizationId) throw new Error("No organization selected");

    const result = await projectsApi.updateSprint(request, organizationId);
    dispatch(upsertSprint(result.sprint));
    return result.sprint;
  },
);

export const startSprint = createAsyncThunk(
  "sprints/startSprint",
  async (request: StartSprintRequest, { dispatch, getState }) => {
    const state = getState() as RootState;
    const organizationId = state.auth.currentOrganizationId;
    if (!organizationId) throw new Error("No organization selected");

    const result = await projectsApi.startSprint(request, organizationId);
    dispatch(upsertSprint(result.sprint));
    return result.sprint;
  },
);

export const completeSprint = createAsyncThunk(
  "sprints/completeSprint",
  async (sprintId: string, { dispatch, getState }) => {
    const state = getState() as RootState;
    const organizationId = state.auth.currentOrganizationId;
    if (!organizationId) throw new Error("No organization selected");

    const result = await projectsApi.completeSprint(sprintId, organizationId);
    dispatch(upsertSprint(result.sprint));
    return result.sprint;
  },
);

export const deleteSprint = createAsyncThunk(
  "sprints/deleteSprint",
  async (
    { sprintId, projectId }: { sprintId: string; projectId: string },
    { dispatch, getState },
  ) => {
    const state = getState() as RootState;
    const organizationId = state.auth.currentOrganizationId;
    if (!organizationId) throw new Error("No organization selected");

    // Capture affected tasks before delete so the store can move them to backlog after.
    const tasks = state.projects.tasks as Record<string, Task>;
    const affectedTaskIds = Object.values(tasks)
      .filter((t) => t.sprintId === sprintId)
      .map((t) => t.id);

    await projectsApi.deleteSprint(sprintId, organizationId);
    dispatch(removeSprint({ sprintId, projectId }));

    if (affectedTaskIds.length > 0) {
      dispatch(bulkUpdateTasks({ ids: affectedTaskIds, changes: { sprintId: null } }));
    }
  },
);
