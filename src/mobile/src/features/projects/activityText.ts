import type { SerializedActivity } from "@features/projects/projectsSerializer";

/** Lookups the screen already holds; every one may miss, and the text then degrades. */
export interface ActivityLookups {
  optionLabel: (fieldId: string, optionId: string) => string | undefined;
  fieldName: (fieldId: string) => string | undefined;
  isMultiSelect: (fieldId: string) => boolean;
  personName: (userId: string) => string | undefined;
  taskLabel: (taskId: string) => string | undefined;
  sprintName: (sprintId: string) => string | undefined;
  typeLabel: (taskType: string) => string;
  date: (value: string) => string;
  minutes: (minutes: number) => string;
}

export interface ActivityText {
  headline: string;
  detail?: string;
}

const STATUS_FIELD = "field_status";
const PRIORITY_FIELD = "field_priority";

function split(value?: string): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

function nameList(value?: string): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function fromTo(from: string | undefined, to: string | undefined): string {
  return `${from ?? "none"} -> ${to ?? "none"}`;
}

/** Same wording as the web activity log, as plain text. */
export function describeActivity(act: SerializedActivity, look: ActivityLookups): ActivityText {
  const { previousValue: from, newValue: to } = act;
  const option = (fieldId: string, id?: string) =>
    id ? (look.optionLabel(fieldId, id) ?? id) : undefined;
  const task = (id?: string) => (id ? (look.taskLabel(id) ?? "another task") : undefined);
  const date = (v?: string) => (v ? look.date(v) : undefined);
  const minutes = (v?: string) => (v ? look.minutes(Number(v)) : undefined);
  const people = (ids: string[]) => ids.map((id) => look.personName(id) ?? "someone").join(", ");

  switch (act.action) {
    case "CREATED":
      return { headline: "created this task" };
    case "TITLE_CHANGED":
      return { headline: "renamed the task", detail: fromTo(from, to) };
    case "DESCRIPTION_EDITED":
      return { headline: "edited the description" };
    case "STATUS_CHANGED":
      return {
        headline: "changed status",
        detail: fromTo(option(STATUS_FIELD, from), option(STATUS_FIELD, to)),
      };
    case "PRIORITY_CHANGED":
      return {
        headline: "changed priority",
        detail: fromTo(option(PRIORITY_FIELD, from), option(PRIORITY_FIELD, to)),
      };
    case "TYPE_CHANGED":
      return {
        headline: "changed the type",
        detail: fromTo(from && look.typeLabel(from), to && look.typeLabel(to)),
      };
    case "ASSIGNED": {
      const before = split(from);
      const after = split(to);
      const added = after.filter((id) => !before.includes(id));
      const removed = before.filter((id) => !after.includes(id));
      const parts = [
        added.length ? `assigned ${people(added)}` : "",
        removed.length ? `unassigned ${people(removed)}` : "",
      ].filter(Boolean);
      return { headline: parts.length ? parts.join(" and ") : "changed assignees" };
    }
    case "START_DATE_CHANGED":
      return { headline: "changed the start date", detail: fromTo(date(from), date(to)) };
    case "DUE_DATE_CHANGED":
      return { headline: "changed the due date", detail: fromTo(date(from), date(to)) };
    case "SPRINT_CHANGED": {
      const sprint = (id?: string) => (id ? (look.sprintName(id) ?? "a sprint") : "backlog");
      return { headline: "moved to another sprint", detail: `${sprint(from)} -> ${sprint(to)}` };
    }
    case "ESTIMATE_CHANGED":
      return { headline: "changed the estimate", detail: fromTo(minutes(from), minutes(to)) };
    case "PARENT_CHANGED":
      return { headline: "changed the parent", detail: fromTo(task(from), task(to)) };
    case "RECURRENCE_CHANGED":
      return {
        headline: !to ? "stopped repeating" : from ? "changed how it repeats" : "set it to repeat",
      };
    case "MILESTONE_CHANGED":
      return {
        headline: to === "true" ? "marked it as a milestone" : "unmarked it as a milestone",
      };
    case "TAGS_CHANGED": {
      const added = nameList(to);
      const removed = nameList(from);
      const parts = [
        added.length ? `added tags ${added.join(", ")}` : "",
        removed.length ? `removed tags ${removed.join(", ")}` : "",
      ].filter(Boolean);
      return { headline: parts.join(" and ") || "changed tags" };
    }
    case "FIELD_UPDATED": {
      const fieldId = act.fieldId ?? "";
      const value = (v?: string) => {
        if (!v) return undefined;
        if (look.isMultiSelect(fieldId)) {
          return (
            nameList(v)
              .map((id) => look.optionLabel(fieldId, id) ?? id)
              .join(", ") || undefined
          );
        }
        return look.optionLabel(fieldId, v) ?? v;
      };
      return {
        headline: `changed ${look.fieldName(fieldId) ?? "a field"}`,
        detail: fromTo(value(from), value(to)),
      };
    }
    case "BLOCKED_BY_ADDED":
      return { headline: `marked it blocked by ${task(to)}` };
    case "BLOCKED_BY_REMOVED":
      return { headline: `removed blocker ${task(from)}` };
    case "BLOCKING_ADDED":
      return { headline: `made it block ${task(to)}` };
    case "BLOCKING_REMOVED":
      return { headline: `stopped it blocking ${task(from)}` };
    case "TIME_LOGGED":
      return { headline: `logged ${minutes(to) ?? "time"}` };
    case "TIME_UPDATED":
      return { headline: "changed a time entry", detail: fromTo(minutes(from), minutes(to)) };
    case "TIME_REMOVED":
      return { headline: `removed a time entry of ${minutes(from) ?? "time"}` };
    default:
      return { headline: "updated the task" };
  }
}
