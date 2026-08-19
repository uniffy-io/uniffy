import { describe, expect, it } from "vitest";
import { AccessMode, ContentRole, ContentType } from "@uniffy/proto/common/v1/common_pb";
import {
  clearContentMembers,
  permissionsReducer,
  type PermissionsState,
} from "@/features/permissions/store/permissionsSlice";
import { fetchContentMembers } from "@/features/permissions/store/permissionsThunks";

function loadedEntry(
  state: PermissionsState | undefined,
  contentType: number,
  contentId: string,
): PermissionsState {
  return permissionsReducer(
    state,
    fetchContentMembers.fulfilled(
      {
        policy: {
          ownerId: "owner-1",
          accessMode: AccessMode.EXPLICIT_MEMBERS,
          baselineRole: null,
          callerRole: ContentRole.OWNER,
          effectiveAccessMode: AccessMode.EXPLICIT_MEMBERS,
        },
        members: [],
      },
      `members-${contentId}`,
      { contentType, contentId },
    ),
  );
}

describe("permissionsSlice clearContentMembers", () => {
  it("deletes only the targeted content entry", () => {
    let state = loadedEntry(undefined, ContentType.FILE, "file-1");
    state = loadedEntry(state, ContentType.NOTE, "note-1");

    state = permissionsReducer(
      state,
      clearContentMembers({ contentType: ContentType.FILE, contentId: "file-1" }),
    );

    expect(state.byContent[`${ContentType.FILE}:file-1`]).toBeUndefined();
    expect(state.byContent[`${ContentType.NOTE}:note-1`]).toBeDefined();
  });
});
