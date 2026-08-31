import { describe, expect, it } from "vitest";
import { clearTrash, trashReducer, type TrashState } from "@/features/files/store/trashSlice";

describe("trashSlice", () => {
  it("clears rendered trash items before their bytes are removed", () => {
    const state = {
      files: [{ id: "file-1" }],
      folders: [{ id: "folder-1" }],
      loading: false,
      error: null,
      currentFolderId: "folder-1",
    } as TrashState;

    expect(trashReducer(state, clearTrash())).toMatchObject({
      files: [],
      folders: [],
      currentFolderId: null,
    });
  });
});
