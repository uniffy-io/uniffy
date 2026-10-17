// Which promise the server has made for each own update: none yet (local), buffered
// (accepted) or committed to PostgreSQL (checkpointed). Pure state; the multiplexer feeds it
// frames and owns the bytes.

import type {
  AcceptedReceipt,
  CheckpointProgress,
  SessionState,
} from "@/features/realtime/protocol";

export type Coverage = "local" | "accepted" | "checkpointed";

/** Where the server buffered an update. Sequences compare only within one generation and epoch. */
export interface ReceiptIdentity {
  generation: string;
  epoch: string;
  sequence: number;
}

export type CoverageTransition =
  | { updateId: string; coverage: "local"; editedAt: number }
  | { updateId: string; coverage: "accepted"; editedAt: number; receipt: ReceiptIdentity }
  | { updateId: string; coverage: "checkpointed"; editedAt: number };

export interface CoverageSummary {
  /** Some own update has no receipt yet. */
  transportPending: boolean;
  /** Some own update is not yet in a PostgreSQL checkpoint. */
  checkpointPending: boolean;
  oldestUncheckpointedAt: number | null;
}

interface TrackedUpdate {
  editedAt: number;
  receipt: ReceiptIdentity | null;
}

export class UpdateCoverage {
  // Checkpointed updates leave the map; insertion order is replay order.
  private readonly updates = new Map<string, TrackedUpdate>();
  private current: { generation: string; epoch: string } | null = null;
  // Highest covered sequence seen for the current generation and epoch, kept even before the
  // receipts it covers arrive.
  private covered = 0;
  // Head of the latest session state. Own live receipts never raise it: a restored receipt above
  // it is loss evidence even when this session's own edits have since reused that sequence.
  private head = 0;

  get epoch(): string | null {
    return this.current?.epoch ?? null;
  }

  localIds(): string[] {
    return [...this.updates].filter(([, update]) => !update.receipt).map(([id]) => id);
  }

  summary(): CoverageSummary {
    let transportPending = false;
    let oldest: number | null = null;
    for (const update of this.updates.values()) {
      if (!update.receipt) transportPending = true;
      if (oldest === null || update.editedAt < oldest) oldest = update.editedAt;
    }
    return {
      transportPending,
      checkpointPending: this.updates.size > 0,
      oldestUncheckpointedAt: oldest,
    };
  }

  /** Tracks a new or restored update; a restored receipt is reconciled like a live one. */
  add(
    updateId: string,
    editedAt: number,
    receipt: ReceiptIdentity | null = null,
  ): CoverageTransition[] {
    if (this.updates.has(updateId)) return [];
    // A receipt above the known head names an update the buffer lost in place.
    const restored =
      receipt && (!this.current || (this.isCurrent(receipt) && receipt.sequence <= this.head))
        ? receipt
        : null;
    if (restored && this.current && restored.sequence <= this.covered) {
      return [{ updateId, coverage: "checkpointed", editedAt }];
    }
    this.updates.set(updateId, { editedAt, receipt: restored });
    return [
      restored
        ? { updateId, coverage: "accepted", editedAt, receipt: restored }
        : { updateId, coverage: "local", editedAt },
    ];
  }

  applyReceipt(receipt: AcceptedReceipt): CoverageTransition[] {
    const update = this.updates.get(receipt.updateId);
    if (!update || update.receipt || !this.isCurrent(receipt)) return [];
    if (receipt.acceptedSequence <= this.covered) return this.retire(receipt.updateId, update);
    update.receipt = {
      generation: receipt.generation,
      epoch: receipt.epoch,
      sequence: receipt.acceptedSequence,
    };
    return [
      {
        updateId: receipt.updateId,
        coverage: "accepted",
        editedAt: update.editedAt,
        receipt: update.receipt,
      },
    ];
  }

  applyProgress(progress: CheckpointProgress): CoverageTransition[] {
    if (!this.isCurrent(progress)) return [];
    this.covered = Math.max(this.covered, progress.coveredSequence);
    return this.reconcile(Number.MAX_SAFE_INTEGER);
  }

  applySessionState(state: SessionState): CoverageTransition[] {
    if (this.isCurrent(state)) {
      this.covered = Math.max(this.covered, state.checkpointSequence);
    } else {
      this.current = { generation: state.generation, epoch: state.epoch };
      this.covered = state.checkpointSequence;
    }
    this.head = state.headSequence;
    return this.reconcile(state.headSequence);
  }

  /** Message 7 proves a commit for this exact update, whatever epoch it was accepted in. */
  applyCommitted(updateId: string): CoverageTransition[] {
    const update = this.updates.get(updateId);
    return update ? this.retire(updateId, update) : [];
  }

  private isCurrent(frame: { generation: string; epoch: string }): boolean {
    return (
      this.current !== null &&
      frame.generation === this.current.generation &&
      frame.epoch === this.current.epoch
    );
  }

  // Receipts from another epoch, or beyond the server's head, no longer prove the buffer holds
  // the update, so it returns to local and replays under its original id.
  private reconcile(headSequence: number): CoverageTransition[] {
    const transitions: CoverageTransition[] = [];
    for (const [updateId, update] of this.updates) {
      const receipt = update.receipt;
      if (!receipt) continue;
      if (this.isCurrent(receipt) && receipt.sequence <= this.covered) {
        transitions.push(...this.retire(updateId, update));
      } else if (!this.isCurrent(receipt) || receipt.sequence > headSequence) {
        update.receipt = null;
        transitions.push({ updateId, coverage: "local", editedAt: update.editedAt });
      }
    }
    return transitions;
  }

  private retire(updateId: string, update: TrackedUpdate): CoverageTransition[] {
    this.updates.delete(updateId);
    return [{ updateId, coverage: "checkpointed", editedAt: update.editedAt }];
  }
}
