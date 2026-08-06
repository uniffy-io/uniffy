import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import { create } from '@bufbuild/protobuf';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import { ProjectsService, TypeFieldSchemaSchema } from '@uniffy/proto/projects/v1/projects_pb';
import {
  FieldType as ProtoFieldType,
  ViewType as ProtoViewType,
  ActivityAction as ProtoActivityAction,
  TagFilterMode as ProtoTagFilterMode,
} from '@uniffy/proto/projects/v1/projects_pb';
import type { TypeFieldSchema as ProtoTypeFieldSchema } from '@uniffy/proto/projects/v1/projects_pb';
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

const projectsClient = createClient(ProjectsService, unaryTransport);

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

function protoProjectToFrontend(proto: ProtoProject): Project {
  return {
    id: proto.id,
    organizationId: proto.organizationId,
    ownerId: proto.ownerId,
    name: proto.name,
    description: proto.description,
    icon: proto.icon,
    color: proto.color,
    accessMode: proto.accessMode,
    baselineRole: proto.baselineRole ?? null,
    userRole: proto.userRole,
    fieldDefinitions: proto.fieldDefinitions.map(protoFieldDefinitionToFrontend),
    views: proto.views.map(protoViewConfigToFrontend),
    defaultViewId: proto.defaultViewId,
    createdAt: (proto.createdAt ? timestampDate(proto.createdAt).toISOString() : new Date().toISOString()),
    updatedAt: (proto.updatedAt ? timestampDate(proto.updatedAt).toISOString() : new Date().toISOString()),
    deletedAt: (proto.deletedAt ? timestampDate(proto.deletedAt).toISOString() : null),
    urn: proto.urn,
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
    tagIds: proto.tags.map((t) => t.id),
    taskCount: proto.taskCount,
    completedTaskCount: proto.completedTaskCount,
    memberCount: proto.memberCount,
    overdueTaskCount: proto.overdueTaskCount,
    estimatedMinutes: proto.estimatedMinutes,
    timeSpentMinutes: proto.timeSpentMinutes,
  };
}

function protoTaskToFrontend(proto: ProtoTask): Task {
  const fieldValues: Record<string, FieldValue> = {};
  Object.entries(proto.fieldValues).forEach(([key, jsonStr]) => {
    try {
      fieldValues[key] = JSON.parse(jsonStr);
    } catch {
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
    completedAt: proto.completedAt ? timestampDate(proto.completedAt).toISOString() : null,
    parentId: proto.parentId || null,
    blockedByTaskIds: proto.blockedByTaskIds,
    isMilestone: proto.isMilestone,
    recurrenceRule: proto.recurrenceRule || null,
    sortOrder: proto.sortOrder,
    fieldValues,
    outgoingReferences: proto.outgoingReferences,
    createdAt: (proto.createdAt ? timestampDate(proto.createdAt).toISOString() : new Date().toISOString()),
    updatedAt: (proto.updatedAt ? timestampDate(proto.updatedAt).toISOString() : new Date().toISOString()),
    deletedAt: (proto.deletedAt ? timestampDate(proto.deletedAt).toISOString() : null),
    urn: proto.urn,
    userRole: proto.userRole,
    number: proto.number,
    taskType: proto.taskType || "task",
    sprintId: proto.sprintId ?? null,
    subtaskTotal: proto.subtaskTotal,
    subtaskCompleted: proto.subtaskCompleted,
    estimatedMinutes: proto.estimatedMinutes ?? null,
    timeSpentMinutes: proto.timeSpentMinutes ?? null,
    tagIds: proto.tags.map((t) => t.id),
  };
}

function protoFieldDefinitionToFrontend(proto: ProtoFieldDefinition): FieldDefinition {
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
    createdAt: (proto.createdAt ? timestampDate(proto.createdAt).toISOString() : new Date().toISOString()),
    updatedAt: (proto.updatedAt ? timestampDate(proto.updatedAt).toISOString() : new Date().toISOString()),
  };
}

function protoViewConfigToFrontend(proto: ProtoViewConfig): ViewConfig {
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
    createdAt: (proto.createdAt ? timestampDate(proto.createdAt).toISOString() : new Date().toISOString()),
    updatedAt: (proto.updatedAt ? timestampDate(proto.updatedAt).toISOString() : new Date().toISOString()),
  };
}

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

