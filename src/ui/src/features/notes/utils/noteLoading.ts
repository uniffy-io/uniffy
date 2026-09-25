/** No note id means nothing is being loaded, even though `loadingNoteId` is also null then. */
export function isNoteLoading(
  loadingNoteId: string | null,
  noteId: string | null | undefined,
): boolean {
  return Boolean(noteId) && loadingNoteId === noteId;
}
