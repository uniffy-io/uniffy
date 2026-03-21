import { createSlice, createSelector, type PayloadAction } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import type { Project, Task } from "../types/project";
import type { FieldDefinition } from "../types/fields";
import type { TaskActivity } from "../types/activity";
import type { LoadingState, ErrorState } from "../types/ui";
import {
  fetchProjects,
  fetchProject,
  fetchProjectTasks,
  createProject,
  updateProject,
  deleteProject,
  createTask,
  updateTask,
  moveTask,
  deleteTask,
  deleteTasks,
  createFieldThunk,
  updateFieldThunk,
  deleteFieldThunk,
  createViewThunk,
  updateViewThunk,
  deleteViewThunk,
  bulkUpdateTasksThunk,
  fetchActivities,
} from "./projectsThunks";

/**
 * Projects domain state
 */
export interface ProjectsState {
  /** Projects indexed by ID */
  projects: Record<string, Project>;
  /** Tasks indexed by ID */
  tasks: Record<string, Task>;
  /** Currently selected project ID */
  currentProjectId: string | null;
  /** Activities indexed by task ID */
  activities: Record<string, TaskActivity[]>;
  /** Loading states for async operations */
  loading: LoadingState;
  /** Error states for async operations */
  errors: ErrorState;
  /** Snapshot for reverting failed optimistic task updates */
  _pendingTaskSnapshot?: Task;
}

const initialState: ProjectsState = {
  projects: {},
  tasks: {},
  currentProjectId: null,
  activities: {},
  loading: {
    projects: false,
    tasks: false,
    creating: false,
    updating: null,
    deleting: null,
  },
  errors: {
    projects: null,
    tasks: null,
    general: null,
  },
};

