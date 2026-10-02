import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { useAuth } from "@core/providers/AuthContext";
import {
  realtimeMultiplexer,
  REMOTE_ORIGIN,
  type DocSubscription,
} from "@shared/realtime/multiplexer";
import { statusFromCloseCode, type RealtimeStatus } from "@shared/realtime/protocol";
import { saveDraft, restoreDraft, type MobileRecoveredDraft } from "@shared/realtime/draftStorage";

/** Stable per-attach handle; identity never changes while the doc stays attached. */
export interface DocSession {
  ydoc: Y.Doc;
  awareness: Awareness;
  /** Origin tag for this mount's local transactions. */
  sessionId: string;
  /** Resolves on the first server SyncStep2 for this doc. */
  whenSynced: Promise<void>;
}

export interface DocSessionState {
  session: DocSession | null;
  status: RealtimeStatus;
  synced: boolean;
  recoveredDrafts: MobileRecoveredDraft[];
}

export interface UseDocSessionOptions {
  contentType: string;
  contentId: string | null | undefined;
  enabled: boolean;
  /** Suppresses every SYNC write frame; VIEWER roles get 4403-closed otherwise. */
  readOnly?: boolean;
  /**
   * Runs at the top of the detach cleanup, while the doc and the multiplexer
   * update handler are still live. Bindings flush pending local edits here -
   * their own effect cleanup runs AFTER this one (React destroys effects in
   * declaration order), which is too late for the edit to ship.
   */
  onBeforeDetach?: () => void;
}

// Uniqueness per mount is all an origin tag needs; Hermes lacks crypto.randomUUID.
function newSessionId(): string {
  return `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useDocSession(opts: UseDocSessionOptions): DocSessionState {
  const { contentType, contentId, enabled, readOnly } = opts;
  const { organizationId, user } = useAuth();
  const userId = user?.id;

  const [session, setSession] = useState<DocSession | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [synced, setSynced] = useState(false);
  const [reset, setReset] = useState(0);
  const [recoveredDrafts, setRecoveredDrafts] = useState<MobileRecoveredDraft[]>([]);

  const beforeDetachRef = useRef(opts.onBeforeDetach);
  useEffect(() => {
    beforeDetachRef.current = opts.onBeforeDetach;
  });

  useEffect(() => {
    if (!enabled || !contentId || !organizationId || !userId) return;

    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const sessionId = newSessionId();
    const storageKey = `realtime.${userId}.${organizationId}.${contentType}.${contentId}`;
    let disposed = false;
    const persist = (_update: Uint8Array, origin: unknown) => {
      if (origin !== REMOTE_ORIGIN) void saveDraft(storageKey, ydoc);
    };
    ydoc.on("update", persist);

    let resolveServerSync!: () => void;
    const whenSynced = new Promise<void>((resolve) => {
      resolveServerSync = resolve;
    });

    let subscription: DocSubscription;
    try {
      subscription = realtimeMultiplexer.attach({
        contentType,
        contentId,
        organizationId,
        ydoc,
        awareness,
        onStatus: (next) => setStatus(next),
        onWriteDenied: () => setStatus("permission_lost"),
        onSync: () =>
          void restoreDraft(storageKey, ydoc, sessionId)
            .then((drafts) => {
              if (disposed) return;
              setRecoveredDrafts(drafts);
              setSynced(true);
              resolveServerSync();
            })
            .catch((error) => console.warn("[realtime] draft recovery failed", error))
            .finally(() => {
              if (!disposed) {
                setSynced(true);
                resolveServerSync();
              }
            }),
        onGenerationMismatch: () => setReset((value) => value + 1),
        onCloseCode: (code) => {
          const mapped = statusFromCloseCode(code);
          if (mapped) setStatus(mapped);
        },
      });
    } catch (err) {
      // Double-attach or a torn-down multiplexer; stay idle instead of taking
      // the screen down from inside a passive effect.
      console.warn(`[realtime] attach failed for ${contentType}:${contentId}`, err);
      awareness.destroy();
      ydoc.destroy();
      return;
    }
    if (readOnly) realtimeMultiplexer.setDocReadOnly(subscription.docName, true);

    // The handle can only exist after the attach side effect succeeds; there
    // is nothing to derive during render.
    // eslint-disable-next-line react/react-compiler
    setSession({ ydoc, awareness, sessionId, whenSynced });

    return () => {
      beforeDetachRef.current?.();
      disposed = true;
      ydoc.off("update", persist);
      void saveDraft(storageKey, ydoc);
      subscription.destroy();
      awareness.destroy();
      ydoc.destroy();
      setSession(null);
      setSynced(false);
      setStatus("idle");
    };
  }, [enabled, contentType, contentId, organizationId, userId, readOnly, reset]);

  return { session, status, synced, recoveredDrafts };
}
