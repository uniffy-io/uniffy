import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
  realtimeMultiplexer,
  REMOTE_ORIGIN,
  type DocSubscription,
} from "@shared/realtime/multiplexer";
import { abortMobileDrain, replayRetainedUpdates, retainCoverage } from "@shared/realtime/drain";
import { statusFromCloseCode, type RealtimeStatus } from "@shared/realtime/protocol";
import {
  discardDraft,
  discardGeneration,
  readStoredDrafts,
  restoreDraft,
  saveDraft,
  saveDraftNow,
  settleLostAccess,
  type MobileRecoveredDraft,
} from "@shared/realtime/draftStorage";
import {
  persistenceState,
  saveDelayedAt,
  SYNCING_SETTLE_MS,
  type PersistenceState,
} from "@shared/realtime/persistenceState";

/** Stable per-attach handle; identity never changes while the doc stays attached. */
export interface DocSession {
  ydoc: Y.Doc;
  awareness: Awareness;
  /** Origin tag for this mount's local transactions. */
  sessionId: string;
  /** Resolves on the first server SyncStep2 for this doc. */
  whenSynced: Promise<void>;
  initialDrafts: Promise<MobileRecoveredDraft[]>;
  storageKey: string;
}

/** Replaced, never mutated, on change, so it suits `useSyncExternalStore`. */
export interface DocSessionSnapshot {
  readonly status: RealtimeStatus;
  readonly synced: boolean;
  readonly recoveredDrafts: MobileRecoveredDraft[];
  readonly persistence: PersistenceState;
}

export const DETACHED_SESSION_SNAPSHOT: DocSessionSnapshot = Object.freeze({
  status: "idle",
  synced: false,
  recoveredDrafts: [],
  persistence: "connecting",
});

export interface OpenDocSessionOptions {
  contentType: string;
  contentId: string;
  organizationId: string;
  userId: string;
  /** Suppresses every write frame, which the server refuses from a viewer anyway. */
  readOnly?: boolean;
  onGenerationMismatch?: () => void;
}

export interface DocSessionHandle {
  readonly session: DocSession;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => DocSessionSnapshot;
  discardRecoveredDraft(id: string): Promise<void>;
  /** Records a device draft write so a failure shows and Done waits for it. */
  trackDraftWrite(write: Promise<void>): Promise<boolean>;
  /** Stores uncheckpointed edits on the device; false while their only copy is in memory. */
  persistLocally(): Promise<boolean>;
  /** Detaches; resolves once the device copy is stored or a clean close discarded it. */
  close(): Promise<void>;
}

