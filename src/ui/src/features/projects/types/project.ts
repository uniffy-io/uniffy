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
  timeSpentMinutes: number;
  /** New tasks are picked up by this agent, working as each task's creator. */
  agentAssigneeId?: string | null;
  agentAssigneeSetById?: string | null;
}

export type TaskAgentRunStatus =
  | "waiting"
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "stopped"
  | "skipped"
  | "uncertain";

export interface TaskAgentAssignment {
  id: string;
  agentId: string;
  agentName: string;
  agentAvatarEmoji: string | null;
  agentIsDeleted: boolean;
  /** The run works with this person's permissions; only they get the session and run ids. */
  assignedById: string;
  status: TaskAgentRunStatus;
  reason: "task" | "project";
  sessionId: string | null;
  runId: string | null;
  createdAt: string;
  endedAt: string | null;
  /** Set while a pending run waits for the time it was scheduled for. */
  startAt: string | null;
}

/** When a newly assigned agent starts: now, when someone presses Start, or at a time. */
export type AgentRunStart = { kind: "now" } | { kind: "wait" } | { kind: "at"; at: Date };

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
  agentAssignment?: TaskAgentAssignment | null;
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
  /** A shared view of this project; an empty string clears the default. */
  defaultViewId?: string;
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
  recurrenceRule?: string | null;
  tagIds?: string[];
  /** Hand the new task to this agent instead of the project's agent assignee. */
  agentId?: string | null;
  /** Keep the new task away from the project's agent assignee. */
  skipProjectAgent?: boolean;
}

export interface UpdateTaskRequest {
  id: string;
  title?: string;
  description?: string;
  baseDescription?: string;
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
  recurrenceRule?: string | null;
  tagIds?: string[];
}

export interface MoveTaskRequest {
  id: string;
  status: string;
  sortOrder: number;
}
