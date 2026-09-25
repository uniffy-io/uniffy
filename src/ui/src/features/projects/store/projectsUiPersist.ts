import { createTransform } from "redux-persist";
import { initialProjectsUiState, type ProjectsUiState } from "@/features/projects/types/ui";

/** Layout prefs, open views and unsaved view drafts survive a reload; everything else starts fresh. */
const PERSISTED_KEYS = [
  "activeViewIds",
  "viewTabOrder",
  "viewDrafts",
  "outlineExpanded",
  "isSidebarOpen",
  "detailPanelWidth",
  "sidebarWidth",
  "detailViewMode",
  "projectScope",
  "roadmapStartDate",
] as const satisfies readonly (keyof ProjectsUiState)[];

/** Per-device layout that outlives a sign-out or an organization switch; views and drafts name one org's projects. */
const LAYOUT_KEYS = [
  "isSidebarOpen",
  "detailPanelWidth",
  "sidebarWidth",
  "detailViewMode",
  "projectScope",
] as const satisfies readonly (typeof PERSISTED_KEYS)[number][];

export function projectsUiLayout(state: ProjectsUiState): ProjectsUiState {
  return {
    ...initialProjectsUiState,
    ...Object.fromEntries(LAYOUT_KEYS.map((key) => [key, state[key]])),
  };
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
