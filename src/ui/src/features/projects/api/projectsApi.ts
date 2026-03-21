/**
 * Projects API Service
 *
 * ConnectRPC client for projects operations.
 * All API calls go through this service for consistent error handling.
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { ProjectsService } from '@uniffy/proto/projects/v1/projects_connect';
import { VisibilityScope as ProtoVisibilityScope } from '@uniffy/proto/common/v1/common_pb';
import {
  FieldType as ProtoFieldType,
  ViewType as ProtoViewType,
  ActivityAction as ProtoActivityAction,
  TypeFieldSchema as ProtoTypeFieldSchema,
} from '@uniffy/proto/projects/v1/projects_pb';
import type {
  Project as ProtoProject,
  Task as ProtoTask,
  FieldDefinition as ProtoFieldDefinition,
  ViewConfig as ProtoViewConfig,
  TaskActivity as ProtoTaskActivity,
  Sprint as ProtoSprint,
} from '@uniffy/proto/projects/v1/projects_pb';
import type {
  Project,
  Task,
  Sprint,
  CreateProjectRequest as FrontendCreateProjectRequest,
  UpdateProjectRequest as FrontendUpdateProjectRequest,
  CreateTaskRequest as FrontendCreateTaskRequest,
  UpdateTaskRequest as FrontendUpdateTaskRequest,
  MoveTaskRequest as FrontendMoveTaskRequest,
  CreateSprintRequest as FrontendCreateSprintRequest,
  UpdateSprintRequest as FrontendUpdateSprintRequest,
  StartSprintRequest as FrontendStartSprintRequest,
} from '../types/project';
import type { FieldDefinition, FieldValue } from '../types/fields';
import type { ViewConfig, ViewSpecificConfig } from '../types/views';
import type { TaskActivity, ActivityAction } from '../types/activity';

/**
 * Create a projects service client with the shared transport.
 */
const projectsClient = createClient(ProjectsService, transport);

/**
 * Convert frontend visibility scope to proto enum
 */
function frontendVisibilityToProto(visibility: string | undefined): ProtoVisibilityScope {
  if (!visibility) return ProtoVisibilityScope.PRIVATE;

  switch (visibility.toUpperCase()) {
    case 'PRIVATE':
      return ProtoVisibilityScope.PRIVATE;
    case 'GROUP':
      return ProtoVisibilityScope.GROUP;
    case 'ORGANIZATION':
      return ProtoVisibilityScope.ORGANIZATION;
    case 'PUBLIC':
      return ProtoVisibilityScope.PUBLIC;
    default:
      return ProtoVisibilityScope.PRIVATE;
  }
}

/**
 * Convert proto visibility scope to frontend string
 */
function protoVisibilityToFrontend(visibility: ProtoVisibilityScope): string {
  switch (visibility) {
    case ProtoVisibilityScope.PRIVATE:
      return 'PRIVATE';
    case ProtoVisibilityScope.GROUP:
      return 'GROUP';
    case ProtoVisibilityScope.ORGANIZATION:
      return 'ORGANIZATION';
    case ProtoVisibilityScope.PUBLIC:
      return 'PUBLIC';
    default:
      return 'PRIVATE';
  }
}

/**
 * Convert frontend field type to proto enum
 */
function frontendFieldTypeToProto(type: string): ProtoFieldType {
  switch (type.toLowerCase()) {
    case 'text':
      return ProtoFieldType.TEXT;
    case 'number':
      return ProtoFieldType.NUMBER;
    case 'single_select':
      return ProtoFieldType.SINGLE_SELECT;
    case 'multi_select':
      return ProtoFieldType.MULTI_SELECT;
    case 'date':
      return ProtoFieldType.DATE;
    case 'person':
      return ProtoFieldType.PERSON;
    case 'reference':
      return ProtoFieldType.REFERENCE;
    default:
      return ProtoFieldType.TEXT;
  }
}

/**
 * Convert proto field type to frontend string
 */
