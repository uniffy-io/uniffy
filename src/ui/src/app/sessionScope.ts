import type { Reducer } from "@reduxjs/toolkit";
import { endsOrganizationScope } from "@/features/auth/store/authActions";
import { resetFilesScope, type FilesState } from "@/features/files/store/filesSlice";
import { projectsUiLayout } from "@/features/projects/store/projectsUiPersist";
import type { ProjectsUiState } from "@/features/projects/types/ui";

/** Device preferences survive; auth and recording handle logout in their own reducers. */
const SESSION_INDEPENDENT_SLICES = [
  "auth",
  "theme",
  "zenMode",
  "editor",
  "callPreferences",
  "agentsUi",
  "recording",
] as const;

export function withSessionScope<S extends { projectsUi: ProjectsUiState; files?: FilesState }>(
  reducer: Reducer<S>,
): Reducer<S> {
  return (state, action) => {
    if (!state || !endsOrganizationScope(action)) {
      return reducer(state, action);
    }
    const kept: Partial<S> = { projectsUi: projectsUiLayout(state.projectsUi) } as Partial<S>;
    if (state.files) {
      kept.files = resetFilesScope(state.files);
    }
    for (const key of SESSION_INDEPENDENT_SLICES) {
      if (key in state) {
        kept[key as keyof S] = state[key as keyof S];
      }
    }
    return reducer(kept as S, action);
  };
}
