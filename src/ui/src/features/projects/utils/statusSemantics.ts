import {
  DEFAULT_STATUS_OPTIONS,
  SYSTEM_FIELD_IDS,
  type FieldDefinition,
  type SelectOption,
  type TaskStatusSemantic,
} from "@/features/projects/types/fields";

const SEMANTICS: ReadonlySet<string> = new Set<TaskStatusSemantic>([
  "todo",
  "in_progress",
  "review",
  "completed",
]);

/** Consulted only for an option saved before statuses stored their semantic; mirrors the backend table. */
const LEGACY_STATUS_SEMANTICS: Readonly<Record<string, TaskStatusSemantic>> = {
  status_todo: "todo",
  status_in_progress: "in_progress",
  status_review: "review",
  status_done: "completed",
};

/** A project must keep one status for each of these; the backend rejects a status list without them. */
export const REQUIRED_STATUS_SEMANTICS: readonly TaskStatusSemantic[] = [
  "todo",
  "in_progress",
  "completed",
];

export function statusSemanticOf(option: SelectOption): TaskStatusSemantic | null {
  if (option.semantic !== undefined) {
    return SEMANTICS.has(option.semantic) ? option.semantic : null;
  }
  return LEGACY_STATUS_SEMANTICS[option.id] ?? null;
}

const STAGE_LABELS: Readonly<Record<TaskStatusSemantic, string>> = {
  todo: "to do",
  in_progress: "in progress",
  review: "review",
  completed: "completed",
};

export function isRequiredStatusOption(option: SelectOption): boolean {
  const semantic = statusSemanticOf(option);
  return semantic !== null && REQUIRED_STATUS_SEMANTICS.includes(semantic);
}

/** Tooltip for a status the editor refuses to delete, or null when it may go. */
export function requiredStatusHint(option: SelectOption): string | null {
  const semantic = statusSemanticOf(option);
  if (semantic === null || !REQUIRED_STATUS_SEMANTICS.includes(semantic)) return null;
  return `Projects need a status for the ${STAGE_LABELS[semantic]} stage, so this one stays`;
}

/** The backend resolves each semantic to the first option carrying it. */
export function statusIdForSemantic(
  options: readonly SelectOption[],
  semantic: TaskStatusSemantic,
): string | null {
  return options.find((option) => statusSemanticOf(option) === semantic)?.id ?? null;
}

export function isCompletedStatus(
  options: readonly SelectOption[],
  statusId: string | null | undefined,
): boolean {
  if (!statusId) return false;
  return statusIdForSemantic(options, "completed") === statusId;
}

export function statusOptionsOf(
  fieldDefinitions: readonly FieldDefinition[] | undefined,
): SelectOption[] {
  const statusField = fieldDefinitions?.find((field) => field.id === SYSTEM_FIELD_IDS.STATUS);
  return statusField?.config.options ?? DEFAULT_STATUS_OPTIONS;
}
