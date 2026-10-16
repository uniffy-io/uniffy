// Settles stranded local edits through a headless Y.Doc: hydrate from IndexedDB, which hands
// unconfirmed updates back to the transport, resend what the server lacks, then close like a
// session once a checkpoint covers every own edit.

import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { docGeneration } from "@/features/realtime/docGeneration";
import { docNameFor } from "@/features/realtime/docNames";
import { realtimeMultiplexer, type RealtimeDocState } from "@/features/realtime/multiplexer";
import { clearPendingDoc, listPendingDocs, type PendingDoc } from "@/features/realtime/pendingDocs";
import { attachEncryptedPersistence } from "@/features/realtime/persistence/encryptedYjsPersistence";
import {
  SEED_CONFLICT_REASON,
  WS_CLOSE_FORBIDDEN,
  WS_CLOSE_NOT_FOUND,
  WS_CLOSE_TOKEN_REVOKED,
  WS_CLOSE_UNAUTHENTICATED,
} from "@/features/realtime/protocol";
import { isStorageEncryptionReady } from "@/shared/crypto/storageEncryption";

// Checkpoints land about ten seconds after the first pending edit; a drain still waiting after
// this long keeps everything and tries again on a later trigger.
export const DRAIN_TIMEOUT_MS = 60_000;

const active = new Set<string>();
const cancellations = new Map<string, () => void>();

export function abortDrain(docName: string): void {
  cancellations.get(docName)?.();
}

// "drained": a checkpoint covers every own edit. "retained": the server refused the doc or
// generation; the rows stay a recoverable draft and the entry is dropped. "retry": the
// connection failed or the checkpoint did not arrive in time; rows and entry wait for the next
// trigger. Acceptance alone never drains.
export type DrainOutcome = "drained" | "retained" | "retry";

export function drainDoc(entry: PendingDoc): Promise<DrainOutcome> {
  return new Promise((resolve) => {
    const { contentType, contentId } = entry;
    const docName = docNameFor(contentType, contentId);
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    // No presence: nobody is editing, so peers must not see a ghost avatar.
    awareness.setLocalState(null);
    const persistence = attachEncryptedPersistence({
      contentType,
      contentId,
      ydoc,
      scope: entry,
      isAcknowledged: () => !realtimeMultiplexer.getDocState(docName).checkpointPending,
    });
    let settled = false;
    let hydrating = false;
    let unsubscribeState = () => {};
    const timeout = setTimeout(() => finish("retry"), DRAIN_TIMEOUT_MS);
    const finish = (outcome: DrainOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cancellations.delete(docName);
      unsubscribeState();
      if (outcome !== "retry") clearPendingDoc(contentType, contentId);
      subscription.destroy();
      awareness.destroy();
      void persistence
        .destroy({
          discard: outcome === "drained" && entry.discardOnClean,
          acknowledged: outcome === "drained",
        })
        .finally(() => {
          ydoc.destroy();
          resolve(outcome);
        });
    };
    const settleOnCheckpoint = (state: RealtimeDocState) => {
      if (!state.checkpointPending) finish("drained");
    };
    const subscription = realtimeMultiplexer.attach({
      contentType,
      contentId,
      ydoc,
      awareness,
      onSync: () => {
        // A reconnect syncs again; the first hydration already restored everything.
        if (hydrating) return;
        hydrating = true;
        void persistence.hydrate({ serverGeneration: docGeneration(ydoc) }).then(
          () => {
            if (settled) return;
            unsubscribeState = realtimeMultiplexer.subscribeDocState(docName, settleOnCheckpoint);
            settleOnCheckpoint(realtimeMultiplexer.getDocState(docName));
          },
          (error) => {
            console.warn("[realtime] drain hydrate failed", error);
            finish("retry");
          },
        );
      },
      onWriteDenied: (reason) => {
        if (reason === SEED_CONFLICT_REASON) {
          void persistence.quarantine().then(() => finish("retained"));
        } else finish("retained");
      },
      onGenerationMismatch: () => finish("retained"),
      onCloseCode: (code) => {
        if (
          code === WS_CLOSE_UNAUTHENTICATED ||
          code === WS_CLOSE_FORBIDDEN ||
          code === WS_CLOSE_NOT_FOUND ||
          code === WS_CLOSE_TOKEN_REVOKED
        )
          finish("retry");
      },
    });
    cancellations.set(docName, () => finish("retry"));
  });
}

/** Starts a drain for every recorded doc of this user and organization that no editor holds. */
export function runRealtimeDrain(scope: { userId: string; organizationId: string }): void {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  if (!isStorageEncryptionReady()) return;
  for (const entry of listPendingDocs()) {
    if (entry.userId !== scope.userId || entry.organizationId !== scope.organizationId) continue;
    const docName = docNameFor(entry.contentType, entry.contentId);
    if (active.has(docName) || realtimeMultiplexer.isAttached(docName)) continue;
    active.add(docName);
    void drainDoc(entry).finally(() => active.delete(docName));
  }
}