export const projectsSlice = createSlice({
  name: "projects",
  initialState,
  reducers: {
    /**
     * Set the current project
     */
    setCurrentProject: (state, action: PayloadAction<string | null>) => {
      state.currentProjectId = action.payload;
    },

    /**
     * Clear all projects (e.g., on logout)
     */
    clearProjects: (state) => {
      state.projects = {};
      state.tasks = {};
      state.currentProjectId = null;
      state.errors = { projects: null, tasks: null, general: null };
    },

    /**
     * Clear errors
     */
    clearErrors: (state) => {
      state.errors = { projects: null, tasks: null, general: null };
    },

    /**
     * Optimistically update a task (for drag-and-drop)
     */
    optimisticUpdateTask: (state, action: PayloadAction<Partial<Task> & { id: string }>) => {
      const { id, ...updates } = action.payload;
      const task = state.tasks[id];
      if (task) {
        // Snapshot BEFORE applying changes so rejected thunks can revert
        state._pendingTaskSnapshot = { ...task };
        // If status changed on a subtask, update parent's subtask counts
        if (updates.status && task.parentId && state.tasks[task.parentId]) {
          const parent = state.tasks[task.parentId];
          const wasDone = task.status === "status_done";
          const nowDone = updates.status === "status_done";
          if (wasDone && !nowDone) {
            parent.subtaskCompleted = Math.max(0, parent.subtaskCompleted - 1);
          } else if (!wasDone && nowDone) {
            parent.subtaskCompleted = parent.subtaskCompleted + 1;
          }
        }
        // Merge fieldValues instead of replacing
        if (updates.fieldValues) {
          updates.fieldValues = { ...task.fieldValues, ...updates.fieldValues };
        }
        state.tasks[id] = { ...task, ...updates };
      }
    },

    /**
     * Bulk update multiple tasks at once (for multi-select field editing)
     */
    bulkUpdateTasks: (state, action: PayloadAction<{ ids: string[]; changes: Partial<Task> }>) => {
      action.payload.ids.forEach((id) => {
        if (state.tasks[id]) {
          state.tasks[id] = { ...state.tasks[id], ...action.payload.changes };
        }
      });
    },

    /**
     * Add a custom field definition to a project
     */
    addFieldDefinition: (state, action: PayloadAction<{ projectId: string; field: FieldDefinition }>) => {
      const project = state.projects[action.payload.projectId];
      if (project) {
        project.fieldDefinitions.push(action.payload.field);
      }
    },

    /**
     * Remove a field definition from a project
     */
    removeFieldDefinition: (state, action: PayloadAction<{ projectId: string; fieldId: string }>) => {
      const project = state.projects[action.payload.projectId];
      if (project) {
        project.fieldDefinitions = project.fieldDefinitions.filter(
          (f) => f.id !== action.payload.fieldId
        );
      }
    },

    /**
     * Update a field definition (rename, update config)
     */
    updateFieldDefinition: (state, action: PayloadAction<{ projectId: string; fieldId: string; changes: Partial<FieldDefinition> }>) => {
      const project = state.projects[action.payload.projectId];
      if (project) {
        const idx = project.fieldDefinitions.findIndex((f) => f.id === action.payload.fieldId);
        if (idx !== -1) {
          project.fieldDefinitions[idx] = { ...project.fieldDefinitions[idx], ...action.payload.changes };
        }
      }
    },

  },
  extraReducers: (builder) => {
    // ===== Fetch Projects =====
    builder
      .addCase(fetchProjects.pending, (state) => {
        state.loading.projects = true;
        state.errors.projects = null;
      })
      .addCase(fetchProjects.fulfilled, (state, action) => {
        state.loading.projects = false;
        // Index projects by ID
        state.projects = action.payload.reduce(
          (acc, project) => {
            acc[project.id] = project;
            return acc;
          },
          {} as Record<string, Project>
        );
        // If no current project and we have projects, select the first one
        if (!state.currentProjectId && action.payload.length > 0) {
          state.currentProjectId = action.payload[0].id;
        }
      })
      .addCase(fetchProjects.rejected, (state, action) => {
        state.loading.projects = false;
        state.errors.projects = (action.payload as string) || action.error.message || "Failed to fetch projects";
      });

    // ===== Fetch Single Project =====
    builder
      .addCase(fetchProject.fulfilled, (state, action) => {
        if (action.payload) {
          state.projects[action.payload.id] = action.payload;
        }
      });

    // ===== Fetch Project Tasks =====
    builder
      .addCase(fetchProjectTasks.pending, (state) => {
        state.loading.tasks = true;
        state.errors.tasks = null;
      })
      .addCase(fetchProjectTasks.fulfilled, (state, action) => {
        state.loading.tasks = false;
        // Index tasks by ID (merge with existing)
        action.payload.forEach((task) => {
          state.tasks[task.id] = task;
        });
      })
      .addCase(fetchProjectTasks.rejected, (state, action) => {
        state.loading.tasks = false;
        state.errors.tasks = (action.payload as string) || action.error.message || "Failed to fetch tasks";
      });

    // ===== Create Project =====
    builder
      .addCase(createProject.pending, (state) => {
        state.loading.creating = true;
      })
      .addCase(createProject.fulfilled, (state, action) => {
        state.loading.creating = false;
        state.projects[action.payload.id] = action.payload;
        state.currentProjectId = action.payload.id;
      })
      .addCase(createProject.rejected, (state, action) => {
        state.loading.creating = false;
        state.errors.general = (action.payload as string) || action.error.message || "Failed to create project";
      });

    // ===== Update Project =====
    builder
      .addCase(updateProject.pending, (state, action) => {
        state.loading.updating = action.meta.arg.id;
      })
      .addCase(updateProject.fulfilled, (state, action) => {
        state.loading.updating = null;
        state.projects[action.payload.id] = action.payload;
      })
      .addCase(updateProject.rejected, (state, action) => {
        state.loading.updating = null;
        state.errors.general = (action.payload as string) || action.error.message || "Failed to update project";
      });

    // ===== Delete Project =====
    builder
      .addCase(deleteProject.pending, (state, action) => {
        state.loading.deleting = action.meta.arg;
      })
      .addCase(deleteProject.fulfilled, (state, action) => {
        state.loading.deleting = null;
        delete state.projects[action.meta.arg];
        // Clear current project if it was deleted
        if (state.currentProjectId === action.meta.arg) {
          const remaining = Object.keys(state.projects);
          state.currentProjectId = remaining.length > 0 ? remaining[0] : null;
        }
        // Remove associated tasks
        Object.keys(state.tasks).forEach((taskId) => {
          if (state.tasks[taskId].projectId === action.meta.arg) {
            delete state.tasks[taskId];
          }
        });
      })
      .addCase(deleteProject.rejected, (state, action) => {
        state.loading.deleting = null;
        state.errors.general = (action.payload as string) || action.error.message || "Failed to delete project";
      });

    // ===== Create Task =====
    builder
      .addCase(createTask.pending, (state) => {
        state.loading.creating = true;
      })
      .addCase(createTask.fulfilled, (state, action) => {
        state.loading.creating = false;
        const { task, updatedParent } = action.payload;
        state.tasks[task.id] = task;
        if (updatedParent) {
          state.tasks[updatedParent.id] = updatedParent;
        }
      })
      .addCase(createTask.rejected, (state, action) => {
        state.loading.creating = false;
        state.errors.general = (action.payload as string) || action.error.message || "Failed to create task";
      });

    // ===== Update Task =====
    builder
      .addCase(updateTask.pending, (state, action) => {
        state.loading.updating = action.meta.arg.id;
      })
      .addCase(updateTask.fulfilled, (state, action) => {
        state.loading.updating = null;
        const { task, updatedParent } = action.payload;
        state.tasks[task.id] = task;
        if (updatedParent) {
          state.tasks[updatedParent.id] = updatedParent;
        }
        state._pendingTaskSnapshot = undefined;
      })
      .addCase(updateTask.rejected, (state, action) => {
        state.loading.updating = null;
        state.errors.general = (action.payload as string) || action.error.message || "Failed to update task";
        // Revert optimistic update on failure
        if (state._pendingTaskSnapshot) {
          const snapshot = state._pendingTaskSnapshot;
          state.tasks[snapshot.id] = snapshot;
          state._pendingTaskSnapshot = undefined;
        }
      });

    // ===== Move Task =====
    builder
      .addCase(moveTask.fulfilled, (state, action) => {
        const { task, updatedParent } = action.payload;
        state.tasks[task.id] = task;
        if (updatedParent) {
          state.tasks[updatedParent.id] = updatedParent;
        }
        state._pendingTaskSnapshot = undefined;
      })
      .addCase(moveTask.rejected, (state, action) => {
        state.errors.general = (action.payload as string) || action.error.message || "Failed to move task";
        // Revert optimistic update on failure
        if (state._pendingTaskSnapshot) {
          const snapshot = state._pendingTaskSnapshot;
          state.tasks[snapshot.id] = snapshot;
          state._pendingTaskSnapshot = undefined;
        }
      });

    // ===== Delete Task =====
    builder
      .addCase(deleteTask.pending, (state, action) => {
        state.loading.deleting = action.meta.arg;
      })
      .addCase(deleteTask.fulfilled, (state, action) => {
        state.loading.deleting = null;
        const taskId = action.meta.arg;
        const task = state.tasks[taskId];
        // Update parent counts before removing
        if (task?.parentId && state.tasks[task.parentId]) {
          const parent = state.tasks[task.parentId];
          parent.subtaskTotal = Math.max(0, parent.subtaskTotal - 1);
          if (task.status === "status_done") {
            parent.subtaskCompleted = Math.max(0, parent.subtaskCompleted - 1);
          }
        }
        delete state.tasks[taskId];
      })
      .addCase(deleteTask.rejected, (state, action) => {
        state.loading.deleting = null;
        state.errors.general = (action.payload as string) || action.error.message || "Failed to delete task";
      });

    // ===== Delete Multiple Tasks =====
    builder
      .addCase(deleteTasks.pending, (state) => {
        state.loading.deleting = "bulk";
      })
      .addCase(deleteTasks.fulfilled, (state, action) => {
        state.loading.deleting = null;
        action.payload.forEach((taskId) => {
          const task = state.tasks[taskId];
          if (task?.parentId && state.tasks[task.parentId]) {
            const parent = state.tasks[task.parentId];
            parent.subtaskTotal = Math.max(0, parent.subtaskTotal - 1);
            if (task.status === "status_done") {
              parent.subtaskCompleted = Math.max(0, parent.subtaskCompleted - 1);
            }
          }
          delete state.tasks[taskId];
        });
      })
      .addCase(deleteTasks.rejected, (state, action) => {
        state.loading.deleting = null;
        state.errors.general = (action.payload as string) || action.error.message || "Failed to delete tasks";
      });

    // ===== Create Field =====
    builder
      .addCase(createFieldThunk.fulfilled, (state, action) => {
        const field = action.payload;
        const project = state.projects[field.projectId];
        if (project) {
          // Replace optimistic entry if it exists, otherwise push
          const idx = project.fieldDefinitions.findIndex((f) => f.id === field.id);
          if (idx !== -1) {
            project.fieldDefinitions[idx] = field;
          } else {
            project.fieldDefinitions.push(field);
          }
        }
      });

    // ===== Update Field =====
    builder
      .addCase(updateFieldThunk.fulfilled, (state, action) => {
        const field = action.payload;
        const project = state.projects[field.projectId];
        if (project) {
          const idx = project.fieldDefinitions.findIndex((f) => f.id === field.id);
          if (idx !== -1) {
            project.fieldDefinitions[idx] = field;
          }
        }
      });

    // ===== Delete Field =====
    builder
      .addCase(deleteFieldThunk.fulfilled, (state, action) => {
        const { projectId, fieldId } = action.payload;
        const project = state.projects[projectId];
        if (project) {
          project.fieldDefinitions = project.fieldDefinitions.filter(
            (f) => f.id !== fieldId
          );
        }
      });

    // ===== Create View =====
    builder
      .addCase(createViewThunk.fulfilled, (state, action) => {
        const view = action.payload;
        const project = state.projects[view.projectId];
        if (project) {
          const idx = project.views.findIndex((v) => v.id === view.id);
          if (idx !== -1) {
            project.views[idx] = view;
          } else {
            project.views.push(view);
          }
        }
      });

    // ===== Update View =====
    builder
      .addCase(updateViewThunk.fulfilled, (state, action) => {
        const view = action.payload;
        const project = state.projects[view.projectId];
        if (project) {
          const idx = project.views.findIndex((v) => v.id === view.id);
          if (idx !== -1) {
            project.views[idx] = view;
          }
        }
      });

    // ===== Delete View =====
    builder
      .addCase(deleteViewThunk.fulfilled, (state, action) => {
        const { projectId, viewId } = action.payload;
        const project = state.projects[projectId];
        if (project) {
          project.views = project.views.filter((v) => v.id !== viewId);
        }
      });

    // ===== Bulk Update Tasks =====
    builder
      .addCase(bulkUpdateTasksThunk.fulfilled, (state, action) => {
        action.payload.forEach((task) => {
          state.tasks[task.id] = task;
        });
      });

    // ===== Fetch Activities =====
    builder
      .addCase(fetchActivities.fulfilled, (state, action) => {
        state.activities[action.payload.taskId] = action.payload.activities;
      });
  },
});

