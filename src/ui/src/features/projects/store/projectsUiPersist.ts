import { createTransform } from "redux-persist";
import { initialProjectsUiState, type ProjectsUiState } from "@/features/projects/types/ui";

/** Layout prefs, open views and unsaved view drafts survive a reload; everything else starts fresh. */
const PERSISTED_KEYS = [
  "activeViewIds",
  "viewTabOrder",
  "viewDrafts",
  "outlineExpanded",
  "isSidebarOpen",
  "sidebarWidth",
  "detailViewMode",
  "projectScope",
] as const satisfies readonly (keyof ProjectsUiState)[];

/**
 * What an organization switch keeps: layout plus open views, tab order, drafts and outlines. They are
 * keyed by globally unique project ids, so another organization never resolves them, and switching
 * back finds them again. Logout clears the per-person part in the slice itself.
 */
export function retainProjectsUi(state: ProjectsUiState): ProjectsUiState {
  return rehydrateProjectsUi(state);
}

export function persistedProjectsUi(state: unknown): Partial<ProjectsUiState> {
  const source = (state ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    PERSISTED_KEYS.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
  ) as Partial<ProjectsUiState>;
}

export function rehydrateProjectsUi(state: unknown): ProjectsUiState {
  return { ...initialProjectsUiState, ...persistedProjectsUi(state) };
}

export const projectsUiTransform = createTransform(persistedProjectsUi, rehydrateProjectsUi, {
  whitelist: ["projectsUi"],
});
