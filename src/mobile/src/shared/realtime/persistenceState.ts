import type { RealtimeDocState } from "@shared/realtime/multiplexer";
import type { RealtimeStatus } from "@shared/realtime/protocol";

export const SAVE_DELAYED_AFTER_MS = 30_000;
// Receipts arrive per transport batch; without a hold the label would flip while someone types.
export const SYNCING_SETTLE_MS = 1_000;

export type PersistenceState =
  | "saved"
  | "synced"
  | "syncing"
  | "delayed"
  | "unavailable"
  | "connecting"
  | "offline"
  | "storage_failed"
  | "rejected"
  | "view_only"
  | "access_lost"
  | "session_ended"
  | "upgrade_required";

type CoverageState = Pick<
  RealtimeDocState,
  | "transportPending"
  | "checkpointPending"
  | "oldestUncheckpointedAt"
  | "savingUnavailable"
  | "coverageKnown"
>;

export interface PersistenceInput {
  readonly status: RealtimeStatus;
  readonly doc: CoverageState;
  /** The first server sync has finished. */
  readonly synced: boolean;
  readonly readOnly: boolean;
  /** The latest device draft write failed. */
  readonly storageFailed: boolean;
  /** When the last own edit stopped being transport pending. */
  readonly transportSettledAt: number | null;
  readonly now: number;
}

export function saveDelayedAt(doc: CoverageState): number | null {
  return doc.checkpointPending && doc.oldestUncheckpointedAt !== null
    ? doc.oldestUncheckpointedAt + SAVE_DELAYED_AFTER_MS
    : null;
}

/** Exceptional states win; only checkpoint coverage reaches Saved, a receipt stops at Synced, and
 * neither shows before the current socket's session state. */
export function persistenceState({
  status,
  doc,
  synced,
  readOnly,
  storageFailed,
  transportSettledAt,
  now,
}: PersistenceInput): PersistenceState {
  if (status === "access_lost") return "access_lost";
  if (status === "token_revoked") return "session_ended";
  if (status === "upgrade_required") return "upgrade_required";
  if (status === "permission_lost") return "view_only";
  if (status === "update_rejected") return "rejected";
  // A missing device copy matters only while some edit is not in a checkpoint.
  if (storageFailed && (!synced || doc.checkpointPending)) return "storage_failed";
  if (status === "offline" || status === "disconnected") return "offline";
  if (readOnly) return "view_only";
  if (doc.savingUnavailable) return "unavailable";
  const delayedAt = saveDelayedAt(doc);
  if (delayedAt !== null && now >= delayedAt) return "delayed";
  if (
    doc.transportPending ||
    (transportSettledAt !== null && now < transportSettledAt + SYNCING_SETTLE_MS)
  )
    return "syncing";
  if (!synced || !doc.coverageKnown || status === "idle" || status === "connecting")
    return "connecting";
  return doc.checkpointPending ? "synced" : "saved";
}
