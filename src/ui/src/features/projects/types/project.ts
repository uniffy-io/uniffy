import type { FieldDefinition, FieldValue } from "./fields";
import type { ViewConfig } from "./views";

export interface Sprint {
  id: string;
  projectId: string;
  organizationId: string;
  name: string;
  goal: string;
  status: "planned" | "active" | "closed";
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
  taskCount: number;
  completedTaskCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSprintRequest {
  projectId: string;
  name: string;
  goal?: string;
  startDate?: string | null;
  endDate?: string | null;
}

export interface UpdateSprintRequest {
  id: string;
  name?: string;
  goal?: string;
  startDate?: string | null;
  endDate?: string | null;
}

export interface StartSprintRequest {
  id: string;
  startDate?: string | null;
  endDate?: string | null;
}

export interface TypeFieldSchema {
  shownFieldIds: string[];
  requiredFieldIds: string[];
}

export interface Project {
  id: string;
  organizationId: string;
  ownerId: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  accessMode: number;
  baselineRole: number | null;
  userRole: number;
  fieldDefinitions: FieldDefinition[];
  views: ViewConfig[];
  defaultViewId: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  urn: string;
  slug: string;
  typeFieldSchemas: Record<string, TypeFieldSchema>;
  tagIds: string[];
  /** Server rollups over live top-level tasks - lets a project list render progress without its tasks. */
  taskCount: number;
  completedTaskCount: number;
  /** Explicit `ContentMember` grants; excludes the owner and org-baseline access. */
  memberCount: number;
  /** Portfolio rollups over EVERY live task, subtasks included - unlike the two counts above. */
  overdueTaskCount: number;
  estimatedMinutes: number;
  spentMinutes: number;
}

export interface Task {
  id: string;
  projectId: string;
  organizationId: string;
  ownerId: string;
  title: string;
  /** Markdown body with [[[label|urn]]] mentions. */
  description: string;
  status: string;
  priority: string;
  assigneeIds: string[];
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  parentId: string | null;
  blockedByTaskIds: string[];
  isMilestone: boolean;
  /** RRULE string for recurring tasks. */
  recurrenceRule: string | null;
  sortOrder: number;
  fieldValues: Record<string, FieldValue>;
  /** URNs parsed out of `description`. */
  outgoingReferences: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  urn: string;
  userRole: number;
  number: number;
  taskType: string;
  sprintId: string | null;
  subtaskTotal: number;
  subtaskCompleted: number;
  estimatedMinutes: number | null;
  timeSpentMinutes: number | null;
  tagIds: string[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  icon: string;
  color: string;
  taskCount: number;
  memberCount: number;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  accessMode?: number;
  baselineRole?: number | null;
  slug?: string;
  tagIds?: string[];
}

export interface UpdateProjectRequest {
  id: string;
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  slug?: string;
  typeFieldSchemas?: Record<string, TypeFieldSchema>;
  tagIds?: string[];
}

export interface CreateTaskRequest {
  projectId: string;
  title: string;
  description?: string;
  status?: string;
  priority?: string;
  assigneeIds?: string[];
  startDate?: string | null;
  dueDate?: string | null;
  fieldValues?: Record<string, FieldValue>;
  taskType?: string;
  sprintId?: string | null;
  parentId?: string | null;
  blockedByTaskIds?: string[];
  estimatedMinutes?: number | null;
  timeSpentMinutes?: number | null;
  recurrenceRule?: string | null;
  tagIds?: string[];
}

export interface UpdateTaskRequest {
  id: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  assigneeIds?: string[];
  startDate?: string | null;
  dueDate?: string | null;
  fieldValues?: Record<string, FieldValue>;
  sortOrder?: number;
  taskType?: string;
  sprintId?: string | null;
  parentId?: string | null;
  blockedByTaskIds?: string[];
  estimatedMinutes?: number | null;
  timeSpentMinutes?: number | null;
  recurrenceRule?: string | null;
  tagIds?: string[];
}

export interface MoveTaskRequest {
  id: string;
  status: string;
  sortOrder: number;
}
