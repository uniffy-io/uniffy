import type {
  Project,
  Task,
  TaskActivity,
  FieldDefinition,
  Sprint,
} from "@uniffy/proto/projects/v1/projects_pb";
import { ActivityAction } from "@uniffy/proto/projects/v1/projects_pb";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";
import type { ThemeColors } from "@theme/theme";

/** The stage a status stands for; the server decides completion from it, never from the id. */
export type TaskStatusSemantic = "todo" | "in_progress" | "review" | "completed";

const STATUS_SEMANTICS: ReadonlySet<string> = new Set<TaskStatusSemantic>([
  "todo",
  "in_progress",
  "review",
  "completed",
]);

export function isTaskStatusSemantic(value: unknown): value is TaskStatusSemantic {
  return typeof value === "string" && STATUS_SEMANTICS.has(value);
}

export interface PlainSelectOption {
  id: string;
  label: string;
  color: string;
  sortOrder: number;
  /** Set on status options only. */
  semantic?: TaskStatusSemantic;
}

export interface SerializedFieldDefinition {
  id: string;
  name: string;
  options: PlainSelectOption[];
  /** Kept raw so an edit to `options` can preserve any other config keys. */
  configJson: string;
}

export interface SerializedProject {
  id: string;
  organizationId: string;
  ownerId: string;
  urn: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  accessMode: number;
  baselineRole?: number;
  userRole: number;
  visibility: "PRIVATE" | "ORGANIZATION";
  taskCount: number;
  completedTaskCount: number;
  memberCount: number;
  overdueTaskCount: number;
  estimatedMinutes: number;
  timeSpentMinutes: number;
  fieldDefinitions: SerializedFieldDefinition[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SerializedTask {
  id: string;
  projectId: string;
  organizationId: string;
  ownerId: string;
  urn: string;
  number: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  startDate: string | null;
  dueDate: string | null;
  completedAt?: string;
  assigneeIds: string[];
  blockedByTaskIds: string[];
  parentId?: string;
  sortOrder: number;
  taskType: string;
  sprintId?: string;
  isMilestone: boolean;
  subtaskTotal: number;
  subtaskCompleted: number;
  estimatedMinutes?: number;
  timeSpentMinutes?: number;
  recurrenceRule?: string;
  userRole: number;
  outgoingReferences: string[];
  fieldValues: { [key: string]: string };
  tags: SerializedTaskTag[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SerializedTaskTag {
  id: string;
  name: string;
  color: string;
}

export interface SerializedSprint {
  id: string;
  projectId: string;
  name: string;
  goal: string;
  status: "planned" | "active" | "closed";
  startDate: string | null;
  endDate: string | null;
  sortOrder: number;
  taskCount: number;
  completedTaskCount: number;
}

export interface SerializedActivity {
  id: string;
  taskId: string;
  actorId: string;
  action: string;
  timestamp?: string;
  fieldId?: string;
  previousValue?: string;
  newValue?: string;
}

export interface ProjectStats {
  total: number;
  done: number;
  inProgress: number;
  progress: number;
}

export const STATUS_FIELD_ID = "field_status";
const PRIORITY_FIELD_ID = "field_priority";

const DEFAULT_STATUS_OPTIONS: PlainSelectOption[] = [
  { id: "status_todo", label: "To Do", color: "#6b7280", sortOrder: 0, semantic: "todo" },
  {
    id: "status_in_progress",
    label: "In Progress",
    color: "#3b82f6",
    sortOrder: 1,
    semantic: "in_progress",
  },
  { id: "status_done", label: "Done", color: "#22c55e", sortOrder: 2, semantic: "completed" },
];

const DEFAULT_PRIORITY_OPTIONS: PlainSelectOption[] = [
  { id: "priority_low", label: "Low", color: "#22c55e", sortOrder: 0 },
  { id: "priority_medium", label: "Medium", color: "#f59e0b", sortOrder: 1 },
  { id: "priority_high", label: "High", color: "#ef4444", sortOrder: 2 },
  { id: "priority_urgent", label: "Urgent", color: "#dc2626", sortOrder: 3 },
];

const ACTIVITY_LABELS: Record<string, string> = {
  CREATED: "created this task",
  STATUS_CHANGED: "changed status",
  PRIORITY_CHANGED: "changed priority",
  FIELD_UPDATED: "updated a field",
  BLOCKED_BY_ADDED: "added a blocker",
  BLOCKED_BY_REMOVED: "removed a blocker",
  ASSIGNED: "changed assignees",
  TYPE_CHANGED: "changed the type",
  SPRINT_CHANGED: "changed the sprint",
};

export function activityActionLabel(action: string): string {
  return ACTIVITY_LABELS[action] ?? "made a change";
}

function tsToIso(ts?: { seconds: bigint; nanos: number }): string | undefined {
  if (!ts) return undefined;
  return new Date(Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1e6)).toISOString();
}

function parseConfig(configJson: string): Record<string, unknown> {
  if (!configJson) return {};
  try {
    const parsed = JSON.parse(configJson);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
  } catch {
    // Malformed config from server - treat as empty
  }
  return {};
}

type StoredOption = Record<string, unknown> & { id: unknown };

function storedOptions(config: Record<string, unknown>): StoredOption[] {
  if (!Array.isArray(config.options)) return [];
  return config.options.filter((o): o is StoredOption => !!o && typeof o === "object" && "id" in o);
}

function fieldDefinitionToPlain(field: FieldDefinition): SerializedFieldDefinition {
  const options = storedOptions(parseConfig(field.configJson)).map((o) => {
    const option: PlainSelectOption = {
      id: String(o.id),
      label: String(o.label ?? o.id),
      color: String(o.color ?? "#909296"),
      sortOrder: Number(o.sortOrder ?? 0),
    };
    if (isTaskStatusSemantic(o.semantic)) option.semantic = o.semantic;
    return option;
  });
  return { id: field.id, name: field.name, options, configJson: field.configJson };
}

/**
 * Replaces the `options` key and keeps every other stored key, including per-option keys this
 * client does not model, so an edit never drops what the server saved.
 */
export function buildFieldConfigJson(
  field: SerializedFieldDefinition,
  options: PlainSelectOption[],
): string {
  const config = parseConfig(field.configJson);
  const storedById = new Map(storedOptions(config).map((o) => [String(o.id), o]));
  return JSON.stringify({
    ...config,
    options: options.map((o) => ({ ...storedById.get(o.id), ...o })),
  });
}

export function projectToPlain(project: Project): SerializedProject {
  return {
    id: project.id,
    organizationId: project.organizationId,
    ownerId: project.ownerId,
    urn: project.urn,
    slug: project.slug,
    name: project.name,
    description: project.description,
    icon: project.icon,
    color: project.color,
    accessMode: project.accessMode,
    baselineRole: project.baselineRole,
    userRole: project.userRole,
    visibility: project.accessMode === AccessMode.OPEN_TO_ORG ? "ORGANIZATION" : "PRIVATE",
    taskCount: project.taskCount,
    completedTaskCount: project.completedTaskCount,
    memberCount: project.memberCount,
    overdueTaskCount: project.overdueTaskCount,
    estimatedMinutes: project.estimatedMinutes,
    timeSpentMinutes: project.timeSpentMinutes,
    fieldDefinitions: project.fieldDefinitions.map(fieldDefinitionToPlain),
    createdAt: tsToIso(project.createdAt),
    updatedAt: tsToIso(project.updatedAt),
  };
}

export function taskToPlain(task: Task): SerializedTask {
  return {
    id: task.id,
    projectId: task.projectId,
    organizationId: task.organizationId,
    ownerId: task.ownerId,
    urn: task.urn,
    number: task.number,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    startDate: task.startDate ?? null,
    dueDate: task.dueDate ?? null,
    completedAt: tsToIso(task.completedAt),
    assigneeIds: task.assigneeIds,
    blockedByTaskIds: task.blockedByTaskIds,
    parentId: task.parentId,
    sortOrder: task.sortOrder,
    taskType: task.taskType,
    sprintId: task.sprintId,
    isMilestone: task.isMilestone,
    subtaskTotal: task.subtaskTotal,
    subtaskCompleted: task.subtaskCompleted,
    estimatedMinutes: task.estimatedMinutes,
    timeSpentMinutes: task.timeSpentMinutes,
    recurrenceRule: task.recurrenceRule,
    userRole: task.userRole,
    outgoingReferences: task.outgoingReferences,
    fieldValues: task.fieldValues,
    tags: task.tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
    createdAt: tsToIso(task.createdAt),
    updatedAt: tsToIso(task.updatedAt),
  };
}

export function sprintToPlain(sprint: Sprint): SerializedSprint {
  return {
    id: sprint.id,
    projectId: sprint.projectId,
    name: sprint.name,
    goal: sprint.goal,
    status: (sprint.status as SerializedSprint["status"]) || "planned",
    startDate: sprint.startDate ?? null,
    endDate: sprint.endDate ?? null,
    sortOrder: sprint.sortOrder,
    taskCount: sprint.taskCount,
    completedTaskCount: sprint.completedTaskCount,
  };
}

export function activityToPlain(activity: TaskActivity): SerializedActivity {
  return {
    id: activity.id,
    taskId: activity.taskId,
    actorId: activity.actorId,
    action: ActivityAction[activity.action] ?? "UNKNOWN",
    timestamp: tsToIso(activity.timestamp),
    fieldId: activity.fieldId,
    previousValue: activity.previousValue,
    newValue: activity.newValue,
  };
}

function statsFrom(total: number, done: number): ProjectStats {
  return {
    total,
    done,
    inProgress: total - done,
    progress: total === 0 ? 0 : Math.round((done / total) * 100),
  };
}

/**
 * Rollups the server already counted - the list screen renders progress for
 * every project without fetching each one's task list.
 */
export function projectStats(project: SerializedProject): ProjectStats {
  return statsFrom(project.taskCount, project.completedTaskCount);
}

export type ProjectHealth = "not_started" | "on_track" | "at_risk" | "behind";

export const PROJECT_HEALTH_LABELS: Record<ProjectHealth, string> = {
  not_started: "Not Started",
  on_track: "On Track",
  at_risk: "At Risk",
  behind: "Behind",
};

/** Same rules and thresholds as web's PortfolioPage, so a project reads the
 *  same on both clients. */
export function projectHealth(project: SerializedProject): ProjectHealth {
  const { taskCount, completedTaskCount, overdueTaskCount, estimatedMinutes, timeSpentMinutes } =
    project;
  if (taskCount === 0) return "not_started";
  if (completedTaskCount === 0 && overdueTaskCount === 0) return "not_started";
  if (overdueTaskCount >= 3) return "behind";
  if (estimatedMinutes > 0 && timeSpentMinutes > estimatedMinutes) return "behind";
  if (overdueTaskCount >= 1) return "at_risk";
  if (estimatedMinutes > 0 && timeSpentMinutes > estimatedMinutes * 0.8) return "at_risk";
  return "on_track";
}

/** Same shape from a loaded task list, so an open project stays live as tasks change. */
export function computeProjectStats(tasks: SerializedTask[]): ProjectStats {
  const top = tasks.filter((t) => !t.parentId);
  return statsFrom(top.length, top.filter((t) => !!t.completedAt).length);
}

function fieldOptions(
  project: SerializedProject | undefined,
  fieldId: string,
  fallback: PlainSelectOption[],
): PlainSelectOption[] {
  const field = project?.fieldDefinitions.find((f) => f.id === fieldId);
  if (field && field.options.length > 0) {
    return [...field.options].sort((a, b) => a.sortOrder - b.sortOrder);
  }
  return fallback;
}

export function getStatusOptions(project?: SerializedProject): PlainSelectOption[] {
  return fieldOptions(project, STATUS_FIELD_ID, DEFAULT_STATUS_OPTIONS);
}

export function getPriorityOptions(project?: SerializedProject): PlainSelectOption[] {
  return fieldOptions(project, PRIORITY_FIELD_ID, DEFAULT_PRIORITY_OPTIONS);
}

export function getOptionById(
  options: PlainSelectOption[],
  id: string | undefined,
): PlainSelectOption | undefined {
  if (!id) return undefined;
  return options.find((o) => o.id === id);
}

export function visibilityStringToProto(visibility: string): AccessMode {
  return visibility === "ORGANIZATION" ? AccessMode.OPEN_TO_ORG : AccessMode.OWNER_ONLY;
}

export const SPRINT_STATUS_LABEL: Record<SerializedSprint["status"], string> = {
  planned: "Planned",
  active: "Active",
  closed: "Closed",
};

/** Active reads as go, closed as spent, planned as upcoming. */
export function sprintStatusTint(T: ThemeColors, status: SerializedSprint["status"]): string {
  if (status === "active") return T.green;
  if (status === "closed") return T.textDim;
  return T.blue;
}
