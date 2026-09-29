import { configureStore, type UnknownAction } from "@reduxjs/toolkit";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { FileSchema } from "@uniffy/proto/files/v1/files_pb";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RootState } from "@/app/store";
import { contentAccessMiddleware } from "@/app/contentAccessMiddleware";
import { filesReducer } from "@/features/files/store/filesSlice";
import { viewerReducer, openViewer, setPlaying } from "@/features/files/store/viewerSlice";
import { revalidateViewerAccess } from "@/features/files/store/viewerThunks";
import { fileToPlain } from "@/features/files/store/filesThunks";
import { removeChannel } from "@/features/chat/store/chatChannelsSlice";
import { onContentAccessChanged } from "@/features/notifications/contentAccessEmitter";
import { projectsReducer, setCurrentProject } from "@/features/projects/store/projectsSlice";
import {
  projectsUiReducer,
  selectTask,
  openDetailPanel,
} from "@/features/projects/store/projectsUiSlice";
import { fetchProjects, fetchProjectTasks } from "@/features/projects/store/projectsThunks";
import type { Project, Task } from "@/features/projects/types/project";

const { getFile } = vi.hoisted(() => ({ getFile: vi.fn() }));
vi.mock("@/features/files/api/filesApi", () => ({ filesApi: { getFile } }));

function makeStore() {
  const initial = { auth: { currentOrganizationId: "org" } } as RootState;
  return configureStore({
    reducer: (state: RootState = initial, action: UnknownAction): RootState => ({
      ...state,
      files: filesReducer(state.files, action),
      fileViewer: viewerReducer(state.fileViewer, action),
      projects: projectsReducer(state.projects, action),
      projectsUi: projectsUiReducer(state.projectsUi, action),
    }),
    middleware: (defaults) => defaults().concat(contentAccessMiddleware),
  });
}

beforeEach(() => {
  getFile.mockReset();
});

describe("parent access refresh", () => {
  it("removes denied file snapshots and stops playback", async () => {
    const store = makeStore();
    const file = fileToPlain(create(FileSchema, { id: "file", organizationId: "org" }));
    store.dispatch(openViewer({ fileId: file.id, fileData: file }));
    store.dispatch(setPlaying(true));
    getFile.mockRejectedValue(new ConnectError("Denied", Code.PermissionDenied));
    await store.dispatch(revalidateViewerAccess());
    expect(store.getState().fileViewer).toMatchObject({
      isOpen: false,
      isPlaying: false,
      fileData: null,
      currentFileId: null,
    });
  });

  it("keeps an independently accessible file open", async () => {
    const store = makeStore();
    const file = create(FileSchema, { id: "file", organizationId: "org" });
    store.dispatch(openViewer({ fileId: file.id }));
    getFile.mockResolvedValue({ file });
    await store.dispatch(revalidateViewerAccess());
    expect(store.getState().fileViewer.isOpen).toBe(true);
    expect(store.getState().fileViewer.fileData?.id).toBe(file.id);
  });

  it("does not close a different viewer opened during an access check", async () => {
    const store = makeStore();
    let reject!: (error: Error) => void;
    getFile.mockReturnValue(
      new Promise((_, fail) => {
        reject = fail;
      }),
    );
    store.dispatch(openViewer({ fileId: "denied" }));
    const checking = store.dispatch(revalidateViewerAccess());
    store.dispatch(openViewer({ fileId: "allowed" }));
    reject(new ConnectError("Denied", Code.PermissionDenied));
    await checking;
    expect(store.getState().fileViewer).toMatchObject({ isOpen: true, currentFileId: "allowed" });
  });

  it("keeps the viewer on transient transport failure", async () => {
    const store = makeStore();
    store.dispatch(openViewer({ fileId: "file" }));
    getFile.mockRejectedValue(new ConnectError("Offline", Code.Unavailable));
    await store.dispatch(revalidateViewerAccess());
    expect(store.getState().fileViewer.isOpen).toBe(true);
  });

  it("relays channel removal to active access subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = onContentAccessChanged(listener);
    makeStore().dispatch(removeChannel("channel"));
    unsubscribe();
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ contentId: "channel", action: "revoked" }),
    );
  });

  it("prunes revoked tasks and ignores a late task response", () => {
    const store = makeStore();
    const project = { id: "project", userRole: 1 } as Project;
    const task = { id: "task", projectId: "project" } as Task;
    store.dispatch(fetchProjects.fulfilled([project], "projects"));
    store.dispatch(setCurrentProject(project.id));
    store.dispatch(fetchProjectTasks.fulfilled([task], "tasks", project.id));
    store.dispatch(selectTask(task.id));
    store.dispatch(openDetailPanel());
    store.dispatch(fetchProjects.fulfilled([], "revoked"));
    store.dispatch(fetchProjectTasks.fulfilled([task], "late", project.id));
    expect(store.getState().projects.tasks).toEqual({});
    expect(store.getState().projects.currentProjectId).toBeNull();
    expect(store.getState().projectsUi).toMatchObject({
      selectedTaskId: null,
      isDetailPanelOpen: false,
    });
  });

  it("keeps readable tasks when a project role changes", () => {
    const store = makeStore();
    const project = { id: "project", userRole: 3 } as Project;
    const task = { id: "task", projectId: "project" } as Task;
    store.dispatch(fetchProjects.fulfilled([project], "projects"));
    store.dispatch(fetchProjectTasks.fulfilled([task], "tasks", project.id));
    store.dispatch(selectTask(task.id));
    store.dispatch(openDetailPanel());
    store.dispatch(fetchProjects.fulfilled([{ ...project, userRole: 1 }], "changed"));
    expect(store.getState().projects.tasks[task.id]).toEqual(task);
    expect(store.getState().projectsUi.isDetailPanelOpen).toBe(true);
  });

  it("keeps a linked task selected while its project and tasks are loading", () => {
    const store = makeStore();
    const project = { id: "project", userRole: 1 } as Project;
    const task = { id: "task", projectId: project.id } as Task;
    store.dispatch(setCurrentProject(project.id));
    store.dispatch(selectTask(task.id));
    store.dispatch(openDetailPanel());

    store.dispatch(fetchProjects.fulfilled([project], "projects"));
    expect(store.getState().projectsUi).toMatchObject({
      selectedTaskId: task.id,
      isDetailPanelOpen: true,
    });
    store.dispatch(fetchProjectTasks.fulfilled([task], "tasks", project.id));
    expect(store.getState().projects.tasks[task.id]).toEqual(task);
    expect(store.getState().projectsUi.selectedTaskId).toBe(task.id);
  });

  it("closes an unloaded task when its routed project is inaccessible", () => {
    const store = makeStore();
    store.dispatch(setCurrentProject("denied-project"));
    store.dispatch(selectTask("unloaded-task"));
    store.dispatch(openDetailPanel());

    store.dispatch(fetchProjects.fulfilled([], "projects"));
    expect(store.getState().projectsUi).toMatchObject({
      selectedTaskId: null,
      isDetailPanelOpen: false,
    });
  });
});
