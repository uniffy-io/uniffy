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

export interface ProjectsState {
  projects: Record<string, Project>;
  tasks: Record<string, Task>;
  currentProjectId: string | null;
  activities: Record<string, TaskActivity[]>;
  /** Projects whose task list was fetched this session; single-task reads do not count. */
  taskListLoadedIds: Record<string, true>;
  loading: LoadingState;
  errors: ErrorState;
  /** Snapshot for reverting failed optimistic task updates. */
  _pendingTaskSnapshot?: Task;
  /** Snapshots of parents whose subtask counts were optimistically adjusted. */
  _pendingParentSnapshots?: Record<string, Task>;
}

const initialState: ProjectsState = {
  projects: {},
  tasks: {},
  currentProjectId: null,
  activities: {},
  taskListLoadedIds: {},
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
    setCurrentProject: (state, action: PayloadAction<string | null>) => {
      state.currentProjectId = action.payload;
    },

    clearProjects: (state) => {
      state.projects = {};
      state.tasks = {};
      state.taskListLoadedIds = {};
      state.currentProjectId = null;
      state.errors = { projects: null, tasks: null, general: null };
    },

    clearErrors: (state) => {
      state.errors = { projects: null, tasks: null, general: null };
    },

    optimisticUpdateTask: (state, action: PayloadAction<Partial<Task> & { id: string }>) => {
      const { id, ...updates } = action.payload;
      const task = state.tasks[id];
      if (task) {
        state._pendingTaskSnapshot = { ...task };
        state._pendingParentSnapshots = {};
        if (updates.status && task.parentId && state.tasks[task.parentId]) {
          const parent = state.tasks[task.parentId];
          state._pendingParentSnapshots[parent.id] = { ...parent };
          const wasDone = task.status === "status_done";
          const nowDone = updates.status === "status_done";
          if (wasDone && !nowDone) {
            parent.subtaskCompleted = Math.max(0, parent.subtaskCompleted - 1);
          } else if (!wasDone && nowDone) {
            parent.subtaskCompleted = parent.subtaskCompleted + 1;
          }
        }
        if ("parentId" in updates && updates.parentId !== task.parentId) {
          const wasDone = task.status === "status_done";
          if (task.parentId && state.tasks[task.parentId]) {
            const oldParent = state.tasks[task.parentId];
            if (!state._pendingParentSnapshots[oldParent.id]) {
              state._pendingParentSnapshots[oldParent.id] = { ...oldParent };
            }
            oldParent.subtaskTotal = Math.max(0, oldParent.subtaskTotal - 1);
            if (wasDone) {
              oldParent.subtaskCompleted = Math.max(0, oldParent.subtaskCompleted - 1);
            }
          }
          if (updates.parentId && state.tasks[updates.parentId]) {
            const newParent = state.tasks[updates.parentId];
            if (!state._pendingParentSnapshots[newParent.id]) {
              state._pendingParentSnapshots[newParent.id] = { ...newParent };
            }
            newParent.subtaskTotal = newParent.subtaskTotal + 1;
            if (wasDone) {
              newParent.subtaskCompleted = newParent.subtaskCompleted + 1;
            }
          }
        }
        if (updates.fieldValues) {
          updates.fieldValues = { ...task.fieldValues, ...updates.fieldValues };
        }
        state.tasks[id] = { ...task, ...updates };
      }
    },

    bulkUpdateTasks: (state, action: PayloadAction<{ ids: string[]; changes: Partial<Task> }>) => {
      action.payload.ids.forEach((id) => {
        if (state.tasks[id]) {
          state.tasks[id] = { ...state.tasks[id], ...action.payload.changes };
        }
      });
    },

    addFieldDefinition: (
      state,
      action: PayloadAction<{ projectId: string; field: FieldDefinition }>,
    ) => {
      const project = state.projects[action.payload.projectId];
      if (project) {
        project.fieldDefinitions.push(action.payload.field);
      }
    },

    removeFieldDefinition: (
      state,
      action: PayloadAction<{ projectId: string; fieldId: string }>,
    ) => {
      const project = state.projects[action.payload.projectId];
      if (project) {
        project.fieldDefinitions = project.fieldDefinitions.filter(
          (f) => f.id !== action.payload.fieldId,
        );
      }
    },

    updateFieldDefinition: (
      state,
      action: PayloadAction<{
        projectId: string;
        fieldId: string;
        changes: Partial<FieldDefinition>;
      }>,
    ) => {
      const project = state.projects[action.payload.projectId];
      if (project) {
        const idx = project.fieldDefinitions.findIndex((f) => f.id === action.payload.fieldId);
        if (idx !== -1) {
          project.fieldDefinitions[idx] = {
            ...project.fieldDefinitions[idx],
            ...action.payload.changes,
          };
        }
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchProjects.pending, (state) => {
        state.loading.projects = true;
        state.errors.projects = null;
      })
      .addCase(fetchProjects.fulfilled, (state, action) => {
        state.loading.projects = false;
        state.projects = action.payload.reduce(
          (acc, project) => {
            acc[project.id] = project;
            return acc;
          },
          {} as Record<string, Project>,
        );
        if (!state.currentProjectId && action.payload.length > 0) {
          state.currentProjectId = action.payload[0].id;
        }
      })
      .addCase(fetchProjects.rejected, (state, action) => {
        state.loading.projects = false;
        state.errors.projects =
          (action.payload as string) || action.error.message || "Failed to fetch projects";
      });

    builder.addCase(fetchProject.fulfilled, (state, action) => {
      if (action.payload) {
        state.projects[action.payload.id] = action.payload;
      }
    });

    builder
      .addCase(fetchProjectTasks.pending, (state) => {
        state.loading.tasks = true;
        state.errors.tasks = null;
      })
      .addCase(fetchProjectTasks.fulfilled, (state, action) => {
        state.loading.tasks = false;
        action.payload.forEach((task) => {
          state.tasks[task.id] = task;
        });
        const { arg } = action.meta;
        state.taskListLoadedIds[typeof arg === "string" ? arg : arg.projectId] = true;
      })
      .addCase(fetchProjectTasks.rejected, (state, action) => {
        // A superseded load settles after its replacement started; its outcome is not this state's.
        if (action.meta.aborted) return;
        state.loading.tasks = false;
        state.errors.tasks =
          (action.payload as string) || action.error.message || "Failed to fetch tasks";
      });

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
        state.errors.general =
          (action.payload as string) || action.error.message || "Failed to create project";
      });

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
        state.errors.general =
          (action.payload as string) || action.error.message || "Failed to update project";
      });

    builder
      .addCase(deleteProject.pending, (state, action) => {
        state.loading.deleting = action.meta.arg;
      })
      .addCase(deleteProject.fulfilled, (state, action) => {
        state.loading.deleting = null;
        delete state.projects[action.meta.arg];
        delete state.taskListLoadedIds[action.meta.arg];
        if (state.currentProjectId === action.meta.arg) {
          const remaining = Object.keys(state.projects);
          state.currentProjectId = remaining.length > 0 ? remaining[0] : null;
        }
        Object.keys(state.tasks).forEach((taskId) => {
          if (state.tasks[taskId].projectId === action.meta.arg) {
            delete state.tasks[taskId];
          }
        });
      })
      .addCase(deleteProject.rejected, (state, action) => {
        state.loading.deleting = null;
        state.errors.general =
          (action.payload as string) || action.error.message || "Failed to delete project";
      });

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
        state.errors.general =
          (action.payload as string) || action.error.message || "Failed to create task";
      });

    builder
      .addCase(updateTask.pending, (state, action) => {
        state.loading.updating = action.meta.arg.id;
      })
      .addCase(updateTask.fulfilled, (state, action) => {
        state.loading.updating = null;
        const { task, updatedParent, spawnedTask } = action.payload;
        state.tasks[task.id] = task;
        if (updatedParent) {
          state.tasks[updatedParent.id] = updatedParent;
        }
        if (spawnedTask) {
          state.tasks[spawnedTask.id] = spawnedTask;
        }
        state._pendingTaskSnapshot = undefined;
        state._pendingParentSnapshots = undefined;
      })
      .addCase(updateTask.rejected, (state, action) => {
        state.loading.updating = null;
        state.errors.general =
          (action.payload as string) || action.error.message || "Failed to update task";
        if (state._pendingTaskSnapshot) {
          const snapshot = state._pendingTaskSnapshot;
          state.tasks[snapshot.id] = snapshot;
          state._pendingTaskSnapshot = undefined;
        }
        if (state._pendingParentSnapshots) {
          for (const snapshot of Object.values(state._pendingParentSnapshots)) {
            state.tasks[snapshot.id] = snapshot;
          }
          state._pendingParentSnapshots = undefined;
        }
      });

    builder
      .addCase(moveTask.fulfilled, (state, action) => {
        const { task, updatedParent, spawnedTask } = action.payload;
        state.tasks[task.id] = task;
        if (updatedParent) {
          state.tasks[updatedParent.id] = updatedParent;
        }
        if (spawnedTask) {
          state.tasks[spawnedTask.id] = spawnedTask;
        }
        state._pendingTaskSnapshot = undefined;
        state._pendingParentSnapshots = undefined;
      })
      .addCase(moveTask.rejected, (state, action) => {
        state.errors.general =
          (action.payload as string) || action.error.message || "Failed to move task";
        if (state._pendingTaskSnapshot) {
          const snapshot = state._pendingTaskSnapshot;
          state.tasks[snapshot.id] = snapshot;
          state._pendingTaskSnapshot = undefined;
        }
        if (state._pendingParentSnapshots) {
          for (const snapshot of Object.values(state._pendingParentSnapshots)) {
            state.tasks[snapshot.id] = snapshot;
          }
          state._pendingParentSnapshots = undefined;
        }
      });

    builder
      .addCase(deleteTask.pending, (state, action) => {
        state.loading.deleting = action.meta.arg;
      })
      .addCase(deleteTask.fulfilled, (state, action) => {
        state.loading.deleting = null;
        const taskId = action.meta.arg;
        const task = state.tasks[taskId];
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
        state.errors.general =
          (action.payload as string) || action.error.message || "Failed to delete task";
      });

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
        state.errors.general =
          (action.payload as string) || action.error.message || "Failed to delete tasks";
      });

    builder.addCase(createFieldThunk.fulfilled, (state, action) => {
      const field = action.payload;
      const project = state.projects[field.projectId];
      if (project) {
        const idx = project.fieldDefinitions.findIndex((f) => f.id === field.id);
        if (idx !== -1) {
          project.fieldDefinitions[idx] = field;
        } else {
          project.fieldDefinitions.push(field);
        }
      }
    });

    builder.addCase(updateFieldThunk.fulfilled, (state, action) => {
      const field = action.payload;
      const project = state.projects[field.projectId];
      if (project) {
        const idx = project.fieldDefinitions.findIndex((f) => f.id === field.id);
        if (idx !== -1) {
          project.fieldDefinitions[idx] = field;
        }
      }
    });

    builder.addCase(deleteFieldThunk.fulfilled, (state, action) => {
      const { projectId, fieldId } = action.payload;
      const project = state.projects[projectId];
      if (project) {
        project.fieldDefinitions = project.fieldDefinitions.filter((f) => f.id !== fieldId);
      }
    });

    builder.addCase(createViewThunk.fulfilled, (state, action) => {
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

    builder.addCase(updateViewThunk.fulfilled, (state, action) => {
      const view = action.payload;
      const project = state.projects[view.projectId];
      if (project) {
        const idx = project.views.findIndex((v) => v.id === view.id);
        if (idx !== -1) {
          project.views[idx] = view;
        }
      }
    });

    builder.addCase(deleteViewThunk.fulfilled, (state, action) => {
      const { projectId, viewId } = action.payload;
      const project = state.projects[projectId];
      if (project) {
        project.views = project.views.filter((v) => v.id !== viewId);
      }
    });

    builder.addCase(bulkUpdateTasksThunk.fulfilled, (state, action) => {
      action.payload.forEach((task) => {
        state.tasks[task.id] = task;
      });
    });

    builder.addCase(fetchActivities.fulfilled, (state, action) => {
      state.activities[action.payload.taskId] = action.payload.activities;
    });
  },
});

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

