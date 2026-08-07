import { useEffect } from "react";
import { useAuth } from "@core/providers/AuthContext";
import { useDocSession, type DocSessionState } from "@shared/realtime/useDocSession";

export interface UseNoteRealtimeSessionOptions {
  noteId: string | null | undefined;
  enabled: boolean;
  readOnly?: boolean;
  onBeforeDetach?: () => void;
}

/**
 * Realtime session for one note doc. Broadcasts the awareness identity peers
 * render; no color travels on the wire - every client derives paint from the
 * name hash, so a person looks the same on every surface.
 */
export function useNoteRealtimeSession(opts: UseNoteRealtimeSessionOptions): DocSessionState {
  const { user } = useAuth();
  const state = useDocSession({
    contentType: "NOTE",
    contentId: opts.noteId,
    enabled: opts.enabled,
    readOnly: opts.readOnly,
    onBeforeDetach: opts.onBeforeDetach,
  });

  const session = state.session;
  const userId = user?.id ?? null;
  const userName = user?.fullName || user?.username || "Anonymous";
  const avatarUrl = user?.avatarUrl || null;

  useEffect(() => {
    if (!session) return;
    session.awareness.setLocalStateField("user", {
      id: userId,
      name: userName,
      avatarUrl,
      hasAvatar: !!avatarUrl,
    });
  }, [session, userId, userName, avatarUrl]);

  return state;
}