function protoActivityToFrontend(proto: ProtoTaskActivity): TaskActivity {
  return {
    id: proto.id,
    taskId: proto.taskId,
    actorId: proto.actorId,
    action: protoActivityActionToFrontend(proto.action),
    timestamp: proto.timestamp ? timestampDate(proto.timestamp).toISOString() : new Date().toISOString(),
    fieldId: proto.fieldId,
    previousValue: proto.previousValue,
    newValue: proto.newValue,
  };
}

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
    createdAt: (proto.createdAt ? timestampDate(proto.createdAt).toISOString() : new Date().toISOString()),
    updatedAt: (proto.updatedAt ? timestampDate(proto.updatedAt).toISOString() : new Date().toISOString()),
  };
}

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

export const projectsApi = {
  listProjects: async (
    organizationId: string,
  ): Promise<{ projects: Project[]; protoProjects: ProtoProject[] }> => {
    const response = await projectsClient.listProjects({
      organizationId,
    });
    return {
      projects: response.projects.map(protoProjectToFrontend),
      protoProjects: response.projects,
    };
  },

  getProject: async (
    id: string,
    organizationId: string,
  ): Promise<{ project: Project | null; protoProject: ProtoProject | null }> => {
    const response = await projectsClient.getProject({
      organizationId,
      projectId: id,
    });
    return {
      project: response.project ? protoProjectToFrontend(response.project) : null,
      protoProject: response.project ?? null,
    };
  },

  createProject: async (
    data: FrontendCreateProjectRequest,
    organizationId: string
  ): Promise<{ project: Project; protoProject: ProtoProject }> => {
    const response = await projectsClient.createProject({
      organizationId,
      name: data.name,
      description: data.description,
      icon: data.icon,
      color: data.color,
      ...(data.accessMode !== undefined ? { accessMode: data.accessMode } : {}),
      ...(data.baselineRole !== undefined && data.baselineRole !== null ? { baselineRole: data.baselineRole } : {}),
      ...(data.slug ? { slug: data.slug } : {}),
      ...(data.tagIds ? { tagIds: data.tagIds } : {}),
    });
    return {
      project: protoProjectToFrontend(response.project!),
      protoProject: response.project!,
    };
  },

  updateProject: async (
    data: FrontendUpdateProjectRequest,
    organizationId: string
  ): Promise<{ project: Project; protoProject: ProtoProject }> => {
    const typeFieldSchemas: Record<string, ProtoTypeFieldSchema> = {};
    if (data.typeFieldSchemas) {
      for (const [typeName, schema] of Object.entries(data.typeFieldSchemas)) {
        typeFieldSchemas[typeName] = create(TypeFieldSchemaSchema, {
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
      ...(data.typeFieldSchemas ? { typeFieldSchemas } : {}),
      ...(data.tagIds !== undefined ? { tagIds: { ids: data.tagIds } } : {}),
    });
    return {
      project: protoProjectToFrontend(response.project!),
      protoProject: response.project!,
    };
  },

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

  listTasks: async (
    projectId: string,
    organizationId: string,
    options: {
      tagIds?: string[];
      tagFilterMode?: 'all' | 'any' | 'none';
      inEpicId?: string;
      rootOnly?: boolean;
      hasSubtasks?: boolean;
      minDepth?: number;
      maxDepth?: number;
    } = {},
  ): Promise<{ tasks: Task[]; protoTasks: ProtoTask[] }> => {
    const tagFilterMode =
      options.tagFilterMode === 'any'
        ? ProtoTagFilterMode.ANY
        : options.tagFilterMode === 'none'
          ? ProtoTagFilterMode.NONE
          : ProtoTagFilterMode.ALL;
    const response = await projectsClient.listTasks({
      organizationId,
      projectId,
      ...(options.tagIds && options.tagIds.length
        ? { tagIds: options.tagIds, tagFilterMode }
        : {}),
      ...(options.inEpicId ? { inEpicId: options.inEpicId } : {}),
      ...(options.rootOnly ? { rootOnly: true } : {}),
      ...(options.hasSubtasks !== undefined ? { hasSubtasks: options.hasSubtasks } : {}),
      ...(options.minDepth !== undefined ? { minDepth: options.minDepth } : {}),
      ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
    });
    return {
      tasks: response.tasks.map(protoTaskToFrontend),
      protoTasks: response.tasks,
    };
  },

  getTask: async (
    id: string,
    organizationId: string,
  ): Promise<{ task: Task | null; protoTask: ProtoTask | null }> => {
    const response = await projectsClient.getTask({
      organizationId,
      taskId: id,
    });
    return {
      task: response.task ? protoTaskToFrontend(response.task) : null,
      protoTask: response.task ?? null,
    };
  },

  createTask: async (
    data: FrontendCreateTaskRequest,
    organizationId: string
  ): Promise<{
    task: Task;
    updatedParent?: Task;
    protoTask: ProtoTask;
    protoUpdatedParent?: ProtoTask;
  }> => {
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
      ...(data.tagIds ? { tagIds: data.tagIds } : {}),
    });
    return {
      task: protoTaskToFrontend(response.task!),
      updatedParent: response.updatedParent ? protoTaskToFrontend(response.updatedParent) : undefined,
      protoTask: response.task!,
      protoUpdatedParent: response.updatedParent,
    };
  },

  updateTask: async (
    data: FrontendUpdateTaskRequest,
    organizationId: string
  ): Promise<{
    task: Task;
    updatedParent?: Task;
    spawnedTask?: Task;
    protoTask: ProtoTask;
    protoUpdatedParent?: ProtoTask;
    protoSpawnedTask?: ProtoTask;
  }> => {
    const response = await projectsClient.updateTask({
      organizationId,
      taskId: data.id,
      title: data.title,
      description: data.description,
      status: data.status,
      priority: data.priority,
      ...(data.assigneeIds !== undefined ? { assigneeIds: { ids: data.assigneeIds } } : {}),
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
      ...(data.tagIds !== undefined ? { tagIds: { ids: data.tagIds } } : {}),
    });
    return {
      task: protoTaskToFrontend(response.task!),
      updatedParent: response.updatedParent ? protoTaskToFrontend(response.updatedParent) : undefined,
      spawnedTask: response.spawnedTask ? protoTaskToFrontend(response.spawnedTask) : undefined,
      protoTask: response.task!,
      protoUpdatedParent: response.updatedParent,
      protoSpawnedTask: response.spawnedTask,
    };
  },

  /** Optimized path for drag-and-drop reorder. */
  moveTask: async (
    data: FrontendMoveTaskRequest,
    organizationId: string
  ): Promise<{
    task: Task;
    updatedParent?: Task;
    spawnedTask?: Task;
    protoTask: ProtoTask;
    protoUpdatedParent?: ProtoTask;
    protoSpawnedTask?: ProtoTask;
  }> => {
    const response = await projectsClient.moveTask({
      organizationId,
      taskId: data.id,
      status: data.status,
      sortOrder: data.sortOrder,
    });
    return {
      task: protoTaskToFrontend(response.task!),
      updatedParent: response.updatedParent ? protoTaskToFrontend(response.updatedParent) : undefined,
      spawnedTask: response.spawnedTask ? protoTaskToFrontend(response.spawnedTask) : undefined,
      protoTask: response.task!,
      protoUpdatedParent: response.updatedParent,
      protoSpawnedTask: response.spawnedTask,
    };
  },

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

  bulkUpdateTasks: async (
    taskIds: string[],
    updates: { status?: string; priority?: string; assigneeIds?: string[]; sprintId?: string | null },
    organizationId: string
  ): Promise<{ tasks: Task[]; updatedCount: number; protoTasks: ProtoTask[] }> => {
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
      protoTasks: response.tasks,
    };
  },

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

  /** Stubbed until a dedicated members endpoint exists. */
  getProjectMembers: async (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _projectId: string
  ): Promise<{ members: Array<{ id: string; name: string; initials: string; color: string }> }> => {
    return { members: [] };
  },

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
