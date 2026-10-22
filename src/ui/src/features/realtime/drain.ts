// Settles stranded local edits through a headless Y.Doc: hydrate from IndexedDB, which hands
// unconfirmed updates back to the transport, resend what the server lacks, then close like a
// session once a checkpoint covers every own edit.

import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { docGeneration } from "@/features/realtime/docGeneration";
import { docNameFor } from "@/features/realtime/docNames";
import { whenDocumentFree } from "@/features/realtime/documentLocks";
import {
  realtimeMultiplexer,
  type DocSubscription,
  type RealtimeDocState,
} from "@/features/realtime/multiplexer";
import { clearPendingDoc, listPendingDocs, type PendingDoc } from "@/features/realtime/pendingDocs";
import { attachEncryptedPersistence } from "@/features/realtime/persistence/encryptedYjsPersistence";
import {
  SEED_CONFLICT_REASON,
  WS_CLOSE_FORBIDDEN,
  WS_CLOSE_TOKEN_REVOKED,
  WS_CLOSE_UNAUTHENTICATED,
} from "@/features/realtime/protocol";
import { isStorageEncryptionReady } from "@/shared/crypto/storageEncryption";

// Checkpoints land about ten seconds after the first pending edit; a drain still waiting after
// this long keeps everything and tries again on a later trigger.
export const DRAIN_TIMEOUT_MS = 60_000;
// Each drain that ends without a checkpoint doubles the wait before that document attaches
// again, so a document whose checkpoint is stuck reattaches about every quarter hour instead of
// every minute.
export const DRAIN_BACKOFF_MS = 60_000;
export const DRAIN_BACKOFF_MAX_MS = 15 * 60_000;

const active = new Set<string>();
// Each running or lock-waiting drain by doc name, with the organization of its entry.
const cancellations = new Map<string, { organizationId: string; cancel: () => void }>();
const backoff = new Map<
  string,
  { attempts: number; waiting: ReturnType<typeof setTimeout> | null }
>();

function forgetBackoff(docName: string): void {
  const entry = backoff.get(docName);
  if (entry?.waiting) clearTimeout(entry.waiting);
  backoff.delete(docName);
}

function delayNextAttempt(docName: string): void {
  const attempts = (backoff.get(docName)?.attempts ?? 0) + 1;
  forgetBackoff(docName);
  const entry = { attempts, waiting: null as ReturnType<typeof setTimeout> | null };
  entry.waiting = setTimeout(
    () => {
      entry.waiting = null;
    },
    Math.min(DRAIN_BACKOFF_MS * 2 ** (attempts - 1), DRAIN_BACKOFF_MAX_MS),
  );
  backoff.set(docName, entry);
}

/** An editor opening the doc takes over; the drain its close hands off to starts at once. */
export function abortDrain(docName: string): void {
  forgetBackoff(docName);
  cancellations.get(docName)?.cancel();
}

/** The tab leaves an organization: drains of any other end as retry, keeping rows and entry,
 * so none rides the next organization's socket. `null` ends every drain. */
export function abortDrainsOutside(organizationId: string | null): void {
  for (const drain of [...cancellations.values()])
    if (drain.organizationId !== organizationId) drain.cancel();
}

/** Connectivity came back, which may be what held the checkpoints: every drain may run now. */
export function resumeDrains(): void {
  for (const entry of backoff.values()) if (entry.waiting) clearTimeout(entry.waiting);
  backoff.clear();
}

