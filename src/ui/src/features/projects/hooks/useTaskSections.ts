import { useCallback, useState } from "react";

export type TaskSectionId =
  | "fields"
  | "subtasks"
  | "dependencies"
  | "references"
  | "comments"
  | "activity";

type SectionState = Record<TaskSectionId, boolean>;

/** A device preference, the same in every organization, so the key carries no org or user. */
export const TASK_SECTIONS_STORAGE_KEY = "uniffy:task-sections";

export const DEFAULT_TASK_SECTIONS: SectionState = {
  fields: false,
  subtasks: true,
  dependencies: true,
  references: true,
  comments: true,
  activity: false,
};

/** Stored choices over the defaults; anything unreadable falls back to the defaults. */
export function parseTaskSections(raw: string | null): SectionState {
  if (!raw) return { ...DEFAULT_TASK_SECTIONS };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_TASK_SECTIONS };
    const state = { ...DEFAULT_TASK_SECTIONS };
    for (const id of Object.keys(DEFAULT_TASK_SECTIONS) as TaskSectionId[]) {
      const value = (parsed as Record<string, unknown>)[id];
      if (typeof value === "boolean") state[id] = value;
    }
    return state;
  } catch {
    return { ...DEFAULT_TASK_SECTIONS };
  }
}

function readStored(): SectionState {
  try {
    return parseTaskSections(localStorage.getItem(TASK_SECTIONS_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_TASK_SECTIONS };
  }
}

/** Which task detail sections are open, remembered on this device across tasks. */
export function useTaskSections() {
  const [open, setOpen] = useState<SectionState>(readStored);

  const toggle = useCallback((id: TaskSectionId) => {
    setOpen((previous) => {
      const next = { ...previous, [id]: !previous[id] };
      try {
        localStorage.setItem(TASK_SECTIONS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable: the choice holds for this visit only.
      }
      return next;
    });
  }, []);

  return { open, toggle };
}