// Uniqueness per mount is all an origin tag needs; Hermes lacks crypto.randomUUID.
function createSessionId(): string {
  return `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Attaches one document with local recovery; null when the multiplexer refuses the attach. */
export function openDocSession(options: OpenDocSessionOptions): DocSessionHandle | null {
  const { contentType, contentId, organizationId, userId, readOnly = false } = options;
  const docName = `${contentType}:${contentId}`;
  abortMobileDrain(docName);
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const sessionId = createSessionId();
  const storageKey = `realtime.${userId}.${organizationId}.${contentType}.${contentId}`;
  const listeners = new Set<() => void>();
  let snapshot = DETACHED_SESSION_SNAPSHOT;
  let closing: Promise<void> | null = null;
  let dirty = false;
  let serverSynced = false;
  let synced = false;
  let transportStatus: RealtimeStatus = "idle";
  let denied = false;
  // Transport chatter after a write denial must not reopen editing; a reconnect asks again.
  let denial: RealtimeStatus | null = null;
  let recoveredDrafts: MobileRecoveredDraft[] = [];
  let storageFailed = false;
  let lastWrite = Promise.resolve(true);
  let transportPending = false;
  let transportSettledAt: number | null = null;
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;
  // Settles the device copy once view access is gone; nothing is saved for the doc afterwards.
  let lostAccess: Promise<void> | null = null;

  const publish = () => {
    if (closing) return;
    if (wakeTimer !== null) clearTimeout(wakeTimer);
    wakeTimer = null;
    const doc = realtimeMultiplexer.getDocState(docName);
    const now = Date.now();
    if (transportPending && !doc.transportPending) transportSettledAt = now;
    transportPending = doc.transportPending;
    // Re-evaluate when the Syncing hold ends or the oldest edit turns thirty seconds old.
    const wakes = [
      saveDelayedAt(doc),
      transportSettledAt === null ? null : transportSettledAt + SYNCING_SETTLE_MS,
    ].filter((at): at is number => at !== null && at > now);
    if (wakes.length) wakeTimer = setTimeout(publish, Math.min(...wakes) - now);
    const status = denial ?? transportStatus;
    const persistence = persistenceState({
      status,
      doc,
      synced,
      readOnly,
      storageFailed,
      transportSettledAt,
      now,
    });
    if (
      status === snapshot.status &&
      synced === snapshot.synced &&
      recoveredDrafts === snapshot.recoveredDrafts &&
      persistence === snapshot.persistence
    )
      return;
    snapshot = Object.freeze({ status, synced, recoveredDrafts, persistence });
    for (const listener of listeners) listener();
  };

  const trackDraftWrite = (write: Promise<void>): Promise<boolean> => {
    // draftStorage already logs the failure.
    const stored = write.then(
      () => true,
      () => false,
    );
    lastWrite = stored;
    void stored.then((ok) => {
      if (lastWrite !== stored) return;
      storageFailed = !ok;
      publish();
    });
    return stored;
  };

  const persist = (_update: Uint8Array, origin: unknown) => {
    if (lostAccess) return;
    if (origin !== REMOTE_ORIGIN && !readOnly && ydoc.getMap("doc_meta").get("generation")) {
      dirty = true;
      void trackDraftWrite(saveDraft(storageKey, ydoc));
    }
  };
  ydoc.on("update", persist);

  const initialDrafts = readStoredDrafts(storageKey);
  void initialDrafts
    .then((drafts) => {
      recoveredDrafts = drafts;
      publish();
    })
    .catch((error) => console.warn("[realtime] draft recovery failed", error));

  let resolveServerSync!: () => void;
  const whenSynced = new Promise<void>((resolve) => {
    resolveServerSync = resolve;
  });

  const retain = retainCoverage(storageKey, docName);
  const unsubscribeState = realtimeMultiplexer.subscribeDocState(docName, publish);
  let subscription: DocSubscription;
  try {
    subscription = realtimeMultiplexer.attach({
      contentType,
      contentId,
      organizationId,
      ydoc,
      awareness,
      onStatus: (next) => {
        if (next === "connecting") denial = null;
        transportStatus = next;
        publish();
      },
      onWriteDenied: (reason, noView) => {
        denied = true;
        denial = reason.includes("too large")
          ? "update_rejected"
          : noView
            ? "access_lost"
            : "permission_lost";
        if (noView && !readOnly) settleLost();
        publish();
      },
      onCoverage: (events) => {
        if (!readOnly && !lostAccess) void trackDraftWrite(retain(events));
      },
      onSync: () =>
        void (
          readOnly
            ? readStoredDrafts(storageKey)
            : replayRetainedUpdates(storageKey, docName).then(() =>
                restoreDraft(storageKey, ydoc, sessionId, () => !closing),
              )
        )
          .then((drafts) => {
            if (closing) return;
            recoveredDrafts = drafts;
            serverSynced = true;
          })
          .catch((error) => console.warn("[realtime] draft recovery failed", error))
          .finally(() => {
            if (closing) return;
            synced = true;
            resolveServerSync();
            publish();
          }),
      // The draft belongs to a generation the server replaced, so closing must keep it.
      onGenerationMismatch: () => {
        denied = true;
        options.onGenerationMismatch?.();
      },
      onCloseCode: (code) => {
        const mapped = statusFromCloseCode(code);
        if (!mapped) return;
        transportStatus = mapped;
        publish();
      },
    });
  } catch (error) {
    // Double-attach or a torn-down multiplexer; stay idle instead of failing the screen.
    console.warn(`[realtime] attach failed for ${docName}`, error);
    closing = Promise.resolve();
    unsubscribeState();
    ydoc.off("update", persist);
    awareness.destroy();
    ydoc.destroy();
    return null;
  }
  if (readOnly) realtimeMultiplexer.setDocReadOnly(subscription.docName, true);
  publish();

  // The server keeps what it accepted. Once this socket has shown every own update accepted the
  // device copy goes; otherwise it becomes a recovered draft. No drain replays it afterwards.
  function settleLost(): void {
    const state = realtimeMultiplexer.getDocState(docName);
    const generation = state.generation ?? String(ydoc.getMap("doc_meta").get("generation") ?? "");
    if (lostAccess || !generation) return;
    const keepDraft = !state.coverageKnown || state.transportPending;
    lostAccess = (dirty ? saveDraftNow(storageKey, ydoc) : Promise.resolve())
      .then(() => settleLostAccess(storageKey, generation, keepDraft))
      .then(() => readStoredDrafts(storageKey))
      .then((drafts) => {
        recoveredDrafts = drafts;
        publish();
      })
      .catch((error) =>
        console.warn("[realtime] could not settle a document without access", error),
      );
  }

  return {
    session: { ydoc, awareness, sessionId, whenSynced, initialDrafts, storageKey },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    discardRecoveredDraft: async (id) => {
      await discardDraft(storageKey, id);
      recoveredDrafts = recoveredDrafts.filter((draft) => draft.id !== id);
      publish();
    },
    trackDraftWrite,
    persistLocally: async () => {
      // The edits are on the server or in the recovered draft the settle kept.
      if (lostAccess) return lostAccess.then(() => true);
      if (dirty && !readOnly && realtimeMultiplexer.getDocState(docName).checkpointPending)
        void trackDraftWrite(saveDraft(storageKey, ydoc));
      const stored = await lastWrite;
      return stored || (synced && !realtimeMultiplexer.getDocState(docName).checkpointPending);
    },
    close: () => {
      if (closing) return closing;
      const clean =
        !readOnly &&
        serverSynced &&
        !denied &&
        transportStatus === "connected" &&
        !realtimeMultiplexer.getDocState(docName).checkpointPending;
      const generation = String(ydoc.getMap("doc_meta").get("generation") ?? "");
      // Accepted-only edits keep their device copy; the drain finishes them after detach.
      closing = lostAccess
        ? lostAccess
        : clean
          ? discardGeneration(storageKey, generation).catch(console.warn)
          : dirty
            ? saveDraftNow(storageKey, ydoc).catch(() => {})
            : Promise.resolve();
      if (wakeTimer !== null) clearTimeout(wakeTimer);
      ydoc.off("update", persist);
      unsubscribeState();
      subscription.destroy();
      awareness.destroy();
      ydoc.destroy();
      listeners.clear();
      return closing;
    },
  };
}
