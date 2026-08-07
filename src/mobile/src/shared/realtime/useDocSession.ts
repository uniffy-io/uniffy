import { useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { useAuth } from "@core/providers/AuthContext";
import { realtimeMultiplexer, type DocSubscription } from "@shared/realtime/multiplexer";
import { statusFromCloseCode, type RealtimeStatus } from "@shared/realtime/protocol";

export interface DocSession {
  ydoc: Y.Doc;
  awareness: Awareness;
  status: RealtimeStatus;
  /** Origin tag for this mount's local transactions. */
  sessionId: string;
  /** Resolves on the first server SyncStep2 for this doc. */
  whenSynced: Promise<void>;
  synced: boolean;
}

export interface UseDocSessionOptions {
  contentType: string;
  contentId: string | null | undefined;
  enabled: boolean;
  /** Suppresses every SYNC write frame; VIEWER roles get 4403-closed otherwise. */
  readOnly?: boolean;
}

// Uniqueness per mount is all an origin tag needs; Hermes lacks crypto.randomUUID.
function newSessionId(): string {
  return `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useDocSession(opts: UseDocSessionOptions): DocSession | null {
  const { contentType, contentId, enabled, readOnly } = opts;
  const { organizationId } = useAuth();

  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [synced, setSynced] = useState(false);
  const sessionRef = useRef<{
    ydoc: Y.Doc;
    awareness: Awareness;
    sessionId: string;
    subscription: DocSubscription;
    whenSynced: Promise<void>;
  } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || !contentId || !organizationId) return;

    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const sessionId = newSessionId();

    let resolveServerSync!: () => void;
    const whenSynced = new Promise<void>((resolve) => {
      resolveServerSync = resolve;
    });

    const subscription = realtimeMultiplexer.attach({
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
    if (readOnly) realtimeMultiplexer.setDocReadOnly(subscription.docName, true);

    sessionRef.current = { ydoc, awareness, sessionId, subscription, whenSynced };
    setTick((t) => t + 1);

    return () => {
      subscription.destroy();
      awareness.destroy();
      ydoc.destroy();
      sessionRef.current = null;
      setSynced(false);
      setStatus("idle");
    };
  }, [enabled, contentType, contentId, organizationId, readOnly]);

  return useMemo<DocSession | null>(() => {
    const current = sessionRef.current;
    if (!current) return null;
    return {
      ydoc: current.ydoc,
      awareness: current.awareness,
      sessionId: current.sessionId,
      status,
      synced,
      whenSynced: current.whenSynced,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, synced, tick]);
}
