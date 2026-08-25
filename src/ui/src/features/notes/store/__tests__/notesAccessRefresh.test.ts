import { describe, expect, it } from "vitest";
import { initializeNotesData, type SerializedNote } from "@/features/notes/store/notesThunks";
import { notesReducer, setCurrentNote, setNote } from "@/features/notes/store/notesSlice";

const emptyTree = {
  personal: [],
  shared: [],
  organization: [],
  trash: [],
};

const note = {
  id: "private-note",
  title: "Private note",
  content: "Secret",
} as SerializedNote;

describe("notes access refresh", () => {
  it("prunes notes that are absent from an authoritative access refresh", () => {
    let state = notesReducer(undefined, setNote(note));
    state = notesReducer(state, setCurrentNote(note.id));

    state = notesReducer(
      state,
      initializeNotesData.fulfilled({ notes: [], tree: emptyTree, totalCount: 0 }, "refresh-1", {
        forceRefresh: true,
      }),
    );

    expect(state.notes[note.id]).toBeUndefined();
    expect(state.currentNoteId).toBeNull();
  });

  it("does not prune targeted rows during an ordinary initialization", () => {
    let state = notesReducer(undefined, setNote(note));
    state = notesReducer(
      state,
      initializeNotesData.fulfilled(
        { notes: [], tree: emptyTree, totalCount: 0 },
        "load-1",
        undefined,
      ),
    );

    expect(state.notes[note.id]).toBeDefined();
  });
});
