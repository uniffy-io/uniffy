import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { useAppSelector } from "@/app/hooks";
import { realtimeMultiplexer, type DocSubscription } from "@/features/realtime/multiplexer";
import {
  attachEncryptedPersistence,
  type EncryptedPersistence,
} from "@/features/realtime/persistence/encryptedYjsPersistence";
import { type RealtimeStatus, statusFromCloseCode } from "@/features/realtime/protocol";
import { randomUUID } from "@/shared/utils/uuid";

export interface DocSession {
  ydoc: Y.Doc;
  awareness: Awareness;
  undoManager: Y.UndoManager | null;
  status: RealtimeStatus;
  sessionId: string;
  /** Resolves once the first server `sync` AND the local IDB replay are done. */
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

// Seed-time writers gate on the composed promise. Resolving before the IDB
// replay finishes lets a fast SyncStep2 race offline edits into a duplicated
// document, and a failed hydrate must not wedge the gate.
export function composeWhenSynced(
  serverSynced: Promise<void>,
  hydrated: Promise<void>,
): Promise<void> {
  const hydrationComplete = hydrated.catch((err) => {
    console.warn("[realtime] persistence hydrate failed", err);
  });
  return Promise.all([serverSynced, hydrationComplete]).then(() => undefined);
}

export function useDocSession(opts: UseDocSessionOptions): DocSession | null {
  const { contentType, contentId, enabled, undoTarget, captureTimeout } = opts;
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  const [status, setStatus] = useState<RealtimeStatus>("idle");
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
    const sessionId = randomUUID();

    const persistence = attachEncryptedPersistence({
      contentType,
      contentId,
      ydoc,
    });
    const whenHydrated = persistence.hydrate();

    const targets = Array.isArray(undoTarget) ? undoTarget : undoTarget ? [undoTarget] : null;
    const undoManager = targets
      ? new Y.UndoManager(targets, {
          trackedOrigins: new Set([sessionId]),
          captureTimeout: captureTimeout ?? 500,
        })
      : null;

    let resolveServerSync!: () => void;
    const whenServerSynced = new Promise<void>((resolve) => {
      resolveServerSync = resolve;
    });
    const whenSynced = composeWhenSynced(whenServerSynced, whenHydrated);

    const subscription = realtimeMultiplexer.attach({
      contentType,
      contentId,
      ydoc,
      awareness,
      onStatus: (next) => setStatus(next),
      onSync: () => resolveServerSync(),
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
    // The effect owns the session objects, so a bump is the only way the memo
    // below learns they exist. One extra render per session, not per keystroke.
    // eslint-disable-next-line react/react-compiler -- republishes the effect-created session
    setTick((t) => t + 1);

    return () => {
      subscription.destroy();
      undoManager?.destroy();
      awareness.destroy();
      void persistence.destroy().finally(() => ydoc.destroy());
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, contentType, contentId, organizationId]);

  // Y.Doc / Awareness / UndoManager identities must survive every re-render -
  // recreating them would drop the CRDT state and the undo history - so the ref
  // holds them and `tick` is the invalidation signal for this memo.
  /* eslint-disable react/react-compiler -- ref-held session republished through `tick` */
  return useMemo<DocSession | null>(() => {
    if (!enabled) return null;
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
  }, [status, tick, enabled]);
  /* eslint-enable react/react-compiler */
}
