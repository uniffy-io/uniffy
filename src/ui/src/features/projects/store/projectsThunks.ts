import { createAsyncThunk } from "@reduxjs/toolkit";
import type { AppDispatch, RootState } from "@/app/store";
import { projectsApi } from "../api/projectsApi";
import type {
  Project,
  Task,
  CreateProjectRequest,
  UpdateProjectRequest,
  CreateTaskRequest,
  UpdateTaskRequest,
  MoveTaskRequest,
} from "../types/project";
import type { FieldDefinition } from "../types/fields";
import type { ViewConfig } from "../types/views";
import type { TaskActivity } from "../types/activity";
import type {
  Project as ProtoProject,
  Task as ProtoTask,
} from "@uniffy/proto/projects/v1/projects_pb";
import { bulkUpsertTags, tagToPlain } from "@/features/tags";

const hydrateProjectTags = (dispatch: AppDispatch, protos: (ProtoProject | undefined)[]): void => {
  const tags = protos
    .filter((p): p is ProtoProject => Boolean(p))
    .flatMap((p) => p.tags.map(tagToPlain));
  if (tags.length) {
    dispatch(bulkUpsertTags(tags));
  }
};

const hydrateTaskTags = (dispatch: AppDispatch, protos: (ProtoTask | undefined)[]): void => {
  const tags = protos
    .filter((p): p is ProtoTask => Boolean(p))
    .flatMap((p) => p.tags.map(tagToPlain));
  if (tags.length) {
    dispatch(bulkUpsertTags(tags));
  }
};

export const fetchProjects = createAsyncThunk<
  Project[],
  void,
  { dispatch: AppDispatch; rejectValue: string }
>("projects/fetchProjects", async (_, { getState, dispatch, rejectWithValue }) => {
  try {
    const state = getState() as RootState;
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) return rejectWithValue("No organization selected");

    const response = await projectsApi.listProjects(orgId);
    hydrateProjectTags(dispatch, response.protoProjects);
    return response.projects;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch projects");
  }
});

export const fetchProject = createAsyncThunk<
  Project | null,
  string,
  { dispatch: AppDispatch; rejectValue: string }
>("projects/fetchProject", async (projectId, { getState, dispatch, rejectWithValue }) => {
  try {
    const state = getState() as RootState;
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) return rejectWithValue("No organization selected");

    const response = await projectsApi.getProject(projectId, orgId);
    hydrateProjectTags(dispatch, [response.protoProject ?? undefined]);
    return response.project;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch project");
  }
});

export const fetchProjectTasks = createAsyncThunk<
  Task[],
  | string
  | {
      projectId: string;
      tagIds?: string[];
      tagFilterMode?: "all" | "any" | "none";
      inEpicId?: string;
      rootOnly?: boolean;
      hasSubtasks?: boolean;
      minDepth?: number;
      maxDepth?: number;
      firstPageOnly?: boolean;
    },
  { dispatch: AppDispatch; rejectValue: string }
>("projects/fetchProjectTasks", async (arg, { getState, dispatch, rejectWithValue, signal }) => {
  try {
    const state = getState() as RootState;
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) return rejectWithValue("No organization selected");

    const params = typeof arg === "string" ? { projectId: arg } : arg;
    const response = await projectsApi.listTasks(params.projectId, orgId, {
      tagIds: params.tagIds,
      tagFilterMode: params.tagFilterMode,
      inEpicId: params.inEpicId,
      rootOnly: params.rootOnly,
      hasSubtasks: params.hasSubtasks,
      minDepth: params.minDepth,
      maxDepth: params.maxDepth,
      firstPageOnly: params.firstPageOnly,
      signal,
    });
    hydrateTaskTags(dispatch, response.protoTasks);
    return response.tasks;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch tasks");
  }
});

export const createProject = createAsyncThunk<
  Project,
  CreateProjectRequest,
  { dispatch: AppDispatch; rejectValue: string }
