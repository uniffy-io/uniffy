import { useEffect } from "react";
import { useMarkdownDocSession } from "@/features/realtime/hooks/useMarkdownDocSession";
import { registerLiveNoteDoc } from "@/features/notes/realtime/liveNoteDocs";

export function useNoteRealtimeSession(noteId: string | null, enabled: boolean, canEdit = true) {
  const session = useMarkdownDocSession({
    contentType: "NOTE",
    contentId: noteId,
    enabled,
    canEdit,
  });
  const ydoc = session.binding?.ydoc;
  const whenSynced = session.binding?.whenSynced;
  useEffect(() => {
    if (!ydoc || !whenSynced || !noteId) return;
    return registerLiveNoteDoc(noteId, { ydoc, whenSynced });
  }, [ydoc, whenSynced, noteId]);
  return session;
}
