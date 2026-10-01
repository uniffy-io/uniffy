import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { useAppSelector } from "@/app/hooks";
import { docNameFor } from "@/features/realtime/docNames";
import { docGeneration } from "@/features/realtime/docGeneration";
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
  /** Drop the local encrypted cache when the session closes synced with nothing unsent. The
   * server then holds everything, and a replayed stale cache can no longer win over a plain
   * write made before the next open. Offline and crashed closes keep the cache. */
  discardLocalOnCleanClose?: boolean;
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
  const {
    contentType,
    contentId,
    enabled,
    undoTarget,
    captureTimeout,
    discardLocalOnCleanClose = false,
  } = opts;
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
    let chooseReplay!: (options: { serverGeneration: string | null } | undefined) => void;
    const replayGate = new Promise<{ serverGeneration: string | null } | undefined>((resolve) => {
      chooseReplay = resolve;
    });
    let hydrationComplete = false;
    const whenHydrated = replayGate
      .then((options) => persistence.hydrate(options))
      .then(() => {
        hydrationComplete = true;
      });

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
    let serverSynced = false;
    let transportStatus: RealtimeStatus = "idle";

    const subscription = realtimeMultiplexer.attach({
      contentType,
      contentId,
      ydoc,
      awareness,
      onStatus: (next) => {
        transportStatus = next;
        // Once replay starts offline, reconnect cannot unmerge that state.
        if (next === "disconnected" || next === "offline") chooseReplay(undefined);
        setStatus(next);
      },
      onSync: () => {
        chooseReplay({ serverGeneration: docGeneration(ydoc) });
        serverSynced = true;
        resolveServerSync();
      },
      onCloseCode: (code) => {
        const mapped = statusFromCloseCode(code);
        if (mapped) setStatus(mapped);
      },
      // Doc-scoped, unlike a 4403 close: only this editor flips to view-only.
      onWriteDenied: () => setStatus("permission_lost"),
    });
    if (!navigator.onLine) chooseReplay(undefined);

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
      // Read before detach: the multiplexer forgets the doc's outbound state on destroy.
      const cleanClose =
        discardLocalOnCleanClose &&
        serverSynced &&
        hydrationComplete &&
        transportStatus === "connected" &&
        !realtimeMultiplexer.isOutboundPending(docNameFor(contentType, contentId));
      subscription.destroy();
      undoManager?.destroy();
      awareness.destroy();
      void persistence.destroy({ discard: cleanClose }).finally(() => ydoc.destroy());
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, contentType, contentId, organizationId, discardLocalOnCleanClose]);

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