const selectProjectsState = (state: RootState) => state.projects;

export const selectProjects = createSelector([selectProjectsState], (state) =>
  Object.values(state.projects),
);

export const selectProjectById = (id: string) =>
  createSelector([selectProjectsState], (state) => state.projects[id]);

export const selectCurrentProjectId = createSelector(
  [selectProjectsState],
  (state) => state.currentProjectId,
);

export const selectCurrentProject = createSelector(
  [selectProjectsState, selectCurrentProjectId],
  (state, currentId) => (currentId ? state.projects[currentId] : null),
);

export const selectAllTasks = createSelector([selectProjectsState], (state) =>
  Object.values(state.tasks),
);

export const selectTasksMap = (state: RootState) => state.projects.tasks;

export const selectTaskListLoadedIds = (state: RootState) => state.projects.taskListLoadedIds;

export const selectTaskById = (id: string) =>
  createSelector([selectProjectsState], (state) => state.tasks[id]);

export const selectSubtasksByParentId = (parentId: string) =>
  createSelector([selectAllTasks], (tasks) => tasks.filter((t) => t.parentId === parentId));

export const selectTasksForProject = (projectId: string) =>
  createSelector([selectAllTasks], (tasks) => tasks.filter((t) => t.projectId === projectId));

export const selectTasksByStatus = (projectId: string) =>
  createSelector([selectTasksForProject(projectId)], (tasks) => {
    return tasks.reduce(
      (acc, task) => {
        if (!acc[task.status]) {
          acc[task.status] = [];
        }
        acc[task.status].push(task);
        acc[task.status].sort((a, b) => a.sortOrder - b.sortOrder);
        return acc;
      },
      {} as Record<string, Task[]>,
    );
  });

export const selectProjectCompletion = createSelector([selectAllTasks], (tasks) => {
  const projectStats: Record<string, { total: number; completed: number }> = {};

  tasks.forEach((task) => {
    if (task.parentId) return;
    if (!projectStats[task.projectId]) {
      projectStats[task.projectId] = { total: 0, completed: 0 };
    }
    projectStats[task.projectId].total++;
    if (task.completedAt) {
      projectStats[task.projectId].completed++;
    }
  });

  const completionRates: Record<string, number> = {};
  Object.keys(projectStats).forEach((pid) => {
    const stats = projectStats[pid];
    completionRates[pid] = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
  });

  return completionRates;
});

export const selectActivitiesForTask = (taskId: string) =>
  createSelector([selectProjectsState], (state) => state.activities[taskId] ?? []);

export const selectProjectsLoading = (state: RootState) => state.projects.loading;

export const selectProjectsErrors = (state: RootState) => state.projects.errors;

export const projectsReducer = projectsSlice.reducer;
