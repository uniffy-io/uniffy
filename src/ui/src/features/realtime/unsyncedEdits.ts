import { realtimeMultiplexer } from "@/features/realtime/multiplexer";
import { hasPendingDocs } from "@/features/realtime/pendingDocs";

/** Own edits no PostgreSQL checkpoint covers yet: live docs, or docs waiting for the drain. */
export function hasUnsyncedEdits(userId: string | null): boolean {
  return realtimeMultiplexer.hasCheckpointPending() || (userId !== null && hasPendingDocs(userId));
}
