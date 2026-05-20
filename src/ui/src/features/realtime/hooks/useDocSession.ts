import { useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { useAppSelector } from '@/app/hooks';
import {
  realtimeMultiplexer,
  type DocSubscription,
} from '@/features/realtime/multiplexer';
import {
  attachEncryptedPersistence,
  type EncryptedPersistence,
} from '@/features/realtime/persistence/encryptedYjsPersistence';
import {
  type RealtimeStatus,
  statusFromCloseCode,
} from '@/features/realtime/protocol';

export interface DocSession {
  ydoc: Y.Doc;
  awareness: Awareness;
  undoManager: Y.UndoManager | null;
  status: RealtimeStatus;
  sessionId: string;
  /** Resolves on first server `sync` for this doc. */
  whenSynced: Promise<void>;
}

export interface UseDocSessionOptions {
  contentType: string;
  contentId: string | null;
  enabled: boolean;
  /** Y types whose origin-tagged transactions the UndoManager should track
   * (e.g. the markdown `Y.XmlFragment` the editor binding targets). */
  undoTarget?: Y.AbstractType<unknown> | Y.AbstractType<unknown>[] | null;
  captureTimeout?: number;
}

function newSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export function useDocSession(opts: UseDocSessionOptions): DocSession | null {
  const { contentType, contentId, enabled, undoTarget, captureTimeout } = opts;
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  const [status, setStatus] = useState<RealtimeStatus>('idle');
  const sessionRef = useRef<{
    ydoc: Y.Doc;
    awareness: Awareness;
    undoManager: Y.UndoManager | null;
    sessionId: string;
    subscription: DocSubscription;
    persistence: EncryptedPersistence;
    whenSynced: Promise<void>;
  } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || !contentId || !organizationId) {
      return;
    }

    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const sessionId = newSessionId();

    const persistence = attachEncryptedPersistence({
      contentType,
      contentId,
      ydoc,
    });
    void persistence.hydrate();

    const targets = Array.isArray(undoTarget)
      ? undoTarget
      : undoTarget
        ? [undoTarget]
        : null;
    const undoManager = targets
      ? new Y.UndoManager(targets, {
          trackedOrigins: new Set([sessionId]),
          captureTimeout: captureTimeout ?? 500,
        })
      : null;

    let resolveSync!: () => void;
    const whenSynced = new Promise<void>((resolve) => {
      resolveSync = resolve;
    });

    const subscription = realtimeMultiplexer.attach({
      contentType,
      contentId,
      ydoc,
      awareness,
      onStatus: (next) => setStatus(next),
      onSync: () => resolveSync(),
      onCloseCode: (code) => {
        const mapped = statusFromCloseCode(code);
        if (mapped) setStatus(mapped);
      },
    });

    sessionRef.current = {
      ydoc,
      awareness,
      undoManager,
      sessionId,
      subscription,
      persistence,
      whenSynced,
    };
    setTick((t) => t + 1);

    return () => {
      subscription.destroy();
      undoManager?.destroy();
      awareness.destroy();
      void persistence.destroy();
      ydoc.destroy();
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, contentType, contentId, organizationId]);

  return useMemo<DocSession | null>(() => {
    const current = sessionRef.current;
    if (!current) return null;
    return {
      ydoc: current.ydoc,
      awareness: current.awareness,
      undoManager: current.undoManager,
      sessionId: current.sessionId,
      status,
      whenSynced: current.whenSynced,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, tick]);
}
