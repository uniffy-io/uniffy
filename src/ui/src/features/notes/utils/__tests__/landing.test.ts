import { describe, expect, it } from "vitest";
import { NodeType } from "@uniffy/proto/notes/v1/notes_pb";
import type { SerializedNote } from "@/features/notes/store/notesThunks";
import { chooseNotesLanding } from "@/features/notes/utils/landing";

function note(id: string, nodeType = NodeType.NOTE, isDeleted = false): SerializedNote {
  return { id, nodeType, isDeleted } as SerializedNote;
}

describe("chooseNotesLanding", () => {
  it("keeps an accessible last-opened item", () => {
    const notes = { first: note("first"), recent: note("recent") };

    expect(chooseNotesLanding(notes, "recent")).toBe("recent");
  });

  it("falls back to the first active note when the saved item is stale", () => {
    const notes = {
      folder: note("folder", NodeType.FOLDER),
      deleted: note("deleted", NodeType.NOTE, true),
      first: note("first"),
    };

    expect(chooseNotesLanding(notes, "missing")).toBe("first");
  });

  it("returns null for an empty notes workspace", () => {
    expect(chooseNotesLanding({ deleted: note("deleted", NodeType.NOTE, true) }, null)).toBeNull();
  });
});
