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

/** Whether the page should leave the routed note it loaded: the note is gone, or was moved to the
 * trash while open. A note opened from the trash stays, so it can be read and restored. */
export function leavesRoutedNote(
  notes: Record<string, SerializedNote>,
  noteId: string,
  openedFromTrash: boolean,
): boolean {
  const note = notes[noteId];
  return !note || (Boolean(note.isDeleted) && !openedFromTrash);
}
