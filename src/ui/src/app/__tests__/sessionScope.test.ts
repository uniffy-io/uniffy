import { describe, expect, it } from "vitest";
import { combineReducers } from "@reduxjs/toolkit";
import { OrganizationRole } from "@uniffy/proto/common/v1/common_pb";
import { withSessionScope } from "@/app/sessionScope";
import { themeReducer } from "@/config/theme/themeSlice";
import { authReducer, logout, setCredentials } from "@/features/auth/store/authSlice";
import { resetOrganizationScope } from "@/features/auth/store/authActions";
import {
  organizationsLoaded,
  organizationsReducer,
} from "@/features/auth/store/organizationsSlice";
import { projectsReducer, setCurrentProject } from "@/features/projects/store/projectsSlice";
import {
  openView,
  projectsUiReducer,
  setSidebarWidth,
} from "@/features/projects/store/projectsUiSlice";
import { sprintsReducer } from "@/features/projects/store/sprintsSlice";
import {
  calendarUiReducer,
  openEventModal,
  selectEvent,
  setViewMode,
} from "@/features/calendar/store/calendarUiSlice";
import {
  chatUiReducer,
  openCreateChannelModal,
  setDensity,
  setReplyToMessage,
  toggleAgentFolderCollapsed,
} from "@/features/chat/store/chatUiSlice";

const rootReducer = combineReducers({
  auth: authReducer,
  organizations: organizationsReducer,
  theme: themeReducer,
  projects: projectsReducer,
  projectsUi: projectsUiReducer,
  sprints: sprintsReducer,
  chatUi: chatUiReducer,
  calendarUi: calendarUiReducer,
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
  state = reducer(
    state,
    organizationsLoaded([
      {
        id: organizationId,
        name: "Acme",
        slug: "acme",
        role: OrganizationRole.MEMBER,
        suspended: false,
        joinedAt: "2026-10-01T00:00:00.000Z",
      },
    ]),
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
    expect(after.auth.isAuthenticated).toBe(true);
    expect(after.auth.currentOrganizationId).toBe("org-a");
    expect(after.theme).toBe(before.theme);
  });

  it("keeps projects layout and open views across a switch, since project ids are global", () => {
    const after = reducer(signedIn("org-a"), resetOrganizationScope());

    expect(after.projectsUi.sidebarWidth).toBe(333);
    expect(after.projectsUi.activeViewIds).toEqual({ "project-a": "view-a" });
  });

  it("drops open views on logout and keeps projects layout", () => {
    const after = reducer(signedIn("org-a"), logout());

    expect(after.projectsUi.sidebarWidth).toBe(333);
    expect(after.projectsUi.activeViewIds).toEqual({});
  });

  it("keeps chat and calendar layout and drops what names the previous organization", () => {
    let before = signedIn("org-a");
    before = reducer(before, setDensity("compact"));
    before = reducer(before, toggleAgentFolderCollapsed("folder-a"));
    before = reducer(before, openCreateChannelModal("category-a"));
    before = reducer(
      before,
      setReplyToMessage({
        id: "message-a",
        channelId: "channel-a",
        senderName: "Ada",
        contentPreview: "Org A secret",
      }),
    );
    before = reducer(before, setViewMode("month"));
    before = reducer(before, selectEvent("event-a"));
    before = reducer(
      before,
      openEventModal({ mode: "create", prefill: { title: "Org A meeting" } }),
    );

    const after = reducer(before, resetOrganizationScope());

    expect(after.chatUi).toMatchObject({
      density: "compact",
      replyToMessage: null,
      collapsedAgentFolders: {},
      createChannelModalOpen: false,
      createChannelCategoryId: null,
    });
    expect(after.calendarUi).toMatchObject({
      viewMode: "month",
      selectedEventId: null,
      isEventModalOpen: false,
      eventModalPrefill: null,
    });
  });

  it("keeps the organization list across an organization switch", () => {
    const before = signedIn("org-a");
    const after = reducer(before, resetOrganizationScope());

    expect(after.organizations).toBe(before.organizations);
    expect(after.organizations.status).toBe("ready");
  });

  it("signs out and clears organization data on logout", () => {
    const after = reducer(signedIn("org-a"), logout());

    expect(after.auth.isAuthenticated).toBe(false);
    expect(after.projects.currentProjectId).toBeNull();
    expect(after.sprints.sprintsByProject).toEqual({});
    expect(after.organizations.items).toEqual([]);
    expect(after.organizations.status).toBe("idle");
  });

  it("leaves other actions to the slices", () => {
    const before = signedIn("org-a");
    const after = reducer(before, { type: "unrelated/action" });

    expect(after.projects.currentProjectId).toBe("project-a");
  });
});
