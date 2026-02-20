import type { FieldDefinition, FieldValue } from "./fields";
import type { ViewConfig } from "./views";

/**
 * Visibility scope for projects (matches existing pattern)
 */
export type VisibilityScope = "PRIVATE" | "GROUP" | "ORGANIZATION" | "PUBLIC";

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
  visibility: VisibilityScope;
  fieldDefinitions: FieldDefinition[];
  views: ViewConfig[];
  defaultViewId: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  urn: string;
  userPermissionLevel: number;
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
  userPermissionLevel: number;
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
  visibility?: VisibilityScope;
}

export interface UpdateProjectRequest {
  id: string;
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  visibility?: VisibilityScope;
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
}

export interface MoveTaskRequest {
  id: string;
  status: string;
  sortOrder: number;
}