>("projects/createProject", async (data, { getState, dispatch, rejectWithValue }) => {
  try {
    const state = getState() as RootState;
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) return rejectWithValue("No organization selected");

    const response = await projectsApi.createProject(data, orgId);
    hydrateProjectTags(dispatch, [response.protoProject]);
    return response.project;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to create project");
  }
});

export const updateProject = createAsyncThunk<
  Project,
  UpdateProjectRequest,
  { dispatch: AppDispatch; rejectValue: string }
>("projects/updateProject", async (data, { getState, dispatch, rejectWithValue }) => {
  try {
    const state = getState() as RootState;
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) return rejectWithValue("No organization selected");

    const response = await projectsApi.updateProject(data, orgId);
    hydrateProjectTags(dispatch, [response.protoProject]);
    return response.project;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to update project");
  }
});

export const deleteProject = createAsyncThunk<void, string, { rejectValue: string }>(
  "projects/deleteProject",
  async (projectId, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      await projectsApi.deleteProject(projectId, orgId);
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to delete project");
    }
  },
);

export const createTask = createAsyncThunk<
  { task: Task; updatedParent?: Task },
  CreateTaskRequest,
  { dispatch: AppDispatch; rejectValue: string }
>("projects/createTask", async (data, { getState, dispatch, rejectWithValue }) => {
  try {
    const state = getState() as RootState;
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) return rejectWithValue("No organization selected");

    const response = await projectsApi.createTask(data, orgId);
    hydrateTaskTags(dispatch, [response.protoTask, response.protoUpdatedParent]);
    return { task: response.task, updatedParent: response.updatedParent };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to create task");
  }
});

export const updateTask = createAsyncThunk<
  { task: Task; updatedParent?: Task; spawnedTask?: Task },
  UpdateTaskRequest,
  { dispatch: AppDispatch; rejectValue: string }
>("projects/updateTask", async (data, { getState, dispatch, rejectWithValue }) => {
  try {
    const state = getState() as RootState;
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) return rejectWithValue("No organization selected");

    const response = await projectsApi.updateTask(data, orgId);
    hydrateTaskTags(dispatch, [
      response.protoTask,
      response.protoUpdatedParent,
      response.protoSpawnedTask,
    ]);
    // An edit writes new activity rows server-side; refetch so the activity
    // log reflects them without a page reload.
    dispatch(fetchActivities(data.id));
    return {
      task: response.task,
      updatedParent: response.updatedParent,
      spawnedTask: response.spawnedTask,
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to update task");
  }
});

export const moveTask = createAsyncThunk<
  { task: Task; updatedParent?: Task; spawnedTask?: Task },
  MoveTaskRequest,
  { dispatch: AppDispatch; rejectValue: string }
>("projects/moveTask", async (data, { getState, dispatch, rejectWithValue }) => {
  try {
    const state = getState() as RootState;
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) return rejectWithValue("No organization selected");

    const response = await projectsApi.moveTask(data, orgId);
    hydrateTaskTags(dispatch, [
      response.protoTask,
      response.protoUpdatedParent,
      response.protoSpawnedTask,
    ]);
    return {
      task: response.task,
      updatedParent: response.updatedParent,
      spawnedTask: response.spawnedTask,
    };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to move task");
  }
});

export const deleteTask = createAsyncThunk<void, string, { rejectValue: string }>(
  "projects/deleteTask",
  async (taskId, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      await projectsApi.deleteTask(taskId, orgId);
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to delete task");
    }
  },
);

export const deleteTasks = createAsyncThunk<string[], string[], { rejectValue: string }>(
  "projects/deleteTasks",
  async (taskIds, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      await projectsApi.deleteTasks(taskIds, orgId);
      return taskIds;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to delete tasks");
    }
  },
);

export const createFieldThunk = createAsyncThunk<
  FieldDefinition,
  {
    projectId: string;
    field: Omit<FieldDefinition, "id" | "projectId" | "createdAt" | "updatedAt">;
  },
  { rejectValue: string }
