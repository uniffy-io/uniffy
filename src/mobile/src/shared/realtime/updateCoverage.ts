import type { AcceptedReceipt, CheckpointProgress, SessionState } from "@shared/realtime/protocol";

/**
 * Local: only this device holds the update. Accepted: the server buffer holds it, so routine
 * retransmission stops. Checkpointed: PostgreSQL holds it, so retry bytes and dirty markers retire.
 */
export type Coverage = "local" | "accepted" | "checkpointed";

export interface CoverageTransition {
  readonly updateId: string;
  readonly coverage: Coverage;
  readonly editedAt: number;
}

export interface CoverageSummary {
  /** Some own update has no receipt yet. */
  readonly transportPending: boolean;
  /** Some own update is not in a PostgreSQL checkpoint yet. */
  readonly checkpointPending: boolean;
  readonly oldestUncheckpointedAt: number | null;
}

interface TrackedUpdate {
  editedAt: number;
  // Accepted sequence in the current generation and epoch; null while local.
  sequence: number | null;
}

/**
 * Coverage of this client's own updates, driven by server frames. Checkpointed updates are
 * forgotten, so duplicate or late frames about them change nothing.
 */
export class UpdateCoverage {
  generation: string | null = null;
  epoch: string | null = null;
  // Highest covered sequence of the current epoch, kept for receipts that arrive after progress.
  private covered = 0;
  // Insertion order is replay order.
  private readonly updates = new Map<string, TrackedUpdate>();

  summary(): CoverageSummary {
    let transportPending = false;
    let oldest: number | null = null;
    for (const update of this.updates.values()) {
      if (update.sequence === null) transportPending = true;
      if (oldest === null || update.editedAt < oldest) oldest = update.editedAt;
    }
    return {
      transportPending,
      checkpointPending: this.updates.size > 0,
      oldestUncheckpointedAt: oldest,
    };
  }

  localIds(): string[] {
    return [...this.updates].filter(([, update]) => update.sequence === null).map(([id]) => id);
  }

  add(updateId: string, editedAt: number): CoverageTransition[] {
    if (this.updates.has(updateId)) return [];
    this.updates.set(updateId, { editedAt, sequence: null });
    return [{ updateId, coverage: "local", editedAt }];
  }

  applyReceipt(receipt: AcceptedReceipt): CoverageTransition[] {
    const update = this.updates.get(receipt.updateId);
    if (!update || update.sequence !== null || !this.isCurrent(receipt)) return [];
    update.sequence = receipt.acceptedSequence;
    if (receipt.acceptedSequence <= this.covered) return this.checkpoint([receipt.updateId]);
    return [{ updateId: receipt.updateId, coverage: "accepted", editedAt: update.editedAt }];
  }

  applyProgress(progress: CheckpointProgress): CoverageTransition[] {
    return this.isCurrent(progress) ? this.cover(progress.coveredSequence) : [];
  }

  /** Accepted updates the server can no longer vouch for return to local and must replay. */
  applySessionState(state: SessionState): CoverageTransition[] {
    const epochChanged = !this.isCurrent(state);
    if (epochChanged) {
      this.generation = state.generation;
      this.epoch = state.epoch;
      this.covered = 0;
    }
    const transitions: CoverageTransition[] = [];
    for (const [updateId, update] of this.updates) {
      // A receipt above the head names an update the buffer lost.
      if (update.sequence !== null && (epochChanged || update.sequence > state.headSequence)) {
        update.sequence = null;
        transitions.push({ updateId, coverage: "local", editedAt: update.editedAt });
      }
    }
    return [...transitions, ...this.cover(state.checkpointSequence)];
  }

  /** Message 7 proves a PostgreSQL commit, whatever the buffer epoch. */
  applyCommitted(updateId: string): CoverageTransition[] {
    return this.updates.has(updateId) ? this.checkpoint([updateId]) : [];
  }

  private isCurrent(frame: { generation: string; epoch: string }): boolean {
    return frame.generation === this.generation && frame.epoch === this.epoch;
  }

  private cover(sequence: number): CoverageTransition[] {
    this.covered = Math.max(this.covered, sequence);
    const covered = [...this.updates]
      .filter(([, update]) => update.sequence !== null && update.sequence <= this.covered)
      .map(([id]) => id);
    return this.checkpoint(covered);
  }

  private checkpoint(updateIds: string[]): CoverageTransition[] {
    return updateIds.map((updateId) => {
      const { editedAt } = this.updates.get(updateId)!;
      this.updates.delete(updateId);
      return { updateId, coverage: "checkpointed", editedAt };
    });
  }
}