// Actions
export const {
  setCurrentProject,
  clearProjects,
  clearErrors,
  optimisticUpdateTask,
  bulkUpdateTasks,
  addFieldDefinition,
  removeFieldDefinition,
  updateFieldDefinition,
} = projectsSlice.actions;

// Selectors
const selectProjectsState = (state: RootState) => state.projects;

export const selectProjects = createSelector(
  [selectProjectsState],
  (state) => Object.values(state.projects)
);

export const selectProjectById = (id: string) => createSelector(
  [selectProjectsState],
  (state) => state.projects[id]
);

export const selectCurrentProjectId = createSelector(
  [selectProjectsState],
  (state) => state.currentProjectId
);

export const selectCurrentProject = createSelector(
  [selectProjectsState, selectCurrentProjectId],
  (state, currentId) => (currentId ? state.projects[currentId] : null)
);

export const selectAllTasks = createSelector(
  [selectProjectsState],
  (state) => Object.values(state.tasks)
);

export const selectTasksMap = (state: RootState) => state.projects.tasks;

export const selectTaskById = (id: string) => createSelector(
  [selectProjectsState],
  (state) => state.tasks[id]
);

/**
 * Select subtasks for a given parent task ID.
 * Returns a stable reference when the tasks map hasn't changed.
 */
