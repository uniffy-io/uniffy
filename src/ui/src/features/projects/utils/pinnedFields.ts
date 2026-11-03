/** Task system fields a user can pin under the task title; mirrors the server's allowed set. */
export const PINNABLE_TASK_FIELDS = [
  "status",
  "priority",
  "assignees",
  "due_date",
  "start_date",
  "tags",
  "type",
  "sprint",
  "estimate",
] as const;

export type PinnableTaskField = (typeof PINNABLE_TASK_FIELDS)[number];

export const MAX_PINNED_TASK_FIELDS = 6;

export const DEFAULT_TASK_PINNED_FIELDS: readonly PinnableTaskField[] = [
  "status",
  "priority",
  "assignees",
  "due_date",
];

export const PINNABLE_TASK_FIELD_LABELS: Record<PinnableTaskField, string> = {
  status: "Status",
  priority: "Priority",
  assignees: "Assignees",
  due_date: "Due date",
  start_date: "Start date",
  tags: "Tags",
  type: "Type",
  sprint: "Sprint",
  estimate: "Estimate",
};

function isPinnable(value: string): value is PinnableTaskField {
  return (PINNABLE_TASK_FIELDS as readonly string[]).includes(value);
}

/**
 * The pins to render: unknown ids from a newer client are skipped, duplicates collapse and the
 * list stops at the limit. An unset preference falls back to the default set.
 */
export function normalizePinnedFields(value: readonly string[] | undefined): PinnableTaskField[] {
  if (!value) return [...DEFAULT_TASK_PINNED_FIELDS];
  const pinned: PinnableTaskField[] = [];
  for (const field of value) {
    if (isPinnable(field) && !pinned.includes(field)) pinned.push(field);
    if (pinned.length === MAX_PINNED_TASK_FIELDS) break;
  }
  return pinned;
}

/** Pins or unpins a field, keeping the order and refusing to grow past the limit. */
export function togglePinnedField(
  pinned: readonly PinnableTaskField[],
  field: PinnableTaskField,
): PinnableTaskField[] {
  if (pinned.includes(field)) return pinned.filter((candidate) => candidate !== field);
  if (pinned.length >= MAX_PINNED_TASK_FIELDS) return [...pinned];
  return [...pinned, field];
}
