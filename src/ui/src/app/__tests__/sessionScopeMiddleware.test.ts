import { combineReducers, configureStore, type Middleware } from "@reduxjs/toolkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "@bufbuild/protobuf";
import { ProjectSchema } from "@uniffy/proto/projects/v1/projects_pb";
import { withSessionScope } from "@/app/sessionScope";
import { sessionScopeMiddleware } from "@/app/sessionScopeMiddleware";
import { authReducer, logout, setCredentials } from "@/features/auth/store/authSlice";
import { resetOrganizationScope } from "@/features/auth/store/authActions";
import { projectsReducer } from "@/features/projects/store/projectsSlice";
import { projectsUiReducer } from "@/features/projects/store/projectsUiSlice";
import { fetchProject, fetchProjects } from "@/features/projects/store/projectsThunks";
import { projectsApi } from "@/features/projects/api/projectsApi";
import { tagsReducer } from "@/features/tags/store/tagsSlice";
import type { Project } from "@/features/projects/types/project";

vi.mock("@/features/projects/api/projectsApi", () => ({
  projectsApi: { listProjects: vi.fn(), getProject: vi.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function credentials(organizationId: string, userId = "user-a") {
  return setCredentials({
    user: { id: userId } as Parameters<typeof setCredentials>[0]["user"],
    accessToken: "access",
    refreshToken: "refresh",
    organizationId,
  });
}

function fixture() {
  const observed = vi.fn();
  const observer: Middleware = () => (next) => (action) => {
    observed(action);
    return next(action);
  };
  const store = configureStore({
    reducer: withSessionScope(
      combineReducers({
        auth: authReducer,
        projects: projectsReducer,
        projectsUi: projectsUiReducer,
        tags: tagsReducer,
      }),
    ),
    middleware: (defaults) => defaults().prepend(sessionScopeMiddleware).concat(observer),
  });
  store.dispatch(credentials("org-a"));
  return { store, observed };
}

function response(id: string) {
  return {
    projects: [{ id } as Project],
    protoProjects: [create(ProjectSchema, { id, tags: [{ id: `tag-${id}`, slug: id }] })],
  };
}

beforeEach(() => vi.resetAllMocks());

describe("sessionScopeMiddleware", () => {
  it.each([logout, resetOrganizationScope])(
    "discards late project lists and their tag hydration on %s",
    async (endScope) => {
      const { store, observed } = fixture();
      const pending = deferred<Awaited<ReturnType<typeof projectsApi.listProjects>>>();
      vi.mocked(projectsApi.listProjects).mockReturnValueOnce(pending.promise);
      const request = store.dispatch(fetchProjects());
      store.dispatch(endScope());
      store.dispatch(credentials("org-b", "user-b"));
      await expect(request.unwrap()).rejects.toMatchObject({ name: "AbortError" });
      observed.mockClear();
      pending.resolve(response("old-project"));
      await pending.promise;
      await Promise.resolve();

      expect(store.getState().projects.projects).toEqual({});
      expect(store.getState().tags.byId).toEqual({});
      expect(observed).not.toHaveBeenCalled();

      vi.mocked(projectsApi.listProjects).mockResolvedValueOnce(response("current-project"));
      await store.dispatch(fetchProjects()).unwrap();
      expect(Object.keys(store.getState().projects.projects)).toEqual(["current-project"]);
      expect(Object.keys(store.getState().tags.byId)).toEqual(["tag-current-project"]);
    },
  );

  it("discards a project detail even after switching away and back to the same org", async () => {
    const { store } = fixture();
    const pending = deferred<Awaited<ReturnType<typeof projectsApi.getProject>>>();
    vi.mocked(projectsApi.getProject).mockReturnValueOnce(pending.promise);
    const request = store.dispatch(fetchProject("old-project"));
    store.dispatch(resetOrganizationScope());
    store.dispatch(credentials("org-b"));
    store.dispatch(resetOrganizationScope());
    store.dispatch(credentials("org-a"));
    await request;
    pending.resolve({
      project: { id: "old-project" } as Project,
      protoProject: create(ProjectSchema, { id: "old-project" }),
    });
    await pending.promise;
    await Promise.resolve();
    expect(store.getState().projects.projects).toEqual({});
  });

  it("keeps late failures out of the next session and downstream toast middleware", async () => {
    const { store, observed } = fixture();
    const pending = deferred<Awaited<ReturnType<typeof projectsApi.listProjects>>>();
    vi.mocked(projectsApi.listProjects).mockReturnValueOnce(pending.promise);
    const request = store.dispatch(fetchProjects());
    store.dispatch(logout());
    await request;
    observed.mockClear();
    pending.reject(new Error("Previous org request failed"));
    await pending.promise.catch(() => undefined);
    await Promise.resolve();
    expect(store.getState().projects.errors.projects).toBeNull();
    expect(observed).not.toHaveBeenCalled();
  });

  it("leaves an active session request usable across token refresh", async () => {
    const { store } = fixture();
    const pending = deferred<Awaited<ReturnType<typeof projectsApi.listProjects>>>();
    vi.mocked(projectsApi.listProjects).mockReturnValueOnce(pending.promise);
    const request = store.dispatch(fetchProjects());
    store.dispatch(credentials("org-a"));
    pending.resolve(response("current-project"));
    await request.unwrap();
    expect(Object.keys(store.getState().projects.projects)).toEqual(["current-project"]);
  });
});
