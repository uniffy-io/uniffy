import { useEffect, useMemo, useState } from "react";
import * as Y from "yjs";
import { useAppSelector } from "@/app/hooks";
import {
  realtimeMultiplexer,
  useDocSession,
  useOutboundSyncing,
  type RealtimeStatus,
} from "@/features/realtime";
import { PROSEMIRROR_FRAGMENT_FIELD } from "@/features/notes/realtime/markdown";
import { registerLiveNoteDoc } from "@/features/notes/realtime/liveNoteDocs";
import type { CrepeRealtimeBinding } from "@/components/editor/CrepeEditor";

export function useNoteRealtimeSession(
  noteId: string | null,
  enabled: boolean,
  canEdit: boolean = true,
): {
  binding: CrepeRealtimeBinding | null;
  status: RealtimeStatus;
} {
  const session = useDocSession({
    contentType: "NOTE",
    contentId: noteId,
    enabled: enabled && Boolean(noteId),
  });

  const user = useAppSelector((state) => state.auth.user);
  const [undoManager, setUndoManager] = useState<Y.UndoManager | null>(null);

  const docName = noteId ? `NOTE:${noteId}` : null;

  // The server closes read-only sockets on any SYNC write frame; the flag
  // makes the multiplexer suppress them (IDB hydration replays included).
  useEffect(() => {
    if (!session || !docName) return;
    realtimeMultiplexer.setDocReadOnly(docName, !canEdit);
  }, [session, docName, canEdit]);

  // Sibling surfaces (metadata panel) read the live doc through the registry.
  useEffect(() => {
    if (!session || !noteId) return;
    return registerLiveNoteDoc(noteId, {
      ydoc: session.ydoc,
      whenSynced: session.whenSynced,
    });
  }, [session, noteId]);

  useEffect(() => {
    if (!session || !canEdit) {
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
  }, [session, canEdit]);

  // Awareness user payload in its own effect so avatar/name changes do not rebuild UndoManager (would drop undo history).
  useEffect(() => {
    if (!session) return;
    session.awareness.setLocalStateField("user", {
      id: user?.id ?? null,
      // Peers paint carets, labels and avatars from the name via
      // ``identityPaint``, so no color travels on the wire.
      name: user?.fullName ?? user?.username ?? "Anonymous",
      avatarUrl: user?.avatarUrl ?? null,
      hasAvatar: user?.hasAvatar ?? false,
    });
  }, [session, user?.id, user?.fullName, user?.username, user?.hasAvatar, user?.avatarUrl]);

  const syncing = useOutboundSyncing(docName);

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

  const baseStatus = session?.status ?? "idle";
  const status: RealtimeStatus =
    syncing &&
    (baseStatus === "connected" || baseStatus === "connecting" || baseStatus === "disconnected")
      ? "syncing"
      : baseStatus;

  return { binding, status };
}
