import { combineReducers } from "@reduxjs/toolkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RootState } from "@/app/store";
import { create } from "@bufbuild/protobuf";
import { FileSchema } from "@uniffy/proto/files/v1/files_pb";
import { setCredentials } from "@/features/auth/store/authSlice";

const FILES_VIEW_KEY = "uniffy-files-view";
const ORG_A_FILTER_KEY = "uniffy-files-view:filter:org-a:user-b";
const RUN_KEY = "uniffy.agentRuntime.activeRunId";

function storage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

function credentials(organizationId: string | null) {
  return setCredentials({
    user: { id: "user-b" } as Parameters<typeof setCredentials>[0]["user"],
    accessToken: "access",
    refreshToken: "refresh",
    organizationId: organizationId ?? undefined,
  });
}

async function fixture() {
  vi.resetModules();
  const local = storage();
  const session = storage();
  local.setItem(
    FILES_VIEW_KEY,
    JSON.stringify({
      viewMode: "grid",
      activeFilterId: "filter-stale",
      activeFilterName: "Device-wide filter",
      activeFilterCriteria: { tagIds: ["tag-stale"] },
    }),
  );
  local.setItem(
    ORG_A_FILTER_KEY,
    JSON.stringify({ id: "filter-a", name: "Org A filter", criteria: { tagIds: ["tag-a"] } }),
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

  it("resets the tab's filter in state only and retains layout and sorting", async () => {
    const { reducer, files, local, selectFilesForCurrentFolderAndScope } = context;
    const { fileToPlain } = await import("@/features/files/store/filesThunks");
    let state = reducer(undefined, { type: "init" });
    expect(state.files.activeFilter).toEqual({ id: null, name: null, criteria: null });
    expect(JSON.parse(local.getItem(FILES_VIEW_KEY)!)).toEqual({
      viewMode: "grid",
      iconSize: 1,
      sortBy: "updated_at",
      sortOrder: "desc",
    });

    state = reducer(state, credentials("org-a"));
    expect(state.files.activeFilter.id).toBe("filter-a");
    state = reducer(state, files.setViewMode("list"));
    state = reducer(state, files.setIconSize(3));
    state = reducer(state, files.setSortBy("filename"));
    state = reducer(state, files.setSortOrder("asc"));
    state = reducer(state, files.setCurrentFile("file-a"));
    state = reducer(state, { type });

    expect(state.files.activeFilter).toEqual({ id: null, name: null, criteria: null });
    expect(state.files.filterScope).toBeNull();
    expect(state.files.currentFileId).toBeNull();
    expect(state.files.viewMode).toBe("list");
    expect(state.files.iconSize).toBe(3);
    expect(state.files.filters).toMatchObject({ sortBy: "filename", sortOrder: "asc" });
    expect(JSON.parse(local.getItem(FILES_VIEW_KEY)!)).toEqual({
      viewMode: "list",
      iconSize: 3,
      sortBy: "filename",
      sortOrder: "asc",
    });
    expect(JSON.parse(local.getItem(ORG_A_FILTER_KEY)!).id).toBe("filter-a");
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
    expect(state.agentMessages.activeRunId).toBeNull();
    state = reducer(state, { type });
    expect(state.agentMessages.activeRunId).toBeNull();
    expect(session.getItem(RUN_KEY)).toBeNull();

    state = reducer(state, agents.runIdReceived("run-current"));
    state = reducer(state, { type });
    expect(state.agentMessages.activeRunId).toBeNull();
    expect(session.getItem(RUN_KEY)).toBeNull();
  });
});

describe("files filter per organization", () => {
  it("keeps each organization's filter apart and loads it when the tab returns", async () => {
    const { reducer, files, local } = await fixture();
    let state = reducer(undefined, credentials("org-a"));
    expect(state.files.activeFilter.id).toBe("filter-a");

    state = reducer(state, { type: "auth/resetOrganizationScope" });
    state = reducer(state, credentials("org-b"));
    expect(state.files.activeFilter.id).toBeNull();
    state = reducer(
      state,
      files.setActiveFilter({ id: "filter-b", name: "Org B filter", criteria: { tagIds: ["b"] } }),
    );

    state = reducer(state, { type: "auth/resetOrganizationScope" });
    state = reducer(state, credentials("org-a"));
    expect(state.files.activeFilter.id).toBe("filter-a");

    state = reducer(state, files.clearActiveFilter());
    expect(local.getItem(ORG_A_FILTER_KEY)).toBeNull();
    expect(JSON.parse(local.getItem("uniffy-files-view:filter:org-b:user-b")!).id).toBe("filter-b");

    state = reducer(state, credentials(null));
    expect(state.files.filterScope).toBeNull();
    expect(state.files.activeFilter.criteria).toBeNull();
  });

  it("sign-out removes the user's stored filters in every organization", async () => {
    const { local } = await fixture();
    const { clearStoredFilesFilters } = await import("@/features/files/store/filesFilterStorage");
    local.setItem("uniffy-files-view:filter:org-b:user-b", JSON.stringify({ criteria: {} }));
    local.setItem("uniffy-files-view:filter:org-a:user-c", JSON.stringify({ criteria: {} }));

    clearStoredFilesFilters("user-b");

    expect(local.getItem(ORG_A_FILTER_KEY)).toBeNull();
    expect(local.getItem("uniffy-files-view:filter:org-b:user-b")).toBeNull();
    expect(local.getItem("uniffy-files-view:filter:org-a:user-c")).not.toBeNull();
    expect(local.getItem(FILES_VIEW_KEY)).not.toBeNull();
  });
});
