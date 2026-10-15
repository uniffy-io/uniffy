import { useEffect, useMemo, useRef, useState } from "react";
import { abortDrain } from "@/features/realtime/drain";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { useAppSelector } from "@/app/hooks";
import { docNameFor } from "@/features/realtime/docNames";
import { docGeneration } from "@/features/realtime/docGeneration";
import { useOutboundPending } from "@/features/realtime/hooks/useOutboundPending";
import {
  realtimeMultiplexer,
  type DocSubscription,
  type FragmentSeeder,
} from "@/features/realtime/multiplexer";
import { clearPendingDoc } from "@/features/realtime/pendingDocs";
import {
  attachEncryptedPersistence,
  type EncryptedPersistence,
} from "@/features/realtime/persistence/encryptedYjsPersistence";
import {
  SEED_CONFLICT_REASON,
  type RealtimeStatus,
  statusFromCloseCode,
} from "@/features/realtime/protocol";
import { useUnloadGuard } from "@/shared/hooks/useUnloadGuard";
import { randomUUID } from "@/shared/utils/uuid";

export interface DocSession {
  ydoc: Y.Doc;
  awareness: Awareness;
  undoManager: Y.UndoManager | null;
  status: RealtimeStatus;
  sessionId: string;
  fragmentSeeder: FragmentSeeder;
  /** Resolves once the first server `sync` AND the local IDB replay are done. */
  whenSynced: Promise<void>;
  /** Count of server generation changes for this content; each one recreated the session. */
  generationResets: number;
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
  /** The server replaced the document under this session; `hasLocalEdits` says whether the
   * closing session holds user text that will surface as a recovered draft. */
  onGenerationReset?: (info: { hasLocalEdits: boolean }) => void;
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

export interface CloseDisposalInput {
  discardLocalOnCleanClose: boolean;
  serverSynced: boolean;
  hydrationComplete: boolean;
  transportStatus: RealtimeStatus;
  outboundPending: boolean;
  readOnly: boolean;
  generationChanged: boolean;
  denied: boolean;
}

export interface CloseDisposal {
  /** Every local frame reached the server under the current generation. */
  acknowledged: boolean;
  /** Drop this session's rows; only an acknowledged close of an opt-in session. */
  discard: boolean;
  /** Record the doc so the drain replays its rows on the next connection. */
  drain: boolean;
}

// A generation change or a denial means the server never took this session's bytes, so
// neither counts as a clean close no matter what the transport reports.
export function resolveCloseDisposal(input: CloseDisposalInput): CloseDisposal {
  const acknowledged =
    input.serverSynced &&
    input.hydrationComplete &&
    input.transportStatus === "connected" &&
    !input.outboundPending &&
    !input.generationChanged &&
    !input.denied;
  return {
    acknowledged,
    discard: input.discardLocalOnCleanClose && acknowledged,
    drain: input.outboundPending && !input.readOnly && !input.generationChanged && !input.denied,
  };
}

export function useDocSession(opts: UseDocSessionOptions): DocSession | null {
  const {
    contentType,
    contentId,
    enabled,
    undoTarget,
    captureTimeout,
    discardLocalOnCleanClose = false,
    onGenerationReset,
  } = opts;
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const userId = useAppSelector((state) => state.auth.user?.id ?? null);

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
  const [generationReset, setGenerationReset] = useState(0);
  const onGenerationResetRef = useRef(onGenerationReset);
  // eslint-disable-next-line react/react-compiler -- latest-value ref read from a transport callback
  onGenerationResetRef.current = onGenerationReset;

  // Unsent edits live only in this tab's memory until acknowledged.
  useUnloadGuard(
    useOutboundPending(enabled && contentId ? docNameFor(contentType, contentId) : null),
  );

  useEffect(() => {
    if (!enabled || !contentId || !organizationId) {
      return;
    }

    const docName = docNameFor(contentType, contentId);
    abortDrain(docName);
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const sessionId = randomUUID();
    let serverSynced = false;
    let transportStatus: RealtimeStatus = "idle";
    let generationChanged = false;
    let denied = false;
    let disposed = false;

    const persistence = attachEncryptedPersistence({
      contentType,
      contentId,
      ydoc,
      scope: userId
        ? {
            contentType,
            contentId,
            organizationId,
            userId,
            discardOnClean: discardLocalOnCleanClose,
          }
        : undefined,
      isAcknowledged: () =>
        serverSynced &&
        transportStatus === "connected" &&
        !generationChanged &&
        !realtimeMultiplexer.isOutboundPending(docName),
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
        const options = { serverGeneration: docGeneration(ydoc) };
        chooseReplay(options);
        // Offline discovery can be ambiguous. Retry against the server epoch before editing.
        void whenHydrated
          .then(() => persistence.hydrate(options))
          .catch((error) => console.warn("[realtime] persistence hydrate failed", error))
          .finally(() => {
            serverSynced = true;
            resolveServerSync();
          });
      },
      onCloseCode: (code) => {
        // Any close leaves the transport down until the next "connected" status.
        const mapped = statusFromCloseCode(code);
        transportStatus = mapped ?? "disconnected";
        if (mapped) setStatus(mapped);
      },
      // Doc-scoped, unlike a 4403 close: only this editor flips to view-only.
      onWriteDenied: (reason, noView) => {
        denied = true;
        setStatus(
          reason.includes("too large")
            ? "update_rejected"
            : noView
              ? "access_lost"
              : "permission_lost",
        );
        if (reason === SEED_CONFLICT_REASON) {
          void persistence.quarantine().then((retained) => {
            if (!retained || disposed) return;
            generationChanged = true;
            onGenerationResetRef.current?.({ hasLocalEdits: true });
            setGenerationReset((value) => value + 1);
          });
        } else {
          // Hydration can trigger rejection before its dirty marker is recorded.
          queueMicrotask(() => {
            if (reason.includes("too large") || persistence.isDirty())
              void persistence.quarantine();
          });
        }
      },
      onGenerationMismatch: () => {
        generationChanged = true;
        onGenerationResetRef.current?.({ hasLocalEdits: persistence.isDirty() });
        setGenerationReset((value) => value + 1);
      },
    });
    const unsubscribePending = realtimeMultiplexer.subscribeOutboundPending(docName, (pending) => {
      if (pending) return;
      void persistence.acknowledge().then(() => {
        if (!disposed && !realtimeMultiplexer.isOutboundPending(docName))
          clearPendingDoc(contentType, contentId);
      });
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
      disposed = true;
      unsubscribePending();
      // Read before detach: the multiplexer forgets the doc's outbound state on destroy.
      const disposal = resolveCloseDisposal({
        discardLocalOnCleanClose,
        serverSynced,
        hydrationComplete,
        transportStatus,
        outboundPending: realtimeMultiplexer.isOutboundPending(docName),
        readOnly: realtimeMultiplexer.isDocReadOnly(docName),
        generationChanged,
        denied,
      });
      if (disposal.acknowledged) clearPendingDoc(contentType, contentId);
      subscription.destroy();
      undoManager?.destroy();
      awareness.destroy();
      void persistence
        .destroy({ discard: disposal.discard, acknowledged: disposal.acknowledged })
        .finally(() => ydoc.destroy());
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    contentType,
    contentId,
    organizationId,
    userId,
    discardLocalOnCleanClose,
    generationReset,
  ]);

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
      fragmentSeeder: current.subscription,
      status,
      whenSynced: current.whenSynced,
      generationResets: generationReset,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, tick, enabled, generationReset]);
  /* eslint-enable react/react-compiler */
}
