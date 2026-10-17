import { describe, expect, it } from "vitest";
import { ContentRole } from "@uniffy/proto/common/v1/common_pb";
import { noteAffordances } from "@/features/notes/utils/noteAffordances";

describe("noteAffordances", () => {
  it("offers neither editing nor sharing on a lost note, even to its owner", () => {
    expect(noteAffordances(ContentRole.OWNER, true, "access_lost")).toEqual({
      canEdit: false,
      canShare: false,
    });
    expect(noteAffordances(ContentRole.ADMIN, true, "connected")).toEqual({
      canEdit: false,
      canShare: false,
    });
  });

  it("lets a manager edit and share a live note", () => {
    expect(noteAffordances(ContentRole.OWNER, false, "connected")).toEqual({
      canEdit: true,
      canShare: true,
    });
  });

  it("keeps sharing from an editor and both from a viewer", () => {
    expect(noteAffordances(ContentRole.EDITOR, false, "connected")).toEqual({
      canEdit: true,
      canShare: false,
    });
    expect(noteAffordances(ContentRole.VIEWER, false, "connected")).toEqual({
      canEdit: false,
      canShare: false,
    });
  });

  it("stops editing once the session loses access, is refused or is revoked", () => {
    for (const status of [
      "permission_lost",
      "access_lost",
      "update_rejected",
      "token_revoked",
    ] as const)
      expect(noteAffordances(ContentRole.EDITOR, false, status).canEdit).toBe(false);
    for (const status of ["connecting", "disconnected", "offline"] as const)
      expect(noteAffordances(ContentRole.EDITOR, false, status).canEdit).toBe(true);
  });

  it("allows editing while the role is still loading", () => {
    expect(noteAffordances(null, false, "connecting")).toEqual({ canEdit: true, canShare: false });
  });
});
