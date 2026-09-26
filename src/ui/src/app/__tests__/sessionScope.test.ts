import { describe, expect, it } from "vitest";
import { combineReducers } from "@reduxjs/toolkit";
import { withSessionScope } from "@/app/sessionScope";
import { themeReducer } from "@/config/theme/themeSlice";
import { authReducer, logout, setCredentials } from "@/features/auth/store/authSlice";
import { resetOrganizationScope } from "@/features/auth/store/authActions";
import { projectsReducer, setCurrentProject } from "@/features/projects/store/projectsSlice";
import {
  openView,
  projectsUiReducer,
  setSidebarWidth,
} from "@/features/projects/store/projectsUiSlice";
import { sprintsReducer } from "@/features/projects/store/sprintsSlice";

const rootReducer = combineReducers({
  auth: authReducer,
  theme: themeReducer,
  projects: projectsReducer,
  projectsUi: projectsUiReducer,
  sprints: sprintsReducer,
});
const reducer = withSessionScope(rootReducer);
type State = ReturnType<typeof rootReducer>;

function signedIn(organizationId: string): State {
  let state = reducer(undefined, { type: "@@init" });
  state = reducer(
    state,
    setCredentials({
      user: { id: "user-a" } as Parameters<typeof setCredentials>[0]["user"],
      accessToken: "access",
      refreshToken: "refresh",
      organizationId,
    }),
  );
  state = reducer(state, setCurrentProject("project-a"));
  state = reducer(state, openView({ projectId: "project-a", viewId: "view-a" }));
  state = reducer(state, setSidebarWidth(333));
  return {
    ...state,
    sprints: { ...state.sprints, sprintsByProject: { "project-a": ["sprint-a"] } },
  };
}

describe("withSessionScope", () => {
  it("drops the previous organization's data on an organization switch and keeps the session", () => {
    const before = signedIn("org-a");
    const after = reducer(before, resetOrganizationScope());

    expect(after.projects.currentProjectId).toBeNull();
    expect(after.sprints.sprintsByProject).toEqual({});
    expect(after.projectsUi.activeViewIds).toEqual({});
    expect(after.auth.isAuthenticated).toBe(true);
    expect(after.auth.currentOrganizationId).toBe("org-a");
    expect(after.theme).toBe(before.theme);
  });

  it("keeps projects layout preferences and nothing else from the projects UI", () => {
    const after = reducer(signedIn("org-a"), resetOrganizationScope());

    expect(after.projectsUi.sidebarWidth).toBe(333);
    expect(after.projectsUi.viewDrafts).toEqual({});
  });

  it("signs out and clears organization data on logout", () => {
    const after = reducer(signedIn("org-a"), logout());

    expect(after.auth.isAuthenticated).toBe(false);
    expect(after.projects.currentProjectId).toBeNull();
    expect(after.sprints.sprintsByProject).toEqual({});
  });

  it("leaves other actions to the slices", () => {
    const before = signedIn("org-a");
    const after = reducer(before, { type: "unrelated/action" });

    expect(after.projects.currentProjectId).toBe("project-a");
  });
});
