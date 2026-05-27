import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { useAppSelector } from '@/app/hooks';
import { useDocSession, type RealtimeStatus } from '@/features/realtime';
import { PROSEMIRROR_FRAGMENT_FIELD } from '@/features/notes/realtime/markdown';
import { resolveAwarenessColor } from '@/features/notes/realtime/awarenessColor';
import type { CrepeRealtimeBinding } from '@/components/editor/CrepeEditor';

export function useNoteRealtimeSession(
  noteId: string | null,
  enabled: boolean,
): {
  binding: CrepeRealtimeBinding | null;
  status: RealtimeStatus;
} {
  const session = useDocSession({
    contentType: 'NOTE',
    contentId: noteId,
    enabled: enabled && Boolean(noteId),
  });

  const user = useAppSelector((state) => state.auth.user);
  const [undoManager, setUndoManager] = useState<Y.UndoManager | null>(null);

  useEffect(() => {
    if (!session) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset undo manager when the session drops
      setUndoManager(null);
      return;
    }

    const fragment = session.ydoc.get(PROSEMIRROR_FRAGMENT_FIELD, Y.XmlFragment);
    const manager = new Y.UndoManager([fragment], {
      trackedOrigins: new Set([session.sessionId]),
      captureTimeout: 500,
    });
    setUndoManager(manager);

    return () => {
      manager.destroy();
      setUndoManager(null);
    };
  }, [session]);

  // Awareness user payload in its own effect so avatar/name changes do not rebuild UndoManager (would drop undo history).
  useEffect(() => {
    if (!session) return;
    const { solid, translucent } = resolveAwarenessColor(
      user?.accentColor,
      user?.id ?? session.sessionId,
    );
    session.awareness.setLocalStateField('user', {
      id: user?.id ?? null,
      name: user?.fullName ?? user?.username ?? 'Anonymous',
      color: solid,
      colorLight: translucent,
      avatarUrl: user?.avatarUrl ?? null,
      hasAvatar: user?.hasAvatar ?? false,
    });
  }, [
    session,
    user?.id,
    user?.fullName,
    user?.username,
    user?.accentColor,
    user?.hasAvatar,
    user?.avatarUrl,
  ]);

  const binding = useMemo<CrepeRealtimeBinding | null>(() => {
    if (!session) return null;
    return {
      ydoc: session.ydoc,
      awareness: session.awareness,
      undoManager,
      sessionId: session.sessionId,
      whenSynced: session.whenSynced,
    };
  }, [session, undoManager]);

  return { binding, status: session?.status ?? 'idle' };
}
