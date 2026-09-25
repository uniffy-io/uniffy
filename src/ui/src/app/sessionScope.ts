import type { Action, Reducer } from "@reduxjs/toolkit";
import { AUTH_ACTION_TYPES, resetOrganizationScope } from "@/features/auth/store/authActions";
import { projectsUiLayout } from "@/features/projects/store/projectsUiPersist";
import type { ProjectsUiState } from "@/features/projects/types/ui";

/**
 * Slices that survive a sign-out or an organization switch. Everything else holds data
 * loaded for one user in one organization and restarts from its initial state, so a
 * slice added later is cleared without being listed anywhere. `auth` and `recording`
 * stay here because their own reducers handle `logout`.
 */
const SESSION_INDEPENDENT_SLICES = [
  "auth",
  "theme",
  "zenMode",
  "editor",
  "callPreferences",
  "agentsUi",
  "recording",
] as const;

function endsOrganizationScope(action: Action): boolean {
  return action.type === AUTH_ACTION_TYPES.LOGOUT || resetOrganizationScope.match(action);
}

export function withSessionScope<S extends { projectsUi: ProjectsUiState }>(
  reducer: Reducer<S>,
): Reducer<S> {
  return (state, action) => {
    if (!state || !endsOrganizationScope(action)) {
      return reducer(state, action);
    }
    const kept: Partial<S> = { projectsUi: projectsUiLayout(state.projectsUi) } as Partial<S>;
    for (const key of SESSION_INDEPENDENT_SLICES) {
      if (key in state) {
        kept[key as keyof S] = state[key as keyof S];
      }
    }
    return reducer(kept as S, action);
  };
}