// "drained": a checkpoint covers every own edit. "retained": the server refused the doc or
// generation; the rows stay a recoverable draft and the entry is dropped. "retry": the
// connection failed, the tab's socket serves another organization, or the checkpoint did not
// arrive in time; rows and entry wait for the next trigger. "held": an editor or a drain in
// another tab holds the doc, so nothing ran. Acceptance alone never drains.
export type DrainOutcome = "drained" | "retained" | "retry" | "held";

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
      isCheckpointed: () => !realtimeMultiplexer.getDocState(docName).checkpointPending,
    });
    let subscription: DocSubscription | null = null;
    let settled = false;
    let synced = false;
    // Lineage of the rows hydrated before attach; null while they wait for the server's.
    let held: string | null = null;
    let rowsRead = false;
    let retaining = false;
    let unsubscribeState = () => {};
    const timeout = setTimeout(() => finish("retry", true), DRAIN_TIMEOUT_MS);
    const finish = (outcome: DrainOutcome, backOff = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cancellations.delete(docName);
      unsubscribeState();
      if (backOff) delayNextAttempt(docName);
      else if (outcome !== "retry") forgetBackoff(docName);
      if (outcome !== "retry") clearPendingDoc(contentType, contentId);
      subscription?.destroy();
      awareness.destroy();
      void persistence
        .destroy({
          discard: outcome === "drained" && entry.discardOnClean,
          checkpointed: outcome === "drained",
        })
        .finally(() => {
          // Disposal records a denied doc again for unsent updates only its recovered draft holds.
          if (outcome === "retained") clearPendingDoc(contentType, contentId);
          ydoc.destroy();
          resolve(outcome);
        });
    };
    const settleOnCheckpoint = (state: RealtimeDocState) => {
      if (!state.checkpointPending) finish("drained");
    };
    // A refused doc keeps as a draft only what the server never accepted. Accepted edits still
    // checkpoint, so they stay on this device while the doc is viewable and go once it is not.
    const retainDenied = (noView: boolean) => {
      if (settled || retaining) return;
      retaining = true;
      const keepDraft = realtimeMultiplexer.getDocState(docName).transportPending;
      const settle = noView
        ? persistence.settleLostAccess({ keepDraft })
        : keepDraft
          ? persistence.quarantine()
          : Promise.resolve(true);
      void settle.finally(() => finish("retained"));
    };
    const attach = () =>
      realtimeMultiplexer.attach({
        contentType,
        contentId,
        organizationId: entry.organizationId,
        ydoc,
        awareness,
        heldGeneration: held,
        onSync: () => {
          // A reconnect syncs again; local recovery already read the device.
          if (synced) return;
          synced = true;
          // Rows of more than one lineage waited for the generation the server names.
          const read = rowsRead
            ? Promise.resolve()
            : persistence.hydrate({ serverGeneration: docGeneration(ydoc) }).then(() => {
                rowsRead = true;
              });
          void read.then(
            () => {
              if (settled) return;
              if (realtimeMultiplexer.isDocReadOnly(docName)) {
                retainDenied(false);
                return;
              }
              unsubscribeState = realtimeMultiplexer.subscribeDocState(docName, settleOnCheckpoint);
              settleOnCheckpoint(realtimeMultiplexer.getDocState(docName));
            },
            (error) => {
              console.warn("[realtime] drain hydrate failed", error);
              finish("retry", true);
            },
          );
        },
        onWriteDenied: (reason, noView) => {
          if (reason === SEED_CONFLICT_REASON) {
            void persistence.quarantine().then(() => finish("retained"));
          } else if (rowsRead) {
            // Read once the transport has recorded the refusal.
            queueMicrotask(() => retainDenied(noView));
          } else if (noView) {
            // Nothing synced and nothing will: the rows stay for a later attach that may see them.
            finish("retained");
          }
          // Otherwise a read-only doc still syncs, and local recovery reads the device first.
        },
        onGenerationMismatch: () => finish("retained"),
        // No server of this organization answered, so nothing proves access lost or edits saved.
        onOrganizationMismatch: () => finish("retry"),
        onCloseCode: (code) => {
          if (
            code === WS_CLOSE_UNAUTHENTICATED ||
            code === WS_CLOSE_FORBIDDEN ||
            code === WS_CLOSE_TOKEN_REVOKED
          )
            finish("retry");
        },
      });
    cancellations.set(docName, {
      organizationId: entry.organizationId,
      cancel: () => finish("retry"),
    });
    // Hydrating first makes the attaching SyncStep1 carry what this device holds, so the server
    // answers with what changed since instead of the whole document.
    void persistence.hydrate().then(
      (lineage) => {
        if (settled) return;
        if (realtimeMultiplexer.isAttached(docName)) {
          finish("retry");
          return;
        }
        held = lineage;
        rowsRead = lineage !== null;
        subscription = attach();
      },
      (error) => {
        console.warn("[realtime] drain hydrate failed", error);
        finish("retry", true);
      },
    );
  });
}

/** Starts a drain for every recorded doc of this user and organization that no editor holds and
 * that is not waiting out its backoff; returns the drains it started by doc name. */
export function runRealtimeDrain(scope: {
  userId: string;
  organizationId: string;
}): Map<string, Promise<DrainOutcome>> {
  const started = new Map<string, Promise<DrainOutcome>>();
  if (typeof navigator !== "undefined" && navigator.onLine === false) return started;
  if (!isStorageEncryptionReady()) return started;
  for (const entry of listPendingDocs()) {
    if (entry.userId !== scope.userId || entry.organizationId !== scope.organizationId) continue;
    const docName = docNameFor(entry.contentType, entry.contentId);
    if (active.has(docName) || realtimeMultiplexer.isAttached(docName)) continue;
    if (backoff.get(docName)?.waiting) continue;
    active.add(docName);
    // An editor opening here before the lock is granted cancels the drain before it reads rows.
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
    };
    cancellations.set(docName, { organizationId: entry.organizationId, cancel });
    started.set(
      docName,
      whenDocumentFree(docName, () =>
        cancelled ? Promise.resolve<DrainOutcome>("retry") : drainDoc(entry),
      )
        .then((outcome) => outcome ?? "held")
        .finally(() => {
          active.delete(docName);
          if (cancellations.get(docName)?.cancel === cancel) cancellations.delete(docName);
        }),
    );
  }
  return started;
}
