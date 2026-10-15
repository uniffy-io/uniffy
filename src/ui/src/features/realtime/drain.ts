// Replays stranded local edits through a headless Y.Doc: hydrate from IndexedDB, let the
// durable update path send, wait for acknowledgments, then close like a normal session.

import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { docGeneration } from "@/features/realtime/docGeneration";
import { docNameFor } from "@/features/realtime/docNames";
import { realtimeMultiplexer } from "@/features/realtime/multiplexer";
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

const active = new Set<string>();
const cancellations = new Map<string, () => void>();

export function abortDrain(docName: string): void {
  cancellations.get(docName)?.();
}

// "drained": the server acknowledged everything. "retained": the server refused the doc or
// generation; the rows stay a recoverable draft and the entry is dropped. "retry": the
// connection itself failed; the entry waits for the next trigger.
type DrainOutcome = "drained" | "retained" | "retry";

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
      isAcknowledged: () => !realtimeMultiplexer.isOutboundPending(docName),
    });
    let settled = false;
    let unsubscribePending = () => {};
    const finish = (outcome: DrainOutcome) => {
      if (settled) return;
      settled = true;
      cancellations.delete(docName);
      unsubscribePending();
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
    const subscription = realtimeMultiplexer.attach({
      contentType,
      contentId,
      ydoc,
      awareness,
      onSync: () => {
        void persistence
          .hydrate({ serverGeneration: docGeneration(ydoc) })
          .catch((error) => {
            console.warn("[realtime] drain hydrate failed", error);
            finish("retry");
          })
          .then(() => {
            if (settled) return;
            if (!realtimeMultiplexer.isOutboundPending(docName)) {
              finish("drained");
              return;
            }
            unsubscribePending = realtimeMultiplexer.subscribeOutboundPending(
              docName,
              (pending) => {
                if (!pending) finish("drained");
              },
            );
          });
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