function protoFieldTypeToFrontend(type: ProtoFieldType): string {
  switch (type) {
    case ProtoFieldType.TEXT:
      return 'text';
    case ProtoFieldType.NUMBER:
      return 'number';
    case ProtoFieldType.SINGLE_SELECT:
      return 'single_select';
    case ProtoFieldType.MULTI_SELECT:
      return 'multi_select';
    case ProtoFieldType.DATE:
      return 'date';
    case ProtoFieldType.PERSON:
      return 'person';
    case ProtoFieldType.REFERENCE:
      return 'reference';
    default:
      return 'text';
  }
}

/**
 * Convert frontend view type to proto enum
 */
function frontendViewTypeToProto(type: string): ProtoViewType {
  switch (type.toLowerCase()) {
    case 'table':
      return ProtoViewType.TABLE;
    case 'board':
      return ProtoViewType.BOARD;
    case 'roadmap':
      return ProtoViewType.ROADMAP;
    default:
      return ProtoViewType.TABLE;
  }
}

/**
 * Convert proto view type to frontend string
 */
function protoViewTypeToFrontend(type: ProtoViewType): string {
  switch (type) {
    case ProtoViewType.TABLE:
      return 'table';
    case ProtoViewType.BOARD:
      return 'board';
    case ProtoViewType.ROADMAP:
      return 'roadmap';
    default:
      return 'table';
  }
}

/**
 * Convert proto Project to frontend Project
 */
function protoProjectToFrontend(proto: ProtoProject): Project {
  return {
    id: proto.id,
    organizationId: proto.organizationId,
    ownerId: proto.ownerId,
    name: proto.name,
    description: proto.description,
    icon: proto.icon,
    color: proto.color,
    visibility: protoVisibilityToFrontend(proto.visibility) as Project['visibility'],
    fieldDefinitions: proto.fieldDefinitions.map(protoFieldDefinitionToFrontend),
    views: proto.views.map(protoViewConfigToFrontend),
    defaultViewId: proto.defaultViewId,
    memberIds: proto.memberIds,
    createdAt: proto.createdAt?.toDate().toISOString() || new Date().toISOString(),
    updatedAt: proto.updatedAt?.toDate().toISOString() || new Date().toISOString(),
    deletedAt: proto.deletedAt?.toDate().toISOString() || null,
    urn: proto.urn,
    userPermissionLevel: proto.userPermissionLevel,
    slug: proto.slug,
    typeFieldSchemas: Object.fromEntries(
      Object.entries(proto.typeFieldSchemas).map(([typeName, schema]) => [
        typeName,
        {
          shownFieldIds: [...schema.shownFieldIds],
          requiredFieldIds: [...schema.requiredFieldIds],
        },
      ])
    ),
  };
}

/**
 * Convert proto Task to frontend Task
 */
function protoTaskToFrontend(proto: ProtoTask): Task {
  // Parse field_values map - each value is a JSON-encoded string
  const fieldValues: Record<string, FieldValue> = {};
  Object.entries(proto.fieldValues).forEach(([key, jsonStr]) => {
    try {
      // Try parsing as JSON (for arrays/objects)
      fieldValues[key] = JSON.parse(jsonStr);
    } catch {
      // If it fails, it's a plain string
      fieldValues[key] = jsonStr;
    }
  });

  return {
    id: proto.id,
    projectId: proto.projectId,
    organizationId: proto.organizationId,
    ownerId: proto.ownerId,
    title: proto.title,
    description: proto.description,
    status: proto.status,
    priority: proto.priority,
    assigneeIds: proto.assigneeIds,
    startDate: proto.startDate || null,
    dueDate: proto.dueDate || null,
    completedAt: proto.completedAt?.toDate().toISOString() || null,
    parentId: proto.parentId || null,
    blockedByTaskIds: proto.blockedByTaskIds,
    isMilestone: proto.isMilestone,
    recurrenceRule: proto.recurrenceRule || null,
    sortOrder: proto.sortOrder,
    fieldValues,
    outgoingReferences: proto.outgoingReferences,
    createdAt: proto.createdAt?.toDate().toISOString() || new Date().toISOString(),
    updatedAt: proto.updatedAt?.toDate().toISOString() || new Date().toISOString(),
    deletedAt: proto.deletedAt?.toDate().toISOString() || null,
    urn: proto.urn,
    userPermissionLevel: proto.userPermissionLevel,
    number: proto.number,
    taskType: proto.taskType || "task",
    sprintId: proto.sprintId ?? null,
    subtaskTotal: proto.subtaskTotal,
    subtaskCompleted: proto.subtaskCompleted,
    estimatedMinutes: proto.estimatedMinutes ?? null,
    timeSpentMinutes: proto.timeSpentMinutes ?? null,
  };
}