export const selectSubtasksByParentId = (parentId: string) => createSelector(
  [selectAllTasks],
  (tasks) => tasks.filter((t) => t.parentId === parentId)
);

export const selectTasksForProject = (projectId: string) => createSelector(
  [selectAllTasks],
  (tasks) => tasks.filter((t) => t.projectId === projectId)
);

export const selectTasksByStatus = (projectId: string) => createSelector(
  [selectTasksForProject(projectId)],
  (tasks) => {
    return tasks.reduce(
      (acc, task) => {
        if (!acc[task.status]) {
          acc[task.status] = [];
        }
        acc[task.status].push(task);
        // Sort by sortOrder within each status
        acc[task.status].sort((a, b) => a.sortOrder - b.sortOrder);
        return acc;
      },
      {} as Record<string, Task[]>
    );
  }
);

export const selectProjectCompletion = createSelector(
  [selectAllTasks],
  (tasks) => {
    const projectStats: Record<string, { total: number; completed: number }> = {};
  
    tasks.forEach(task => {
      if (task.parentId) return; // Only count root tasks, not subtasks
      if (!projectStats[task.projectId]) {
        projectStats[task.projectId] = { total: 0, completed: 0 };
      }
      projectStats[task.projectId].total++;
      if (task.completedAt) {
        projectStats[task.projectId].completed++;
      }
    });
  
    const completionRates: Record<string, number> = {};
    Object.keys(projectStats).forEach(pid => {
      const stats = projectStats[pid];
      completionRates[pid] = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
    });
  
    return completionRates;
  }
);

export const selectActivitiesForTask = (taskId: string) => createSelector(
  [selectProjectsState],
  (state) => state.activities[taskId] ?? []
);

export const selectProjectsLoading = (state: RootState) => state.projects.loading;

export const selectProjectsErrors = (state: RootState) => state.projects.errors;

export const projectsReducer = projectsSlice.reducer;
