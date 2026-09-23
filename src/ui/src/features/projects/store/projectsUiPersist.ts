import { createTransform } from "redux-persist";
import { initialProjectsUiState, type ProjectsUiState } from "@/features/projects/types/ui";

/** Layout prefs, open views and unsaved view drafts survive a reload; everything else starts fresh. */
const PERSISTED_KEYS = [
  "activeViewIds",
  "viewDrafts",
  "outlineExpanded",
  "isSidebarOpen",
  "detailPanelWidth",
  "sidebarWidth",
  "detailViewMode",
  "projectScope",
  "roadmapStartDate",
] as const satisfies readonly (keyof ProjectsUiState)[];

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