/**
 * Convert proto FieldDefinition to frontend FieldDefinition
 */
function protoFieldDefinitionToFrontend(proto: ProtoFieldDefinition): FieldDefinition {
  // Parse config_json string to object
  let config: Record<string, unknown> = {};
  if (proto.configJson) {
    try {
      config = JSON.parse(proto.configJson);
    } catch {
      // Malformed JSON from server - fall back to empty config
    }
  }

  return {
    id: proto.id,
    projectId: proto.projectId,
    name: proto.name,
    type: protoFieldTypeToFrontend(proto.type) as FieldDefinition['type'],
    isRequired: proto.isRequired,
    isSystem: proto.isSystem,
    sortOrder: proto.sortOrder,
    config,
    createdAt: proto.createdAt?.toDate().toISOString() || new Date().toISOString(),
    updatedAt: proto.updatedAt?.toDate().toISOString() || new Date().toISOString(),
  };
}

/**
 * Convert proto ViewConfig to frontend ViewConfig
 */
function protoViewConfigToFrontend(proto: ProtoViewConfig): ViewConfig {
  // Parse config_json string to object
  let config: Record<string, unknown> = {};
  if (proto.configJson) {
    try {
      config = JSON.parse(proto.configJson);
    } catch {
      // Malformed JSON from server - fall back to empty config
    }
  }

  return {
    id: proto.id,
    projectId: proto.projectId,
    name: proto.name,
    type: protoViewTypeToFrontend(proto.type) as ViewConfig['type'],
    isDefault: proto.isDefault,
    config: config as unknown as ViewSpecificConfig,
    createdAt: proto.createdAt?.toDate().toISOString() || new Date().toISOString(),
    updatedAt: proto.updatedAt?.toDate().toISOString() || new Date().toISOString(),
  };
}

/**
 * Convert proto ActivityAction enum to frontend string
 */
function protoActivityActionToFrontend(action: ProtoActivityAction): ActivityAction {
  switch (action) {
    case ProtoActivityAction.CREATED:
      return 'created';
    case ProtoActivityAction.STATUS_CHANGED:
      return 'status_changed';
    case ProtoActivityAction.PRIORITY_CHANGED:
      return 'priority_changed';
    case ProtoActivityAction.FIELD_UPDATED:
      return 'field_updated';
    case ProtoActivityAction.BLOCKED_BY_ADDED:
      return 'blocked_by_added';
    case ProtoActivityAction.BLOCKED_BY_REMOVED:
      return 'blocked_by_removed';
    case ProtoActivityAction.ASSIGNED:
      return 'assigned';
    case ProtoActivityAction.TYPE_CHANGED:
      return 'type_changed';
    default:
      return 'created';
  }
}

/**
 * Convert proto TaskActivity to frontend TaskActivity
 */
function protoActivityToFrontend(proto: ProtoTaskActivity): TaskActivity {
  return {
    id: proto.id,
    taskId: proto.taskId,
    actorId: proto.actorId,
    action: protoActivityActionToFrontend(proto.action),
    timestamp: proto.timestamp?.toDate().toISOString() || new Date().toISOString(),
    fieldId: proto.fieldId,
    previousValue: proto.previousValue,
    newValue: proto.newValue,
  };
}

