import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { useAuth } from "@core/providers/AuthContext";
import { realtimeMultiplexer, type DocSubscription } from "@shared/realtime/multiplexer";
import { statusFromCloseCode, type RealtimeStatus } from "@shared/realtime/protocol";

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
  const { organizationId } = useAuth();

  const [session, setSession] = useState<DocSession | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [synced, setSynced] = useState(false);

  const beforeDetachRef = useRef(opts.onBeforeDetach);
  useEffect(() => {
    beforeDetachRef.current = opts.onBeforeDetach;
  });

  useEffect(() => {
    if (!enabled || !contentId || !organizationId) return;

    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const sessionId = newSessionId();

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
        onSync: () => {
          setSynced(true);
          resolveServerSync();
        },
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
      subscription.destroy();
      awareness.destroy();
      ydoc.destroy();
      setSession(null);
      setSynced(false);
      setStatus("idle");
    };
  }, [enabled, contentType, contentId, organizationId, readOnly]);

  return { session, status, synced };
}
