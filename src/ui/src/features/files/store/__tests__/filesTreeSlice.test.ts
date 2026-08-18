import { describe, expect, it } from "vitest";
import { AccessMode } from "@uniffy/proto/common/v1/common_pb";
import {
  createFolder,
  fetchFilesTree,
  filesTreeReducer,
  setSelectedFolder,
} from "../filesTreeSlice";
import type { SerializedTreeNode } from "../filesTreeThunks";

function folderNode(id: string, accessMode: AccessMode): SerializedTreeNode {
  return {
    id,
    name: id,
    isFolder: true,
    parentId: undefined,
    accessMode,
    childCount: 0,
    children: [],
  };
}

describe("filesTreeSlice fetchFilesTree", () => {
  it("drops folders missing from the fresh payload out of the index", () => {
    let state = filesTreeReducer(
      undefined,
      fetchFilesTree.fulfilled(
        {
          nodes: [
            folderNode("kept", AccessMode.OWNER_ONLY),
            folderNode("revoked", AccessMode.EXPLICIT_MEMBERS),
          ],
        },
        "r1",
        undefined,
      ),
    );
    expect(state.folders.revoked).toBeDefined();
    state = filesTreeReducer(state, setSelectedFolder("revoked"));

    state = filesTreeReducer(
      state,
      fetchFilesTree.fulfilled(
        { nodes: [folderNode("kept", AccessMode.OWNER_ONLY)] },
        "r2",
        undefined,
      ),
    );

    expect(state.folders.revoked).toBeUndefined();
    expect(state.folders.kept).toBeDefined();
    expect(state.selectedFolderId).toBeNull();
  });

  it("keeps the owner learned from folder CRUD across refetches", () => {
    let state = filesTreeReducer(
      undefined,
      createFolder.fulfilled(
        {
          id: "f1",
          name: "Docs",
          parentId: undefined,
          accessMode: AccessMode.OWNER_ONLY,
          ownerId: "user-1",
          isDeleted: false,
        },
        "r1",
        { name: "Docs" },
      ),
    );

    state = filesTreeReducer(
      state,
      fetchFilesTree.fulfilled(
        { nodes: [folderNode("f1", AccessMode.OWNER_ONLY)] },
        "r2",
        undefined,
      ),
    );

    expect(state.folders.f1.ownerId).toBe("user-1");
  });
});
