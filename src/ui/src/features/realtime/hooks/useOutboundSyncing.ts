import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { realtimeMultiplexer } from "@/features/realtime/multiplexer";
import {
  createPendingHysteresis,
  type PendingHysteresis,
} from "@/features/realtime/pendingHysteresis";

/** Raw outbound backlog flag; flips on every keystroke, so user-facing copy reads
 * `useOutboundSyncing` instead. Lifecycle decisions (hold a session until drained) read this. */
export function useOutboundPending(docName: string | null): boolean {
  const subscribe = useCallback(
    (onChange: () => void) =>
      docName ? realtimeMultiplexer.subscribeOutboundPending(docName, onChange) : () => {},
    [docName],
  );
  return useSyncExternalStore(subscribe, () =>
    docName ? realtimeMultiplexer.isOutboundPending(docName) : false,
  );
}

/** Outbound backlog for a doc, smoothed so short per-keystroke spikes never
 * reach the UI. True only while edits stay unsent long enough to be worth
 * telling the user about. */
export function useOutboundSyncing(docName: string | null): boolean {
  const pending = useOutboundPending(docName);

  // Keyed by docName so switching notes reads as not-syncing right away, with
  // no state reset racing the controller the next doc creates.
  const [syncingDoc, setSyncingDoc] = useState<string | null>(null);
  const controllerRef = useRef<PendingHysteresis | null>(null);

  useEffect(() => {
    if (!docName) return;
    const controller = createPendingHysteresis((visible) => {
      setSyncingDoc(visible ? docName : null);
    });
    controllerRef.current = controller;
    controller.setPending(realtimeMultiplexer.isOutboundPending(docName));
    return () => {
      controller.destroy();
      controllerRef.current = null;
    };
  }, [docName]);

  useEffect(() => {
    controllerRef.current?.setPending(pending);
  }, [pending]);

  return syncingDoc === docName && docName !== null;
}
