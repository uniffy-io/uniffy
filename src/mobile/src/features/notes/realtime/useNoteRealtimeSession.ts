import { useEffect } from "react";
import { useAuth } from "@core/providers/AuthContext";
import { useDocSession, type DocSession } from "@shared/realtime/useDocSession";

export interface UseNoteRealtimeSessionOptions {
  noteId: string | null | undefined;
  enabled: boolean;
  readOnly?: boolean;
}

/**
 * Realtime session for one note doc. Broadcasts the awareness identity peers
 * render; no color travels on the wire - every client derives paint from the
 * name hash, so a person looks the same on every surface.
 */
export function useNoteRealtimeSession(opts: UseNoteRealtimeSessionOptions): DocSession | null {
  const { user } = useAuth();
  const session = useDocSession({
    contentType: "NOTE",
    contentId: opts.noteId,
    enabled: opts.enabled,
    readOnly: opts.readOnly,
  });

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

  return session;
}