>("projects/createField", async ({ projectId, field }, { getState, rejectWithValue }) => {
  try {
    const state = getState() as RootState;
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) return rejectWithValue("No organization selected");

    const response = await projectsApi.createField(projectId, field, orgId);
    return response.field;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to create field");
  }
});

export const updateFieldThunk = createAsyncThunk<
  FieldDefinition,
  { projectId: string; fieldId: string; updates: Partial<FieldDefinition> },
  { rejectValue: string }
>(
  "projects/updateField",
  async ({ projectId, fieldId, updates }, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      const response = await projectsApi.updateField(projectId, fieldId, updates, orgId);
      return response.field;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to update field");
    }
  },
);

export const deleteFieldThunk = createAsyncThunk<
  { projectId: string; fieldId: string },
  { projectId: string; fieldId: string },
  { rejectValue: string }
>("projects/deleteField", async ({ projectId, fieldId }, { getState, rejectWithValue }) => {
  try {
    const state = getState() as RootState;
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) return rejectWithValue("No organization selected");

    await projectsApi.deleteField(projectId, fieldId, orgId);
    return { projectId, fieldId };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to delete field");
  }
});

export const createViewThunk = createAsyncThunk<
  ViewConfig,
  { projectId: string; view: Omit<ViewConfig, "id" | "projectId" | "createdAt" | "updatedAt"> },
  { rejectValue: string }
>("projects/createView", async ({ projectId, view }, { getState, rejectWithValue }) => {
  try {
    const state = getState() as RootState;
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) return rejectWithValue("No organization selected");

    const response = await projectsApi.createView(projectId, view, orgId);
    return response.view;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to create view");
  }
});

export const updateViewThunk = createAsyncThunk<
  ViewConfig,
  { projectId: string; viewId: string; updates: Partial<ViewConfig> },
  { rejectValue: string }
>("projects/updateView", async ({ projectId, viewId, updates }, { getState, rejectWithValue }) => {
  try {
    const state = getState() as RootState;
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) return rejectWithValue("No organization selected");

    const response = await projectsApi.updateView(projectId, viewId, updates, orgId);
    return response.view;
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to update view");
  }
});

export const deleteViewThunk = createAsyncThunk<
  { projectId: string; viewId: string },
  { projectId: string; viewId: string },
  { rejectValue: string }
>("projects/deleteView", async ({ projectId, viewId }, { getState, rejectWithValue }) => {
  try {
    const state = getState() as RootState;
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) return rejectWithValue("No organization selected");

    await projectsApi.deleteView(projectId, viewId, orgId);
    return { projectId, viewId };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to delete view");
  }
});

export const bulkUpdateTasksThunk = createAsyncThunk<
  Task[],
  {
    taskIds: string[];
    updates: {
      status?: string;
      priority?: string;
      assigneeIds?: string[];
      sprintId?: string | null;
    };
  },
  { dispatch: AppDispatch; rejectValue: string }
>(
  "projects/bulkUpdateTasks",
  async ({ taskIds, updates }, { getState, dispatch, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      const response = await projectsApi.bulkUpdateTasks(taskIds, updates, orgId);
      hydrateTaskTags(dispatch, response.protoTasks);
      return response.tasks;
    } catch (error) {
      return rejectWithValue(
        error instanceof Error ? error.message : "Failed to bulk update tasks",
      );
    }
  },
);

export const fetchActivities = createAsyncThunk<
  { taskId: string; activities: TaskActivity[] },
  string,
  { rejectValue: string }
>("projects/fetchActivities", async (taskId, { getState, rejectWithValue }) => {
  try {
    const state = getState() as RootState;
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) return rejectWithValue("No organization selected");

    const response = await projectsApi.listActivities(taskId, orgId);
    return { taskId, activities: response.activities };
  } catch (error) {
    return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch activities");
  }
});
