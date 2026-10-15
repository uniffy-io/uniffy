import { useCallback, useSyncExternalStore } from "react";
import { realtimeMultiplexer } from "@/features/realtime/multiplexer";

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
