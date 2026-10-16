import { describe, expect, it } from "vitest";
import { combineReducers } from "@reduxjs/toolkit";
import { NodeType } from "@uniffy/proto/notes/v1/notes_pb";
import {
  notesReducer,
  removeNote,
  setCurrentNote,
  setNote,
} from "@/features/notes/store/notesSlice";
import { notesTreeReducer, type TreeNode } from "@/features/notes/store/notesTreeSlice";
import {
  deleteNote,
  fetchNote,
  initializeNotesData,
  type SerializedNote,
} from "@/features/notes/store/notesThunks";
import {
  chooseNotesLanding,
  isRoutedNoteLost,
  viewRoutedNote,
} from "@/features/notes/utils/landing";

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

describe("isRoutedNoteLost", () => {
  it("loses a note that is gone or was trashed while open", () => {
    expect(isRoutedNoteLost({}, "gone", false)).toBe(true);
    expect(
      isRoutedNoteLost({ trashed: note("trashed", NodeType.NOTE, true) }, "trashed", false),
    ).toBe(true);
    expect(isRoutedNoteLost({ open: note("open") }, "open", false)).toBe(false);
  });

  it("keeps a note opened from the trash", () => {
    expect(
      isRoutedNoteLost({ trashed: note("trashed", NodeType.NOTE, true) }, "trashed", true),
    ).toBe(false);
  });
});

describe("open note deleted or unshared", () => {
  const reducer = combineReducers({ notes: notesReducer, notesTree: notesTreeReducer });
  type State = ReturnType<typeof reducer>;
  const emptyTree = { personal: [], shared: [], organization: [], trash: [] };

  function row(id: string, title: string): SerializedNote {
    return { id, title, content: `${title} body`, nodeType: NodeType.NOTE } as SerializedNote;
  }

  function sidebar(state: State, section: keyof State["notesTree"]["tree"]): string[] {
    const ids: string[] = [];
    const walk = (nodes: TreeNode[]) => {
      for (const node of nodes) {
        ids.push(node.id);
        walk(node.children ?? []);
      }
    };
    walk(state.notesTree.tree[section]);
    return ids;
  }

  const node = (item: SerializedNote): TreeNode => ({
    id: item.id,
    title: item.title,
    type: "note",
  });
  const other = row("other", "Runbook");

  /** The notes page with `open` routed and on screen, the way it loads a note. */
  function openOnPage(open: SerializedNote, section: "personal" | "shared") {
    const tree =
      section === "shared"
        ? { ...emptyTree, shared: [node(open)], personal: [node(other)] }
        : { ...emptyTree, personal: [node(open), node(other)] };
    let state = reducer(undefined, { type: "init" });
    state = reducer(
      state,
      initializeNotesData.fulfilled(
        { notes: [open, other], tree, totalCount: 2 },
        "load",
        undefined,
      ),
    );
    state = reducer(state, setCurrentNote(open.id));
    state = reducer(state, fetchNote.fulfilled(open, "fetch", open.id));
    const shown = viewRoutedNote(state.notes.notes, open.id, false, null);
    expect(shown.lost).toBe(false);
    return { state, shown: shown.note };
  }

  it("keeps a note unshared while open on screen as last shown while the sidebar prunes it", () => {
    const open = row("unshared", "Shared plan");
    let { state, shown } = openOnPage(open, "shared");

    // The notification stream drops a note whose access went.
    state = reducer(state, removeNote(open.id));
    expect(state.notes.currentNoteId).toBeNull();
    expect(viewRoutedNote(state.notes.notes, open.id, false, shown)).toEqual({
      note: shown,
      lost: true,
    });

    // Its follow-up refresh rebuilds the sidebar without it.
    state = reducer(
      state,
      initializeNotesData.fulfilled(
        { notes: [other], tree: { ...emptyTree, personal: [node(other)] }, totalCount: 1 },
        "refresh",
        { forceRefresh: true },
      ),
    );
    expect(sidebar(state, "shared")).toEqual([]);
    expect(sidebar(state, "personal")).toEqual(["other"]);
    const view = viewRoutedNote(state.notes.notes, open.id, false, shown);
    expect(view).toEqual({ note: shown, lost: true });
    expect(view.note?.content).toBe("Shared plan body");
  });

  it("keeps a note moved to the trash while open on screen as last shown, listed only in the trash", () => {
    const open = row("trashed", "Draft plan");
    let { state, shown } = openOnPage(open, "personal");

    state = reducer(
      state,
      deleteNote.fulfilled({ noteId: open.id, permanent: false }, "delete", { noteId: open.id }),
    );
    expect(state.notes.notes[open.id].isDeleted).toBe(true);
    expect(sidebar(state, "personal")).toEqual(["other"]);
    expect(sidebar(state, "trash")).toEqual([open.id]);
    const view = viewRoutedNote(state.notes.notes, open.id, false, shown);
    expect(view.lost).toBe(true);
    expect(view.note).toBe(shown);
    expect(view.note?.isDeleted).toBeFalsy();
  });

  it("shows the stored note again when it comes back while on screen", () => {
    const open = row("restored", "Plan");
    let { state, shown } = openOnPage(open, "personal");
    state = reducer(
      state,
      deleteNote.fulfilled({ noteId: open.id, permanent: false }, "delete", { noteId: open.id }),
    );
    expect(viewRoutedNote(state.notes.notes, open.id, false, shown).lost).toBe(true);

    const restored = { ...open, content: "Plan body, restored" };
    state = reducer(state, setNote(restored));
    expect(viewRoutedNote(state.notes.notes, open.id, false, shown)).toEqual({
      note: restored,
      lost: false,
    });
  });

  it("lets go of the lost note once the user navigates", () => {
    const open = row("left", "Old plan");
    let { state, shown } = openOnPage(open, "personal");
    state = reducer(state, removeNote(open.id));

    expect(viewRoutedNote(state.notes.notes, "other", false, shown)).toEqual({
      note: state.notes.notes.other,
      lost: false,
    });
    expect(viewRoutedNote(state.notes.notes, "missing", false, shown)).toEqual({
      note: null,
      lost: true,
    });
  });
});
