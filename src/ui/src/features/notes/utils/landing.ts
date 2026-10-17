import { NodeType } from "@uniffy/proto/notes/v1/notes_pb";
import type { SerializedNote } from "@/features/notes/store/notesThunks";

export function chooseNotesLanding(
  notes: Record<string, SerializedNote>,
  lastOpenedId: string | null,
): string | null {
  const accessible = Object.values(notes).filter((note) => !note.isDeleted);
  if (lastOpenedId && accessible.some((note) => note.id === lastOpenedId)) {
    return lastOpenedId;
  }

  return (
    accessible.find((note) => note.nodeType !== NodeType.FOLDER)?.id ?? accessible[0]?.id ?? null
  );
}

/** The routed note the page loaded is gone for this user: deleted, unshared, or moved to the trash
 * while open. A note opened from the trash is not lost, so it can be read and restored. */
export function isRoutedNoteLost(
  notes: Record<string, SerializedNote>,
  noteId: string,
  openedFromTrash: boolean,
): boolean {
  const note = notes[noteId];
  return !note || (Boolean(note.isDeleted) && !openedFromTrash);
}

export interface RoutedNoteView {
  /** The row to show: the stored one while the note is open, the last one shown once it is lost. */
  note: SerializedNote | null;
  lost: boolean;
}

/** What the page shows for its routed note. A lost note stays on screen, read-only, as last shown
 * until the user navigates, so the editor never jumps to another note under a deletion. */
export function viewRoutedNote(
  notes: Record<string, SerializedNote>,
  noteId: string,
  openedFromTrash: boolean,
  shown: SerializedNote | null,
): RoutedNoteView {
  if (!isRoutedNoteLost(notes, noteId, openedFromTrash))
    return { note: notes[noteId], lost: false };
  return { note: shown?.id === noteId ? shown : null, lost: true };
}
