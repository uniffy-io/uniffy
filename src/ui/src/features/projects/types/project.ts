import type { FieldDefinition, FieldValue } from "./fields";
import type { ViewConfig } from "./views";

/**
 * A sprint is a time-boxed iteration for completing tasks
 */
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

/**
 * Per-type field schema defining which fields are shown and required
 */
export interface TypeFieldSchema {
  shownFieldIds: string[];
  requiredFieldIds: string[];
}

/**
 * A project is a container for tasks with custom field definitions
 */
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
}

/**
 * A task is an individual work item within a project
 */
export interface Task {
  id: string;
  projectId: string;
  organizationId: string;
  ownerId: string;
  title: string;
  description: string; // Markdown with URN mentions [[[label|urn]]]
  status: string; // References field option ID
  priority: string; // References field option ID
  assigneeIds: string[];
  startDate: string | null;
  dueDate: string | null;
  completedAt: string | null;
  
  // -- V2 Features --
  parentId: string | null; // Subtasks (Feature 7)
  blockedByTaskIds: string[]; // Dependencies (Feature 6)
  isMilestone: boolean; // Milestones (Feature 15)
  recurrenceRule: string | null; // Recurring (Feature 9) - RRULE format
  
  sortOrder: number;
  fieldValues: Record<string, FieldValue>;
  outgoingReferences: string[]; // URNs extracted from description
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
}

/**
 * Lightweight project reference for lists
 */
export interface ProjectSummary {
  id: string;
  name: string;
  icon: string;
  color: string;
  taskCount: number;
  memberCount: number;
}

/**
 * Request types for API operations
 */
export interface CreateProjectRequest {
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  accessMode?: number;
  baselineRole?: number | null;
  slug?: string;
}

export interface UpdateProjectRequest {
  id: string;
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  slug?: string;
  typeFieldSchemas?: Record<string, TypeFieldSchema>;
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
}

export interface MoveTaskRequest {
  id: string;
  status: string;
  sortOrder: number;
}
