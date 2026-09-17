import { describe, expect, it } from "vitest";
import { AccessMode, ContentRole } from "@uniffy/proto/common/v1/common_pb";
import {
  filesReducer,
  initializeFilesData,
  setCurrentFile,
  toggleFileSelection,
} from "../filesSlice";
import type { SerializedFile } from "../filesThunks";

function file(id: string, overrides: Partial<SerializedFile> = {}): SerializedFile {
  return {
    id,
    urn: `urn:uniffy:content:FILE:${id}`,
    organizationId: "org-1",
    ownerId: "user-1",
    accessMode: AccessMode.EXPLICIT_MEMBERS,
    baselineRole: null,
    userRole: ContentRole.VIEWER,
    filename: `${id}.txt`,
    originalFilename: `${id}.txt`,
    mimeType: "text/plain",
    sizeBytes: 1,
    folderId: undefined,
    tagIds: [],
    description: undefined,
    version: 1,
    extractionStatus: 0,
    transcodeStatus: 0,
    playbackStatus: 0,
    isDeleted: false,
    createdAt: undefined,
    updatedAt: undefined,
    deletedAt: undefined,
    groupIds: [],
    ownerInfo: undefined,
    metadata: undefined,
    ...overrides,
  };
}

describe("filesSlice initializeFilesData", () => {
  it("prunes rows missing from a forceRefresh payload and repairs selection", () => {
    let state = filesReducer(
      undefined,
      initializeFilesData.fulfilled({ files: [file("a"), file("b")], totalCount: 2 }, "r1", {
        forceRefresh: true,
      }),
    );
    state = filesReducer(state, setCurrentFile("b"));
    state = filesReducer(state, toggleFileSelection("a"));
    state = filesReducer(state, toggleFileSelection("b"));

    state = filesReducer(
      state,
      initializeFilesData.fulfilled({ files: [file("a")], totalCount: 1 }, "r2", {
        forceRefresh: true,
      }),
    );

    expect(Object.keys(state.files)).toEqual(["a"]);
    expect(state.currentFileId).toBeNull();
    expect(state.selectedFileIds).toEqual(["a"]);
    expect(state.lastSelectedId).toBeNull();
    expect(state.lastSelectedType).toBeNull();
  });

  it("keeps rows the payload still contains on forceRefresh", () => {
    let state = filesReducer(
      undefined,
      initializeFilesData.fulfilled({ files: [file("a"), file("b")], totalCount: 2 }, "r1", {
        forceRefresh: true,
      }),
    );
    state = filesReducer(state, setCurrentFile("a"));

    state = filesReducer(
      state,
      initializeFilesData.fulfilled({ files: [file("a"), file("b")], totalCount: 2 }, "r2", {
        forceRefresh: true,
      }),
    );

    expect(Object.keys(state.files).sort()).toEqual(["a", "b"]);
    expect(state.currentFileId).toBe("a");
  });

  it("merges without pruning when not a forceRefresh", () => {
    let state = filesReducer(
      undefined,
      initializeFilesData.fulfilled(
        { files: [file("a"), file("b")], totalCount: 2 },
        "r1",
        undefined,
      ),
    );

    state = filesReducer(
      state,
      initializeFilesData.fulfilled({ files: [file("b")], totalCount: 1 }, "r2", undefined),
    );

    expect(Object.keys(state.files).sort()).toEqual(["a", "b"]);
  });
});
