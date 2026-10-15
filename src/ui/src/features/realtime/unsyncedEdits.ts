import { realtimeMultiplexer } from "@/features/realtime/multiplexer";
import { hasPendingDocs } from "@/features/realtime/pendingDocs";

/** Local edits the server has not acknowledged: live docs still pending, or docs waiting for the drain. */
export function hasUnsyncedEdits(userId: string | null): boolean {
  return realtimeMultiplexer.hasOutboundPending() || (userId !== null && hasPendingDocs(userId));
}
