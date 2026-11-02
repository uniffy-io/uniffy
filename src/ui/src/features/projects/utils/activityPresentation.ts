import type { ActivityAction, TaskActivity } from "@/features/projects/types/activity";

export type ActivityCategory =
  | "status"
  | "people"
  | "dates"
  | "description"
  | "dependencies"
  | "time"
  | "other";

export const ACTIVITY_CATEGORY_LABELS: Record<ActivityCategory | "all", string> = {
  all: "All changes",
  status: "Status and priority",
  people: "Assignees",
  dates: "Dates and estimate",
  description: "Title and description",
  dependencies: "Dependencies and parent",
  time: "Time",
  other: "Other fields",
};

const CATEGORY: Record<ActivityAction, ActivityCategory> = {
  created: "other",
  title_changed: "description",
  description_edited: "description",
  status_changed: "status",
  priority_changed: "status",
  type_changed: "other",
  assigned: "people",
  start_date_changed: "dates",
  due_date_changed: "dates",
  sprint_changed: "dates",
  estimate_changed: "dates",
  parent_changed: "dependencies",
  recurrence_changed: "dates",
  milestone_changed: "other",
  tags_changed: "other",
  field_updated: "other",
  blocked_by_added: "dependencies",
  blocked_by_removed: "dependencies",
  blocking_added: "dependencies",
  blocking_removed: "dependencies",
  time_logged: "time",
  time_updated: "time",
  time_removed: "time",
  unknown: "other",
};

export function activityCategory(action: ActivityAction): ActivityCategory {
  return CATEGORY[action];
}

/** A value replaced by the next one, so a quick run of changes reads as one net change. */
const MERGEABLE = new Set<ActivityAction>([
  "title_changed",
  "status_changed",
  "priority_changed",
  "type_changed",
  "assigned",
  "start_date_changed",
  "due_date_changed",
  "sprint_changed",
  "estimate_changed",
  "parent_changed",
  "recurrence_changed",
  "milestone_changed",
  "field_updated",
]);

export interface ActivityEntry extends TaskActivity {
  /** How many recorded changes this entry stands for. */
  count: number;
}

function sameRun(a: TaskActivity, b: TaskActivity): boolean {
  return (
    MERGEABLE.has(a.action) &&
    a.action === b.action &&
    a.actorId === b.actorId &&
    (a.agentId ?? null) === (b.agentId ?? null) &&
    (a.fieldId ?? null) === (b.fieldId ?? null)
  );
}

/**
 * Collapses consecutive changes to the same field by the same person into one entry that runs
 * from the oldest previous value to the newest value. Input and output are newest first.
 */
export function mergeActivityRuns(newestFirst: TaskActivity[]): ActivityEntry[] {
  const entries: ActivityEntry[] = [];
  for (const activity of newestFirst) {
    const last = entries.at(-1);
    if (last && sameRun(last, activity)) {
      last.previousValue = activity.previousValue;
      last.count += 1;
      continue;
    }
    entries.push({ ...activity, count: 1 });
  }
  return entries;
}

export function splitList(value: string | undefined): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

export function listChange(
  previous: string | undefined,
  next: string | undefined,
): { added: string[]; removed: string[] } {
  const before = splitList(previous);
  const after = splitList(next);
  return {
    added: after.filter((id) => !before.includes(id)),
    removed: before.filter((id) => !after.includes(id)),
  };
}

/** Tag changes carry JSON lists of names; anything else reads as no names. */
export function parseNameList(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}
