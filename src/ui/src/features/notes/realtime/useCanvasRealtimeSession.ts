import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { useAppSelector } from '@/app/hooks';
import { useDocSession, type RealtimeStatus } from '@/features/realtime';
import {
  Y_CANVAS_DEFAULTS_FIELD,
  Y_CANVAS_EDGES_FIELD,
  Y_CANVAS_NODES_FIELD,
  Y_CANVAS_ORDER_FIELD,
  getCanvasYTypes,
} from '@/features/notes/realtime/canvasBinding';

export interface CanvasRealtimeBinding {
  ydoc: Y.Doc;
  awareness: import('y-protocols/awareness').Awareness;
  sessionId: string;
  undoManager: Y.UndoManager;
  whenSynced: Promise<void>;
  yNodes: Y.Map<Y.Map<unknown>>;
  yEdges: Y.Map<Y.Map<unknown>>;
  yOrder: Y.Array<string>;
  yDefaults: Y.Map<unknown>;
}

export function useCanvasRealtimeSession(
  noteId: string | null,
  enabled: boolean,
): {
  binding: CanvasRealtimeBinding | null;
  status: RealtimeStatus;
} {
  const session = useDocSession({
    contentType: 'NOTE',
    contentId: noteId,
    enabled: enabled && Boolean(noteId),
  });

  const user = useAppSelector((state) => state.auth.user);
  const undoRef = useRef<Y.UndoManager | null>(null);
  const [undoManager, setUndoManager] = useState<Y.UndoManager | null>(null);

  useEffect(() => {
    if (!session) {
      undoRef.current?.destroy();
      undoRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset undo manager when the session drops
      setUndoManager(null);
      return;
    }

    // Touch Y roots up front so observers see stable references and UndoManager can scope to them.
    const { nodes, edges, order, defaults } = getCanvasYTypes(session.ydoc);
    void nodes;
    void edges;
    void order;
    void defaults;

    const manager = new Y.UndoManager(
      [
        session.ydoc.get(Y_CANVAS_NODES_FIELD, Y.Map),
        session.ydoc.get(Y_CANVAS_EDGES_FIELD, Y.Map),
        session.ydoc.get(Y_CANVAS_ORDER_FIELD, Y.Array),
        session.ydoc.get(Y_CANVAS_DEFAULTS_FIELD, Y.Map),
      ],
      {
        trackedOrigins: new Set([session.sessionId]),
        captureTimeout: 300,
      },
    );
    undoRef.current = manager;
    setUndoManager(manager);

    return () => {
      manager.destroy();
      undoRef.current = null;
      setUndoManager(null);
    };
  }, [session]);

  // Awareness user payload in its own effect so avatar/name changes do not rebuild UndoManager.
  useEffect(() => {
    if (!session) return;
    session.awareness.setLocalStateField('user', {
      id: user?.id ?? null,
      // Peers paint carets, labels and avatars from the name via
      // ``identityPaint``, so no color travels on the wire.
      name: user?.fullName ?? user?.username ?? 'Anonymous',
      avatarUrl: user?.avatarUrl ?? null,
      hasAvatar: user?.hasAvatar ?? false,
    });
  }, [
    session,
    user?.id,
    user?.fullName,
    user?.username,
    user?.hasAvatar,
    user?.avatarUrl,
  ]);

  const binding = useMemo<CanvasRealtimeBinding | null>(() => {
    if (!session || !undoManager) return null;
    const { nodes, edges, order, defaults } = getCanvasYTypes(session.ydoc);
    return {
      ydoc: session.ydoc,
      awareness: session.awareness,
      sessionId: session.sessionId,
      undoManager,
      whenSynced: session.whenSynced,
      yNodes: nodes,
      yEdges: edges,
      yOrder: order,
      yDefaults: defaults,
    };
  }, [session, undoManager]);

  return { binding, status: session?.status ?? 'idle' };
}
