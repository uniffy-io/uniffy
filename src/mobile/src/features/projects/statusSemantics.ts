import {
  getStatusOptions,
  type PlainSelectOption,
  type SerializedProject,
  type TaskStatusSemantic,
} from "@features/projects/projectsSerializer";

/** Consulted only for an option saved before statuses stored their semantic; mirrors the server table. */
const LEGACY_STATUS_SEMANTICS: Readonly<Record<string, TaskStatusSemantic>> = {
  status_todo: "todo",
  status_in_progress: "in_progress",
  status_review: "review",
  status_done: "completed",
};

/** A project must keep one status for each of these; the server rejects a status list without them. */
export const REQUIRED_STATUS_SEMANTICS: readonly TaskStatusSemantic[] = [
  "todo",
  "in_progress",
  "completed",
];

export function statusSemanticOf(option: PlainSelectOption): TaskStatusSemantic | null {
  if (option.semantic !== undefined) return option.semantic;
  return LEGACY_STATUS_SEMANTICS[option.id] ?? null;
}

export function isRequiredStatusOption(option: PlainSelectOption): boolean {
  const semantic = statusSemanticOf(option);
  return semantic !== null && REQUIRED_STATUS_SEMANTICS.includes(semantic);
}

/** The server resolves each semantic to the one option carrying it. */
export function statusIdForSemantic(
  options: readonly PlainSelectOption[],
  semantic: TaskStatusSemantic,
): string | null {
  return options.find((option) => statusSemanticOf(option) === semantic)?.id ?? null;
}

export function isCompletedStatus(
  options: readonly PlainSelectOption[],
  statusId: string | null | undefined,
): boolean {
  if (!statusId) return false;
  return statusIdForSemantic(options, "completed") === statusId;
}

export function statusOptionsOf(project: SerializedProject | undefined): PlainSelectOption[] {
  return getStatusOptions(project);
}
