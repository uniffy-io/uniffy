import { createAsyncThunk } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
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

/**
 * Fetch all projects for the current organization
 */
export const fetchProjects = createAsyncThunk<Project[], void, { rejectValue: string }>(
  "projects/fetchProjects",
  async (_, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      const response = await projectsApi.listProjects(orgId);
      return response.projects;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch projects");
    }
  }
);

/**
 * Fetch a single project by ID
 */
export const fetchProject = createAsyncThunk<Project | null, string, { rejectValue: string }>(
  "projects/fetchProject",
  async (projectId, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      const response = await projectsApi.getProject(projectId, orgId);
      return response.project;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch project");
    }
  }
);

/**
 * Fetch all tasks for a project
 */
export const fetchProjectTasks = createAsyncThunk<Task[], string, { rejectValue: string }>(
  "projects/fetchProjectTasks",
  async (projectId, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      const response = await projectsApi.listTasks(projectId, orgId);
      return response.tasks;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch tasks");
    }
  }
);

/**
 * Create a new project
 */
export const createProject = createAsyncThunk<Project, CreateProjectRequest, { rejectValue: string }>(
  "projects/createProject",
  async (data, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      const response = await projectsApi.createProject(data, orgId);
      return response.project;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to create project");
    }
  }
);

/**
 * Update an existing project
 */
export const updateProject = createAsyncThunk<Project, UpdateProjectRequest, { rejectValue: string }>(
  "projects/updateProject",
  async (data, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      const response = await projectsApi.updateProject(data, orgId);
      return response.project;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to update project");
    }
  }
);

/**
 * Delete a project (soft delete)
 */
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
  }
);

/**
 * Create a new task
 */
export const createTask = createAsyncThunk<{ task: Task; updatedParent?: Task }, CreateTaskRequest, { rejectValue: string }>(
  "projects/createTask",
  async (data, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      const response = await projectsApi.createTask(data, orgId);
      return { task: response.task, updatedParent: response.updatedParent };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to create task");
    }
  }
);

/**
 * Update an existing task
 */
export const updateTask = createAsyncThunk<{ task: Task; updatedParent?: Task; spawnedTask?: Task }, UpdateTaskRequest, { rejectValue: string }>(
  "projects/updateTask",
  async (data, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      const response = await projectsApi.updateTask(data, orgId);
      return { task: response.task, updatedParent: response.updatedParent, spawnedTask: response.spawnedTask };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to update task");
    }
  }
);

/**
 * Move a task to a different status/position
 * Used for drag-and-drop operations
 */
export const moveTask = createAsyncThunk<{ task: Task; updatedParent?: Task; spawnedTask?: Task }, MoveTaskRequest, { rejectValue: string }>(
  "projects/moveTask",
  async (data, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      const response = await projectsApi.moveTask(data, orgId);
      return { task: response.task, updatedParent: response.updatedParent, spawnedTask: response.spawnedTask };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to move task");
    }
  }
);

/**
 * Delete a task (soft delete)
 */
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
  }
);

/**
 * Delete multiple tasks (soft delete)
 */
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
  }
);

// ===== Field Thunks =====

/**
 * Create a custom field in a project
 */
export const createFieldThunk = createAsyncThunk<
  FieldDefinition,
  { projectId: string; field: Omit<FieldDefinition, 'id' | 'projectId' | 'createdAt' | 'updatedAt'> },
  { rejectValue: string }
>(
  "projects/createField",
  async ({ projectId, field }, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      const response = await projectsApi.createField(projectId, field, orgId);
      return response.field;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to create field");
    }
  }
);

/**
 * Update a field definition
 */
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
  }
);

/**
 * Delete a custom field
 */
export const deleteFieldThunk = createAsyncThunk<
  { projectId: string; fieldId: string },
  { projectId: string; fieldId: string },
  { rejectValue: string }
>(
  "projects/deleteField",
  async ({ projectId, fieldId }, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      await projectsApi.deleteField(projectId, fieldId, orgId);
      return { projectId, fieldId };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to delete field");
    }
  }
);

// ===== View Thunks =====

/**
 * Create a new view for a project
 */
export const createViewThunk = createAsyncThunk<
  ViewConfig,
  { projectId: string; view: Omit<ViewConfig, 'id' | 'projectId' | 'createdAt' | 'updatedAt'> },
  { rejectValue: string }
>(
  "projects/createView",
  async ({ projectId, view }, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      const response = await projectsApi.createView(projectId, view, orgId);
      return response.view;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to create view");
    }
  }
);

/**
 * Update a view configuration
 */
export const updateViewThunk = createAsyncThunk<
  ViewConfig,
  { projectId: string; viewId: string; updates: Partial<ViewConfig> },
  { rejectValue: string }
>(
  "projects/updateView",
  async ({ projectId, viewId, updates }, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      const response = await projectsApi.updateView(projectId, viewId, updates, orgId);
      return response.view;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to update view");
    }
  }
);

/**
 * Delete a view
 */
export const deleteViewThunk = createAsyncThunk<
  { projectId: string; viewId: string },
  { projectId: string; viewId: string },
  { rejectValue: string }
>(
  "projects/deleteView",
  async ({ projectId, viewId }, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      await projectsApi.deleteView(projectId, viewId, orgId);
      return { projectId, viewId };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to delete view");
    }
  }
);

// ===== Bulk Update Thunk =====

/**
 * Bulk update multiple tasks
 */
export const bulkUpdateTasksThunk = createAsyncThunk<
  Task[],
  { taskIds: string[]; updates: { status?: string; priority?: string; assigneeIds?: string[]; sprintId?: string | null } },
  { rejectValue: string }
>(
  "projects/bulkUpdateTasks",
  async ({ taskIds, updates }, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      const response = await projectsApi.bulkUpdateTasks(taskIds, updates, orgId);
      return response.tasks;
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to bulk update tasks");
    }
  }
);

// ===== Activity Thunks =====

/**
 * Fetch activities for a task
 */
export const fetchActivities = createAsyncThunk<
  { taskId: string; activities: TaskActivity[] },
  string,
  { rejectValue: string }
>(
  "projects/fetchActivities",
  async (taskId, { getState, rejectWithValue }) => {
    try {
      const state = getState() as RootState;
      const orgId = state.auth.currentOrganizationId;
      if (!orgId) return rejectWithValue("No organization selected");

      const response = await projectsApi.listActivities(taskId, orgId);
      return { taskId, activities: response.activities };
    } catch (error) {
      return rejectWithValue(error instanceof Error ? error.message : "Failed to fetch activities");
    }
  }
);