/**
 * Convert proto Sprint to frontend Sprint
 */
function protoSprintToFrontend(proto: ProtoSprint): Sprint {
  return {
    id: proto.id,
    projectId: proto.projectId,
    organizationId: proto.organizationId,
    name: proto.name,
    goal: proto.goal,
    status: proto.status as Sprint['status'],
    startDate: proto.startDate ?? null,
    endDate: proto.endDate ?? null,
    sortOrder: proto.sortOrder,
    taskCount: proto.taskCount,
    completedTaskCount: proto.completedTaskCount,
    createdAt: proto.createdAt?.toDate().toISOString() || new Date().toISOString(),
    updatedAt: proto.updatedAt?.toDate().toISOString() || new Date().toISOString(),
  };
}

/**
 * Convert frontend field values to proto map (JSON-encode complex values)
 */
function frontendFieldValuesToProto(fieldValues: Record<string, FieldValue>): Record<string, string> {
  const result: Record<string, string> = {};
  Object.entries(fieldValues).forEach(([key, value]) => {
    if (Array.isArray(value) || typeof value === 'object') {
      result[key] = JSON.stringify(value);
    } else {
      result[key] = String(value);
    }
  });
  return result;
}

/**
 * Projects API service with typed methods.
 */
export const projectsApi = {
  // ===== Projects =====

  /**
   * List all projects for the current organization
   */
  listProjects: async (organizationId: string): Promise<{ projects: Project[] }> => {
    const response = await projectsClient.listProjects({
      organizationId,
    });
    return {
      projects: response.projects.map(protoProjectToFrontend),
    };
  },

  /**
   * Get a single project by ID
   */
  getProject: async (id: string, organizationId: string): Promise<{ project: Project | null }> => {
    const response = await projectsClient.getProject({
      organizationId,
      projectId: id,
    });
    return {
      project: response.project ? protoProjectToFrontend(response.project) : null,
    };
  },

  /**
   * Create a new project
   */
  createProject: async (
    data: FrontendCreateProjectRequest,
    organizationId: string
  ): Promise<{ project: Project }> => {
    const response = await projectsClient.createProject({
      organizationId,
      name: data.name,
      description: data.description,
      icon: data.icon,
      color: data.color,
      visibility: data.visibility ? frontendVisibilityToProto(data.visibility) : ProtoVisibilityScope.PRIVATE,
      ...(data.slug ? { slug: data.slug } : {}),
    });
    return {
      project: protoProjectToFrontend(response.project!),
    };
  },

  /**
   * Update an existing project
   */
  updateProject: async (
    data: FrontendUpdateProjectRequest,
    organizationId: string
  ): Promise<{ project: Project }> => {
    // Convert type field schemas to proto format
    const typeFieldSchemas: Record<string, ProtoTypeFieldSchema> = {};
    if (data.typeFieldSchemas) {
      for (const [typeName, schema] of Object.entries(data.typeFieldSchemas)) {
        typeFieldSchemas[typeName] = new ProtoTypeFieldSchema({
          shownFieldIds: schema.shownFieldIds,
          requiredFieldIds: schema.requiredFieldIds,
        });
      }
    }

    const response = await projectsClient.updateProject({
      organizationId,
      projectId: data.id,
      name: data.name,
      description: data.description,
      icon: data.icon,
      color: data.color,
      visibility: data.visibility ? frontendVisibilityToProto(data.visibility) : undefined,
      ...(data.typeFieldSchemas ? { typeFieldSchemas } : {}),
    });
    return {
      project: protoProjectToFrontend(response.project!),
    };
  },

  /**
   * Delete a project (soft delete)
   */
  deleteProject: async (id: string, organizationId: string): Promise<{ success: boolean }> => {
    const response = await projectsClient.deleteProject({
      organizationId,
      projectId: id,
      permanent: false,
    });
    return {
      success: response.success,
    };
  },

  // ===== Tasks =====

  /**
   * List all tasks for a project
   */
  listTasks: async (projectId: string, organizationId: string): Promise<{ tasks: Task[] }> => {
    const response = await projectsClient.listTasks({
      organizationId,
      projectId,
    });
    return {
      tasks: response.tasks.map(protoTaskToFrontend),
    };
  },

  /**
   * Get a single task by ID
   */
  getTask: async (id: string, organizationId: string): Promise<{ task: Task | null }> => {
    const response = await projectsClient.getTask({
      organizationId,
      taskId: id,
    });
    return {
      task: response.task ? protoTaskToFrontend(response.task) : null,
    };
  },

  /**
   * Create a new task
   */
  createTask: async (
    data: FrontendCreateTaskRequest,
    organizationId: string
  ): Promise<{ task: Task; updatedParent?: Task }> => {
    const response = await projectsClient.createTask({
      organizationId,
      projectId: data.projectId,
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      assigneeIds: data.assigneeIds || [],
      startDate: data.startDate || undefined,
      dueDate: data.dueDate || undefined,
      fieldValues: data.fieldValues ? frontendFieldValuesToProto(data.fieldValues) : {},
      ...(data.taskType ? { taskType: data.taskType } : {}),
      ...(data.sprintId !== undefined ? { sprintId: data.sprintId ?? "" } : {}),
      ...(data.parentId !== undefined ? { parentId: data.parentId ?? "" } : {}),
      ...(data.blockedByTaskIds ? { blockedByTaskIds: data.blockedByTaskIds } : {}),
      ...(data.recurrenceRule !== undefined ? { recurrenceRule: data.recurrenceRule ?? "" } : {}),
    });
    return {
      task: protoTaskToFrontend(response.task!),
      updatedParent: response.updatedParent ? protoTaskToFrontend(response.updatedParent) : undefined,
    };
  },

  /**
   * Update an existing task
   */
  updateTask: async (
    data: FrontendUpdateTaskRequest,
    organizationId: string
  ): Promise<{ task: Task; updatedParent?: Task }> => {
    const response = await projectsClient.updateTask({
      organizationId,
      taskId: data.id,
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      assigneeIds: data.assigneeIds || [],
      startDate: data.startDate !== undefined ? (data.startDate ?? "") : undefined,
      dueDate: data.dueDate !== undefined ? (data.dueDate ?? "") : undefined,
      sortOrder: data.sortOrder,
      fieldValues: data.fieldValues ? frontendFieldValuesToProto(data.fieldValues) : {},
      ...(data.taskType !== undefined ? { taskType: data.taskType } : {}),
      ...(data.sprintId !== undefined ? { sprintId: data.sprintId ?? "" } : {}),
      ...(data.parentId !== undefined ? { parentId: data.parentId ?? "" } : {}),
      ...(data.blockedByTaskIds !== undefined ? { blockedByTaskIds: data.blockedByTaskIds } : {}),
      ...(data.estimatedMinutes !== undefined ? { estimatedMinutes: data.estimatedMinutes ?? 0 } : {}),
      ...(data.timeSpentMinutes !== undefined ? { timeSpentMinutes: data.timeSpentMinutes ?? 0 } : {}),
      ...(data.recurrenceRule !== undefined ? { recurrenceRule: data.recurrenceRule ?? "" } : {}),
    });
    return {
      task: protoTaskToFrontend(response.task!),
      updatedParent: response.updatedParent ? protoTaskToFrontend(response.updatedParent) : undefined,
    };
  },

  /**
   * Move a task to a different status/position
   * Optimized for drag-and-drop operations
   */
  moveTask: async (
    data: FrontendMoveTaskRequest,
    organizationId: string
  ): Promise<{ task: Task; updatedParent?: Task }> => {
    const response = await projectsClient.moveTask({
      organizationId,
      taskId: data.id,
      status: data.status,
      sortOrder: data.sortOrder,
    });
    return {
      task: protoTaskToFrontend(response.task!),
      updatedParent: response.updatedParent ? protoTaskToFrontend(response.updatedParent) : undefined,
    };
  },

  /**
   * Delete a task (soft delete)
   */
  deleteTask: async (id: string, organizationId: string): Promise<{ success: boolean }> => {
    const response = await projectsClient.deleteTask({
      organizationId,
      taskId: id,
      permanent: false,
    });
    return {
      success: response.success,
    };
  },

  /**
   * Delete multiple tasks (soft delete)
   */
  deleteTasks: async (taskIds: string[], organizationId: string): Promise<{ success: boolean; deletedCount: number }> => {
    const response = await projectsClient.deleteTasks({
      organizationId,
      taskIds,
      permanent: false,
    });
    return {
      success: response.success,
      deletedCount: response.deletedCount,
    };
  },

  /**
   * Bulk update tasks
   */
  bulkUpdateTasks: async (
    taskIds: string[],
    updates: { status?: string; priority?: string; assigneeIds?: string[]; sprintId?: string | null },
    organizationId: string
  ): Promise<{ tasks: Task[]; updatedCount: number }> => {
    const response = await projectsClient.bulkUpdateTasks({
      organizationId,
      taskIds,
      status: updates.status,
      priority: updates.priority,
      assigneeIds: updates.assigneeIds || [],
      sprintId: updates.sprintId ?? undefined,
    });
    return {
      tasks: response.tasks.map(protoTaskToFrontend),
      updatedCount: response.updatedCount,
    };
  },

  // ===== Fields =====

  /**
   * Add a custom field to a project
   */
  createField: async (
    projectId: string,
    field: Omit<FieldDefinition, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>,
    organizationId: string
  ): Promise<{ field: FieldDefinition }> => {
    const response = await projectsClient.createField({
      organizationId,
      projectId,
      name: field.name,
      type: frontendFieldTypeToProto(field.type),
      isRequired: field.isRequired,
      sortOrder: field.sortOrder,
      configJson: JSON.stringify(field.config),
    });
    return {
      field: protoFieldDefinitionToFrontend(response.field!),
    };
  },

  /**
   * Update a field definition
   */
  updateField: async (
    projectId: string,
    fieldId: string,
    updates: Partial<FieldDefinition>,
    organizationId: string
  ): Promise<{ field: FieldDefinition }> => {
    const response = await projectsClient.updateField({
      organizationId,
      projectId,
      fieldId,
      name: updates.name,
      isRequired: updates.isRequired,
      sortOrder: updates.sortOrder,
      configJson: updates.config ? JSON.stringify(updates.config) : undefined,
    });
    return {
      field: protoFieldDefinitionToFrontend(response.field!),
    };
  },

  /**
   * Delete a custom field
   */
  deleteField: async (
    projectId: string,
    fieldId: string,
    organizationId: string
  ): Promise<{ success: boolean }> => {
    const response = await projectsClient.deleteField({
      organizationId,
      projectId,
      fieldId,
    });
    return {
      success: response.success,
    };
  },

  // ===== Views =====

  /**
   * Create a new view for a project
   */
  createView: async (
    projectId: string,
    view: Omit<ViewConfig, 'id' | 'projectId' | 'createdAt' | 'updatedAt'>,
    organizationId: string
  ): Promise<{ view: ViewConfig }> => {
    const response = await projectsClient.createView({
      organizationId,
      projectId,
      name: view.name,
      type: frontendViewTypeToProto(view.type),
      isDefault: view.isDefault,
      configJson: JSON.stringify(view.config),
    });
    return {
      view: protoViewConfigToFrontend(response.view!),
    };
  },

  /**
   * Update a view configuration
   */
  updateView: async (
    projectId: string,
    viewId: string,
    updates: Partial<ViewConfig>,
    organizationId: string
  ): Promise<{ view: ViewConfig }> => {
    const response = await projectsClient.updateView({
      organizationId,
      projectId,
      viewId,
      name: updates.name,
      isDefault: updates.isDefault,
      configJson: updates.config ? JSON.stringify(updates.config) : undefined,
    });
    return {
      view: protoViewConfigToFrontend(response.view!),
    };
  },

  /**
   * Delete a view
   */
  deleteView: async (
    projectId: string,
    viewId: string,
    organizationId: string
  ): Promise<{ success: boolean }> => {
    const response = await projectsClient.deleteView({
      organizationId,
      projectId,
      viewId,
    });
    return {
      success: response.success,
    };
  },

  // ===== Activities =====

  /**
   * List activities for a task
   */
  listActivities: async (
    taskId: string,
    organizationId: string
  ): Promise<{ activities: TaskActivity[] }> => {
    const response = await projectsClient.listActivities({
      organizationId,
      taskId,
    });
    return {
      activities: response.activities.map(protoActivityToFrontend),
    };
  },

  // ===== Users =====

  /**
   * Get project members for person field.
   * Returns empty array until a dedicated endpoint is implemented.
   */
  getProjectMembers: async (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _projectId: string
  ): Promise<{ members: Array<{ id: string; name: string; initials: string; color: string }> }> => {
    return { members: [] };
  },

  // ===== Sprints =====

  listSprints: async (projectId: string, organizationId: string): Promise<{ sprints: Sprint[] }> => {
    const response = await projectsClient.listSprints({
      organizationId,
      projectId,
      includeClosed: true,
    });
    return { sprints: response.sprints.map(protoSprintToFrontend) };
  },

  createSprint: async (
    data: FrontendCreateSprintRequest,
    organizationId: string
  ): Promise<{ sprint: Sprint }> => {
    const response = await projectsClient.createSprint({
      organizationId,
      projectId: data.projectId,
      name: data.name,
      goal: data.goal,
      startDate: data.startDate ?? undefined,
      endDate: data.endDate ?? undefined,
    });
    return { sprint: protoSprintToFrontend(response.sprint!) };
  },

  updateSprint: async (
    data: FrontendUpdateSprintRequest,
    organizationId: string
  ): Promise<{ sprint: Sprint }> => {
    const response = await projectsClient.updateSprint({
      organizationId,
      sprintId: data.id,
      name: data.name,
      goal: data.goal,
      startDate: data.startDate ?? undefined,
      endDate: data.endDate ?? undefined,
    });
    return { sprint: protoSprintToFrontend(response.sprint!) };
  },

  startSprint: async (
    data: FrontendStartSprintRequest,
    organizationId: string
  ): Promise<{ sprint: Sprint }> => {
    const response = await projectsClient.startSprint({
      organizationId,
      sprintId: data.id,
      startDate: data.startDate ?? undefined,
      endDate: data.endDate ?? undefined,
    });
    return { sprint: protoSprintToFrontend(response.sprint!) };
  },

  completeSprint: async (sprintId: string, organizationId: string): Promise<{ sprint: Sprint }> => {
    const response = await projectsClient.completeSprint({
      organizationId,
      sprintId,
    });
    return { sprint: protoSprintToFrontend(response.sprint!) };
  },

  deleteSprint: async (sprintId: string, organizationId: string): Promise<{ success: boolean }> => {
    const response = await projectsClient.deleteSprint({
      organizationId,
      sprintId,
    });
    return { success: response.success };
  },

  // ===== Task Watchers =====

  toggleTaskWatcher: async (taskId: string, organizationId: string) => {
    const response = await projectsClient.toggleTaskWatcher({
      organizationId,
      taskId,
    });
    return { isWatching: response.isWatching };
  },

  listTaskWatchers: async (taskId: string, organizationId: string) => {
    const response = await projectsClient.listTaskWatchers({
      organizationId,
      taskId,
    });
    return {
      watcherUserIds: response.watcherUserIds,
      watcherCount: response.watcherCount,
    };
  },

  bulkCheckTaskWatchers: async (taskIds: string[], organizationId: string) => {
    const response = await projectsClient.bulkCheckTaskWatchers({
      organizationId,
      taskIds,
    });
    return { watchedTasks: Object.fromEntries(Object.entries(response.watchedTasks)) };
  },
};
