import { combineReducers } from "@reduxjs/toolkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RootState } from "@/app/store";
import { create } from "@bufbuild/protobuf";
import { FileSchema } from "@uniffy/proto/files/v1/files_pb";

const FILES_VIEW_KEY = "uniffy-files-view";
const RUN_KEY = "uniffy.agentRuntime.activeRunId";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

async function fixture() {
  vi.resetModules();
  const local = storage();
  const session = storage();
  local.setItem(
    FILES_VIEW_KEY,
    JSON.stringify({
      viewMode: "grid",
      activeFilterId: "filter-a",
      activeFilterName: "Org A filter",
      activeFilterCriteria: { tagIds: ["tag-a"] },
    }),
  );
  session.setItem(RUN_KEY, "run-at-boot");
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("window", { sessionStorage: session });
  const { withSessionScope } = await import("@/app/sessionScope");
  const files = await import("@/features/files/store/filesSlice");
  const agents = await import("@/features/agents/store/agentMessagesSlice");
  const { selectFilesForCurrentFolderAndScope } = await import("@/features/files/store/selectors");
  const { projectsUiReducer } = await import("@/features/projects/store/projectsUiSlice");
  const reducer = withSessionScope(
    combineReducers({
      files: files.filesReducer,
      agentMessages: agents.agentMessagesReducer,
      projectsUi: projectsUiReducer,
      auth: (state = { user: { id: "user-b" } }) => state,
    }),
  );
  return { local, session, files, agents, reducer, selectFilesForCurrentFolderAndScope };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe.each(["auth/logout", "auth/resetOrganizationScope"])("%s storage cleanup", (type) => {
  let context: Awaited<ReturnType<typeof fixture>>;
  beforeEach(async () => {
    context = await fixture();
  }, 15000);

  it("drops a boot-time file filter and retains current layout and sorting", async () => {
    const { reducer, files, local, selectFilesForCurrentFolderAndScope } = context;
    const { fileToPlain } = await import("@/features/files/store/filesThunks");
    let state = reducer(undefined, { type: "init" });
    expect(state.files.activeFilter.id).toBe("filter-a");
    state = reducer(state, files.clearActiveFilter());
    state = reducer(state, files.setViewMode("list"));
    state = reducer(state, files.setIconSize(3));
    state = reducer(state, files.setSortBy("filename"));
    state = reducer(state, files.setSortOrder("asc"));
    state = reducer(state, files.setCurrentFile("file-a"));
    state = reducer(state, { type });

    expect(state.files.activeFilter).toEqual({ id: null, name: null, criteria: null });
    expect(state.files.currentFileId).toBeNull();
    expect(state.files.viewMode).toBe("list");
    expect(state.files.iconSize).toBe(3);
    expect(state.files.filters).toMatchObject({ sortBy: "filename", sortOrder: "asc" });
    expect(JSON.parse(local.getItem(FILES_VIEW_KEY)!)).toMatchObject({
      viewMode: "list",
      activeFilterId: null,
      activeFilterName: null,
      activeFilterCriteria: null,
    });
    state = reducer(
      state,
      files.setFile(
        fileToPlain(
          create(FileSchema, {
            id: "file-b",
            filename: "B.txt",
            mimeType: "text/plain",
            ownerId: "user-b",
            tags: [{ id: "tag-b" }],
            isDeleted: false,
          }),
        ),
      ),
    );
    expect(
      selectFilesForCurrentFolderAndScope(state as unknown as RootState).map((file) => file.id),
    ).toEqual(["file-b"]);
  });

  it("does not restore a cleared run ID from startup or keep a later stored ID", async () => {
    const { reducer, agents, session } = context;
    let state = reducer(undefined, { type: "init" });
    expect(state.agentMessages.activeRunId).toBe("run-at-boot");
    state = reducer(state, agents.clearActiveRunId());
    state = reducer(state, { type });
    expect(state.agentMessages.activeRunId).toBeNull();
    expect(session.getItem(RUN_KEY)).toBeNull();

    state = reducer(state, agents.runIdReceived("run-current"));
    state = reducer(state, { type });
    expect(state.agentMessages.activeRunId).toBeNull();
    expect(session.getItem(RUN_KEY)).toBeNull();
  });
});
