import type {
  Project,
  Task,
  TaskActivity,
  FieldDefinition,
} from "@uniffy/proto/projects/v1/projects_pb";
import { ActivityAction } from "@uniffy/proto/projects/v1/projects_pb";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";

export interface PlainSelectOption {
  id: string;
  label: string;
  color: string;
  sortOrder: number;
}

export interface SerializedFieldDefinition {
  id: string;
  name: string;
  options: PlainSelectOption[];
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
  memberIds: string[];
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
  userRole: number;
  outgoingReferences: string[];
  fieldValues: { [key: string]: string };
  tags: string[];
  createdAt?: string;
  updatedAt?: string;
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

const STATUS_FIELD_ID = "field_status";
const PRIORITY_FIELD_ID = "field_priority";

const DEFAULT_STATUS_OPTIONS: PlainSelectOption[] = [
  { id: "status_todo", label: "To Do", color: "#6b7280", sortOrder: 0 },
  { id: "status_in_progress", label: "In Progress", color: "#3b82f6", sortOrder: 1 },
  { id: "status_done", label: "Done", color: "#22c55e", sortOrder: 2 },
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

function fieldDefinitionToPlain(field: FieldDefinition): SerializedFieldDefinition {
  let options: PlainSelectOption[] = [];
  if (field.configJson) {
    try {
      const config = JSON.parse(field.configJson);
      if (Array.isArray(config?.options)) {
        options = config.options.map(
          (o: { id: string; label?: string; color?: string; sortOrder?: number }) => ({
            id: String(o.id),
            label: String(o.label ?? o.id),
            color: String(o.color ?? "#909296"),
            sortOrder: Number(o.sortOrder ?? 0),
          }),
        );
      }
    } catch {
      // Malformed config from server - leave options empty
    }
  }
  return { id: field.id, name: field.name, options };
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
    memberIds: [],
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
    userRole: task.userRole,
    outgoingReferences: task.outgoingReferences,
    fieldValues: task.fieldValues,
    tags: task.tags.map((t) => t.name),
    createdAt: tsToIso(task.createdAt),
    updatedAt: tsToIso(task.updatedAt),
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

export function computeProjectStats(tasks: SerializedTask[]): ProjectStats {
  const top = tasks.filter((t) => !t.parentId);
  const total = top.length;
  const done = top.filter((t) => !!t.completedAt).length;
  const inProgress = total - done;
  const progress = total === 0 ? 0 : Math.round((done / total) * 100);
  return { total, done, inProgress, progress };
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
