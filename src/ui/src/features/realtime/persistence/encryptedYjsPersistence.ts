import * as Y from "yjs";
import { getStoreRef } from "@/app/storeRef";
import { openDB, type IDBPDatabase, type IDBPObjectStore } from "idb";
import { docNameFor } from "@/features/realtime/docNames";
import { docGeneration } from "@/features/realtime/docGeneration";
import {
  MARKDOWN_MIRROR_FIELD,
  MARKDOWN_TEXT_FIELD,
  MIRROR_ACTIVE_KEY,
  PROSEMIRROR_FRAGMENT_FIELD,
  changedUnprojectedRoots,
  contentProjection,
} from "@/features/realtime/docContent";
import type { RetainedUpdate, UpdateCoverageEvent } from "@/features/realtime/multiplexer";
import type { ReceiptIdentity } from "@/features/realtime/updateCoverage";
import { randomUUID } from "@/shared/utils/uuid";
import {
  handOffPendingDoc,
  recordPendingDoc,
  type PendingDoc,
} from "@/features/realtime/pendingDocs";
import {
  ENCRYPTION_READY_EVENT,
  ENCRYPTION_REKEY_EVENT,
  ENCRYPTION_TEARDOWN_EVENT,
  decryptFromStorage,
  encryptForStorage,
  isStorageEncryptionReady,
  registerEncryptedDatabase,
} from "@/shared/crypto/storageEncryption";

const DB_NAME = "uniffy-realtime-yjs";
const DB_VERSION = 3;
const UPDATES_STORE = "updates";
const RECOVERY_GENERATION_PREFIX = "recovery:";
const PENDING_SEQ_PREFIX = "pending:";
type UpdateKey = [string, string, string, string];
type WriteStore = IDBPObjectStore<
  unknown,
  [typeof UPDATES_STORE],
  typeof UPDATES_STORE,
  "readwrite"
>;

export const persistenceRecoveryStats = { generationMismatchRows: 0 };

const allPendingWrites = new Set<Promise<void>>();

registerEncryptedDatabase(DB_NAME, async () => {
  await Promise.allSettled([...allPendingWrites, ...pendingDisposals.values()]);
  const pending = dbPromise;
  dbPromise = null;
  (await pending?.catch(() => null))?.close();
});

let dbPromise: Promise<IDBPDatabase> | null = null;
const pendingDisposals = new Map<string, Promise<void>>();
export const RECOVERY_AVAILABLE_EVENT = "uniffy:realtime:recovery";
const memoryRecovery = new Map<string, Map<string, RecoveredDraft>>();
const discardedRecovery = new WeakMap<Y.Doc, Set<string>>();
const recoveryKeys = new WeakMap<
  Y.Doc,
  { contentType: string; contentId: string; owner: string }
>();

export interface RecoveredDraft {
  /** Draft lineage: a replaced generation or a `recovery:` copy. */
  generation: string;
  text: string;
  update: string;
  hasFragment?: boolean;
}

/** Full document state from one session. `dirty` marks own edits no checkpoint is known to hold. */
interface SnapshotRow {
  kind: "snapshot";
  update: string;
  dirty: boolean;
  scope?: PendingDoc;
}

/** One own update the server has not checkpointed, kept under its update id until it is. */
interface PendingRow {
  kind: "pending";
  update: string;
  scope?: PendingDoc;
  updateId: string;
  editedAt: number;
  receipt: ReceiptIdentity | null;
}

type StoredRow =
  | { kind: "snapshot"; update: Uint8Array; dirty: boolean; scope?: PendingDoc }
  | { kind: "pending"; update: Uint8Array; scope?: PendingDoc; retained: RetainedUpdate };

function isReceipt(value: unknown): value is ReceiptIdentity | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const receipt = value as Record<string, unknown>;
  return (
    typeof receipt.generation === "string" &&
    typeof receipt.epoch === "string" &&
    Number.isSafeInteger(receipt.sequence) &&
    (receipt.sequence as number) >= 1
  );
}

// A row without a known kind carries no coverage identity, so nothing says what the server holds
// of it: it is never replayed, offered as a draft or drained.
function decodeRow(payload: unknown): StoredRow | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (typeof row.update !== "string") return null;
  const update = base64ToBytes(row.update);
  const scope = row.scope as PendingDoc | undefined;
  if (row.kind === "snapshot")
    return { kind: "snapshot", update, dirty: Boolean(row.dirty), scope };
  if (
    row.kind !== "pending" ||
    typeof row.updateId !== "string" ||
    typeof row.editedAt !== "number" ||
    !isReceipt(row.receipt)
  )
    return null;
  return {
    kind: "pending",
    update,
    scope,
    retained: { updateId: row.updateId, update, editedAt: row.editedAt, receipt: row.receipt },
  };
}

async function readRow(blob: unknown): Promise<StoredRow | null> {
  return decodeRow(await decryptFromStorage(blob as ArrayBuffer));
}

function isPendingKey(key: UpdateKey | string[]): boolean {
  return key.length === 4 && key[3].startsWith(PENDING_SEQ_PREFIX);
}

function snapshotSeqs(keys: UpdateKey[], generation: string): string[] {
  return keys
    .filter((key) => key.length === 4 && key[2] === generation && !isPendingKey(key))
    .map((key) => key[3]);
}

/** True when stored rows hold work for this user that no checkpoint covers; records drainable docs. */
export async function discoverStoredPendingDocs(userId: string): Promise<boolean> {
  if (!isStorageEncryptionReady()) return false;
  const db = await getDB();
  const blobs = await db.getAll(UPDATES_STORE);
  let pending = false;
  for (const blob of blobs) {
    let row: StoredRow | null;
    try {
      row = await readRow(blob);
    } catch {
      // Another user's encrypted rows cannot authorize a replay in this session.
      continue;
    }
    if (!row || (row.scope && row.scope.userId !== userId)) continue;
    if (row.kind !== "pending" && !row.dirty) continue;
    pending = true;
    if (row.scope) recordPendingDoc(row.scope);
  }
  return pending;
}

/** Drafts that hold a local user edit and cannot replay into the current generation.
 * Undecryptable rows and text-less documents are never listed. */
export async function readRecoveredDrafts(ydoc: Y.Doc): Promise<RecoveredDraft[]> {
  const key = recoveryKeys.get(ydoc);
  if (!key || docGeneration(ydoc) === null) return [];
  const retained = [
    ...(memoryRecovery
      .get(`${key.owner}:${docNameFor(key.contentType, key.contentId)}`)
      ?.values() ?? []),
  ];
  if (!isStorageEncryptionReady()) return retained;
  const db = await getDB();
  const tx = db.transaction(UPDATES_STORE, "readonly");
  const store = tx.objectStore(UPDATES_STORE);
  const range = rangeFor(key.contentType, key.contentId);
  const [keys, blobs] = await Promise.all([store.getAllKeys(range), store.getAll(range), tx.done]);
  const current = docGeneration(ydoc);
  if (current === null) return [];
  const documents = new Map<string, { doc: Y.Doc; dirty: boolean }>();
  for (let index = 0; index < keys.length; index++) {
    const rowKey = keys[index] as UpdateKey;
    // The live generation replays its rows; a key without a generation predates coverage identity.
    if (rowKey.length !== 4 || rowKey[2] === current) continue;
    let row: StoredRow | null;
    try {
      row = await readRow(blobs[index]);
    } catch {
      // Retain unreadable rows for later recovery with the matching key.
      continue;
    }
    if (!row) continue;
    const lineage = rowKey[2];
    const entry = documents.get(lineage) ?? { doc: new Y.Doc(), dirty: false };
    documents.set(lineage, entry);
    try {
      Y.applyUpdate(entry.doc, row.update);
      entry.dirty ||= row.kind === "pending" || row.dirty;
    } catch {
      // Corrupt bytes contribute nothing to the draft.
    }
  }
  const drafts: RecoveredDraft[] = [];
  for (const [lineage, entry] of documents) {
    const text = entry.doc.getText(MARKDOWN_TEXT_FIELD).toString();
    const hasFragment =
      entry.doc.getMap(MARKDOWN_MIRROR_FIELD).get(MIRROR_ACTIVE_KEY) !== false &&
      entry.doc.getXmlFragment(PROSEMIRROR_FRAGMENT_FIELD).length > 0;
    if (entry.dirty && (text.trim().length > 0 || hasFragment)) {
      drafts.push({
        generation: lineage,
        text,
        hasFragment,
        update: bytesToBase64(Y.encodeStateAsUpdate(entry.doc)),
      });
    }
    entry.doc.destroy();
  }
  return [
    ...drafts,
    ...retained.filter((draft) => !drafts.some((saved) => saved.generation === draft.generation)),
  ];
}

/** Deletes every row of one draft lineage for the document bound to `ydoc`. */
export async function discardRecoveredDraft(ydoc: Y.Doc, lineage: string): Promise<void> {
  const key = recoveryKeys.get(ydoc);
  if (!key) return;
  const discarded = discardedRecovery.get(ydoc) ?? new Set<string>();
  discarded.add(lineage);
  discardedRecovery.set(ydoc, discarded);
  memoryRecovery.get(`${key.owner}:${docNameFor(key.contentType, key.contentId)}`)?.delete(lineage);
  if (!isStorageEncryptionReady()) return;
  await writeRows(async (store, requests) => {
    const keys = (await store.getAllKeys(rangeFor(key.contentType, key.contentId))) as UpdateKey[];
    for (const rowKey of keys)
      if (rowKey.length === 4 && rowKey[2] === lineage) requests.push(store.delete(rowKey));
  });
}

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    const opening = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!Array.from(db.objectStoreNames).includes(UPDATES_STORE))
          db.createObjectStore(UPDATES_STORE);
      },
      blocking() {
        const pending = dbPromise;
        dbPromise = null;
        void pending?.then((db) => db.close());
      },
      terminated() {
        dbPromise = null;
      },
    });
    dbPromise = opening;
    // A failed open, such as a newer schema left by another tab, must not wedge every later read.
    opening.catch(() => {
      if (dbPromise === opening) dbPromise = null;
    });
  }
  return dbPromise;
}

// One readwrite transaction that lands whole or not at all.
async function writeRows(
  build: (store: WriteStore, requests: Promise<unknown>[]) => Promise<void> | void,
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(UPDATES_STORE, "readwrite");
  const requests: Promise<unknown>[] = [];
  try {
    await build(tx.objectStore(UPDATES_STORE), requests);
    await Promise.all([...requests, tx.done]);
  } catch (error) {
    // A request that throws leaves the earlier ones queued; aborting rolls them back.
    for (const request of [...requests, tx.done]) void request.catch(() => {});
    try {
      tx.abort();
    } catch {
      // The failed request already aborted it.
    }
    throw error;
  }
}

export const HYDRATION_ORIGIN = Symbol("uniffy.realtime.hydration");
export const REMOTE_ORIGIN = Symbol("uniffy.realtime.remote");
// The editor's Y.Text("markdown") mirror re-derives its content from the
// persisted fragment and also fires for remote ySync transactions, so
// persisting it would write peer edits into local IDB.
export const MARKDOWN_MIRROR_ORIGIN = Symbol("uniffy.realtime.markdownMirror");

export function isPersistedOrigin(origin: unknown): boolean {
  return (
    origin !== HYDRATION_ORIGIN && origin !== REMOTE_ORIGIN && origin !== MARKDOWN_MIRROR_ORIGIN
  );
}

// A random epoch per attach keys this session's rows, so a fresh attach or a
// concurrent tab can never overwrite another session's rows.
export function newPersistenceEpoch(): string {
  return randomUUID();
}

// Yjs updates are commutative, so replay order across epochs does not matter;
// zero-padding keeps one epoch's rows in write order anyway.
export function updateRowSeq(epoch: string, counter: number): string {
  return `${epoch}:${String(counter).padStart(10, "0")}`;
}

// A row may be folded into a snapshot only when its content is provably in
// this session's ydoc: rows replayed by hydrate, plus this epoch's own rows up
// to the counter captured when the snapshot was encoded.
export function selectCompactableSeqs(
  seqs: readonly string[],
  epoch: string,
  maxOwnCounter: number,
  hydratedSeqs: ReadonlySet<string>,
): string[] {
  const ownPrefix = `${epoch}:`;
  return seqs.filter((seq) => {
    if (hydratedSeqs.has(seq)) return true;
    if (!seq.startsWith(ownPrefix)) return false;
    return Number(seq.slice(ownPrefix.length)) <= maxOwnCounter;
  });
}

/** What local recovery needs from the realtime transport attached to the same document. */
export interface RecoveryTransport {
  subscribeCoverage(listener: (event: UpdateCoverageEvent) => void): () => void;
  /** Re-registers updates a previous session left unconfirmed, under their original ids. Called on
   * link and once hydration has read this device's rows, even when nothing is left to restore. */
  restorePending(updates: readonly RetainedUpdate[]): void;
  /** Some own edit, buffered ones included, is not in a checkpoint yet. */
  isCheckpointPending(): boolean;
}

export type DeviceStorage = "available" | "unavailable" | "failed";

/** What this device holds of a document's own edits. */
export interface DeviceRecoveryState {
  /** `unavailable` without a storage key; `failed` after a write error until a write succeeds. */
  storage: DeviceStorage;
  /** Some own edit is not written to this device yet. */
  unpersisted: boolean;
}

interface RecoverySession {
  link: (transport: RecoveryTransport) => void;
  device: () => DeviceRecoveryState;
  /** This session has read the device's rows for its generation, or has none it could read. */
  hydrated: () => boolean;
}

const recoverySessions = new Map<string, Set<RecoverySession>>();
const recoveryTransports = new Map<string, RecoveryTransport>();
const DEVICE_IDLE: DeviceRecoveryState = Object.freeze({
  storage: "available",
  unpersisted: false,
});
const deviceStates = new Map<string, DeviceRecoveryState>();
const deviceListeners = new Map<string, Set<(state: DeviceRecoveryState) => void>>();
const STORAGE_SEVERITY: Record<DeviceStorage, number> = { available: 0, unavailable: 1, failed: 2 };

/** Called when the transport attaches a document: its local recovery follows every coverage
 * transition and hands back what an earlier session left unconfirmed. */
export function linkRecovery(docName: string, transport: RecoveryTransport): () => void {
  recoveryTransports.set(docName, transport);
  for (const session of recoverySessions.get(docName) ?? []) session.link(transport);
  return () => {
    if (recoveryTransports.get(docName) === transport) recoveryTransports.delete(docName);
  };
}

/** False while some local recovery of the document has yet to read what this device holds, so
 * an edit an earlier session left unconfirmed may still be unknown to the transport. */
export function isRecoveryHydrated(docName: string): boolean {
  for (const session of recoverySessions.get(docName) ?? []) if (!session.hydrated()) return false;
  return true;
}

/** Stable snapshot for `useSyncExternalStore`; a document without local recovery reports idle. */
export function getDeviceRecoveryState(docName: string): DeviceRecoveryState {
  return deviceStates.get(docName) ?? DEVICE_IDLE;
}

export function subscribeDeviceRecovery(
  docName: string,
  listener: (state: DeviceRecoveryState) => void,
): () => void {
  const listeners = deviceListeners.get(docName) ?? new Set();
  deviceListeners.set(docName, listeners);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) deviceListeners.delete(docName);
  };
}

function publishDeviceState(docName: string): void {
  let storage: DeviceStorage = "available";
  let unpersisted = false;
  for (const session of recoverySessions.get(docName) ?? []) {
    const state = session.device();
    if (STORAGE_SEVERITY[state.storage] > STORAGE_SEVERITY[storage]) storage = state.storage;
    unpersisted ||= state.unpersisted;
  }
  const previous = getDeviceRecoveryState(docName);
  if (previous.storage === storage && previous.unpersisted === unpersisted) return;
  const next =
    storage === "available" && !unpersisted ? DEVICE_IDLE : Object.freeze({ storage, unpersisted });
  if (next === DEVICE_IDLE) deviceStates.delete(docName);
  else deviceStates.set(docName, next);
  for (const listener of deviceListeners.get(docName) ?? []) listener(next);
}

function sameReceipt(a: ReceiptIdentity | null, b: ReceiptIdentity | null): boolean {
  if (a === null || b === null) return a === b;
  return a.generation === b.generation && a.epoch === b.epoch && a.sequence === b.sequence;
}

export interface EncryptedPersistenceOptions {
  contentType: string;
  contentId: string;
  ydoc: Y.Doc;
  compactEvery?: number;
  scope?: PendingDoc;
  /** True while a checkpoint covers every local edit; snapshots taken then are a cache, not a draft. */
  isCheckpointed?: () => boolean;
}

export interface EncryptedPersistence {
  markCheckpointed: () => Promise<void>;
  hydrate: (options?: { serverGeneration: string | null }) => Promise<void>;
  compact: () => Promise<void>;
  /** Writes queued edits and coverage now; resolves once they are on this device or failed. */
  flush: () => Promise<void>;
  quarantine: () => Promise<boolean>;
  /** True once a local user edit changed document content in this session or in a hydrated row. */
  isDirty: () => boolean;
  /** `discard` drops this doc's snapshot rows instead of compacting them; `checkpointed` marks
   * the compacted snapshot as checkpointed so it is never offered as a draft. Updates no
   * checkpoint covers keep their rows either way. */
  destroy: (options?: { discard?: boolean; checkpointed?: boolean }) => Promise<void>;
}

interface TrackedUpdate {
  /** Generation the update's row is stored under. */
  generation: string;
  update: Uint8Array;
  editedAt: number;
  receipt: ReceiptIdentity | null;
}

function rangeFor(contentType: string, contentId: string): IDBKeyRange {
  // The third key component is always a string; an empty array sorts after
  // every string in IndexedDB key order.
  return IDBKeyRange.bound([contentType, contentId], [contentType, contentId, []]);
}

export function attachEncryptedPersistence(
  opts: EncryptedPersistenceOptions,
): EncryptedPersistence {
  const { contentType, contentId, ydoc } = opts;
  const owner = getStoreRef()?.getState().auth.user?.id ?? "";
  recoveryKeys.set(ydoc, { contentType, contentId, owner });
  const recoveryKey = `${owner}:${docNameFor(contentType, contentId)}`;
  const docKey = docNameFor(contentType, contentId);
  const previousDisposal = pendingDisposals.get(docKey);
  const compactEvery = opts.compactEvery ?? 100;

  const epoch = newPersistenceEpoch();
  let counter = 0;
  let localUpdates = 0;
  // `localUpdates` at the moment the newest stored snapshot was encoded.
  let persistedUpdates = 0;
  let storageFailed = false;
  let recoveryGeneration: string | null = null;
  const storageGeneration = () => recoveryGeneration ?? docGeneration(ydoc) ?? "";
  let dirty = false;
  let hydratedDirty = false;
  let beforeText: string | null = null;
  let checkpointedClose = false;
  const hydratedSeqs = new Set<string>();
  // Own updates no checkpoint covers yet; their rows go only when a checkpoint covers them.
  const tracked = new Map<string, TrackedUpdate>();
  // Checkpointed ids whose row deletion has not landed; hydration must not restore them.
  const retiring = new Set<string>();
  const rowChanges = new Map<string, { generation: string; row: TrackedUpdate | null }>();
  let snapshotRequested = false;
  let pendingCompact = false;
  let destroyed = false;
  let rowsRead = false;
  let destroyPromise: Promise<void> | null = null;
  const pendingWrites = new Set<Promise<void>>();
  let writeLoop: Promise<void> | null = null;
  let lastWriteFailed = false;
  let unsubscribeCoverage = () => {};

  const transport = () => recoveryTransports.get(docKey);
  const checkpointedNow = () =>
    checkpointedClose ||
    (!destroyed &&
      (opts.isCheckpointed?.() ?? false) &&
      !(transport()?.isCheckpointPending() ?? false));
  const holdsUncheckpointed = () =>
    tracked.size > 0 || ((dirty || hydratedDirty) && !checkpointedNow());
  // Closing now could lose an edit: it is not on this device and no checkpoint holds it.
  const atRisk = () => {
    if (localUpdates <= persistedUpdates) return false;
    const attached = destroyed ? undefined : transport();
    return attached ? attached.isCheckpointPending() : !checkpointedNow();
  };
  const publishDevice = () => publishDeviceState(docKey);

  const onBeforeTransaction = (transaction: Y.Transaction) => {
    if (destroyed || dirty || !isPersistedOrigin(transaction.origin)) return;
    beforeText = contentProjection(ydoc);
  };

  const onUpdate = (
    _update: Uint8Array,
    origin: unknown,
    _doc: Y.Doc,
    transaction: Y.Transaction,
  ) => {
    if (destroyed) return;
    if (!isPersistedOrigin(origin)) return;
    localUpdates++;
    if (!dirty) {
      dirty =
        (beforeText !== null && contentProjection(ydoc) !== beforeText) ||
        changedUnprojectedRoots(ydoc, transaction);
    }
    beforeText = null;
    snapshotRequested = true;
    requestWrite();
    publishDevice();
  };

  const onCoverage = (event: UpdateCoverageEvent) => {
    if (destroyed) return;
    const known = tracked.get(event.updateId);
    if (event.coverage === "checkpointed") {
      if (!known) return;
      tracked.delete(event.updateId);
      retiring.add(event.updateId);
      rowChanges.set(event.updateId, { generation: known.generation, row: null });
    } else {
      const update = event.coverage === "local" ? event.update : known?.update;
      const receipt = event.coverage === "accepted" ? event.receipt : null;
      if (!update || (known && sameReceipt(known.receipt, receipt))) return;
      const next = {
        generation: known?.generation ?? storageGeneration(),
        update,
        editedAt: event.editedAt,
        receipt,
      };
      tracked.set(event.updateId, next);
      rowChanges.set(event.updateId, { generation: next.generation, row: next });
    }
    requestWrite();
  };

  const retainedUpdates = (): RetainedUpdate[] =>
    [...tracked].map(([updateId, update]) => ({
      updateId,
      update: update.update,
      editedAt: update.editedAt,
      receipt: update.receipt,
    }));

  const session: RecoverySession = {
    link: (next) => {
      // A closing session's updates belong to its own generation. Its rows reach the next
      // session through hydration, which replays only the generation the server confirms.
      if (destroyed) return;
      unsubscribeCoverage();
      unsubscribeCoverage = next.subscribeCoverage(onCoverage);
      next.restorePending(retainedUpdates());
    },
    device: () => ({
      storage: !isStorageEncryptionReady() ? "unavailable" : storageFailed ? "failed" : "available",
      unpersisted: localUpdates > persistedUpdates,
    }),
    hydrated: () => rowsRead || destroyed,
  };

  function finishHydration(restored: RetainedUpdate[]): void {
    rowsRead = true;
    transport()?.restorePending(restored);
  }

  function snapshotRow(update: Uint8Array): SnapshotRow {
    return {
      kind: "snapshot",
      update: bytesToBase64(update),
      dirty: (dirty || hydratedDirty) && !checkpointedNow(),
      scope: opts.scope,
    };
  }

  function pendingRow(updateId: string, update: TrackedUpdate): PendingRow {
    return {
      kind: "pending",
      update: bytesToBase64(update.update),
      scope: opts.scope,
      updateId,
      editedAt: update.editedAt,
      receipt: update.receipt,
    };
  }

  function pendingKey(generation: string, updateId: string): UpdateKey {
    return [contentType, contentId, generation, `${PENDING_SEQ_PREFIX}${updateId}`];
  }

  function requestWrite(): void {
    if (writeLoop || !isStorageEncryptionReady()) return;
    if (!snapshotRequested && rowChanges.size === 0) return;
    const loop = (async () => {
      // Every update listener runs first, so the transport already counts this edit as pending.
      await Promise.resolve();
      while (snapshotRequested || rowChanges.size > 0) {
        if (!(await writeBatch())) break;
      }
    })();
    writeLoop = loop;
    pendingWrites.add(loop);
    allPendingWrites.add(loop);
    void loop.finally(() => {
      pendingWrites.delete(loop);
      allPendingWrites.delete(loop);
      writeLoop = null;
      publishDevice();
      // Work queued while the loop wound down; a failed write waits for the next trigger.
      if (!lastWriteFailed) requestWrite();
    });
  }

  async function settleWrites(): Promise<void> {
    while (writeLoop) await writeLoop;
  }

  async function writeBatch(): Promise<boolean> {
    const generation = storageGeneration();
    const writeSnapshot = snapshotRequested && !discardedRecovery.get(ydoc)?.has(generation);
    snapshotRequested = false;
    const changes = [...rowChanges];
    rowChanges.clear();
    const encodedAt = localUpdates;
    // Allocated with the encode, so any own row at or below the counter a compaction captures
    // is inside its snapshot.
    const allocated = writeSnapshot ? ++counter : counter;
    const snapshot = writeSnapshot ? snapshotRow(Y.encodeStateAsUpdate(ydoc)) : null;
    try {
      const snapshotBlob = snapshot && (await encryptForStorage(snapshot));
      const puts = await Promise.all(
        changes.flatMap(([updateId, change]) =>
          change.row && !discardedRecovery.get(ydoc)?.has(change.generation)
            ? [
                encryptForStorage(pendingRow(updateId, change.row)).then((blob) => ({
                  key: pendingKey(change.generation, updateId),
                  blob,
                })),
              ]
            : [],
        ),
      );
      await writeRows(async (store, requests) => {
        if (snapshotBlob) {
          const keys = (await store.getAllKeys(rangeFor(contentType, contentId))) as UpdateKey[];
          const prior = selectCompactableSeqs(
            snapshotSeqs(keys, generation),
            epoch,
            allocated,
            new Set(),
          );
          for (const seq of prior)
            requests.push(store.delete([contentType, contentId, generation, seq]));
          requests.push(
            store.put(snapshotBlob, [
              contentType,
              contentId,
              generation,
              updateRowSeq(epoch, allocated),
            ]),
          );
        }
        for (const { key, blob } of puts) requests.push(store.put(blob, key));
        for (const [updateId, change] of changes) {
          if (!change.row) requests.push(store.delete(pendingKey(change.generation, updateId)));
        }
      });
    } catch (err) {
      console.warn("[realtime] encrypted persistence write failed", err);
      if (writeSnapshot) snapshotRequested = true;
      for (const [updateId, change] of changes) {
        if (!rowChanges.has(updateId)) rowChanges.set(updateId, change);
      }
      storageFailed = true;
      lastWriteFailed = true;
      return false;
    }
    storageFailed = false;
    lastWriteFailed = false;
    if (snapshot) persistedUpdates = Math.max(persistedUpdates, encodedAt);
    for (const [updateId, change] of changes) if (!change.row) retiring.delete(updateId);
    if (opts.scope && holdsUncheckpointed()) recordPendingDoc(opts.scope);
    if (writeSnapshot && allocated % compactEvery === 0 && !pendingCompact) {
      pendingCompact = true;
      queueMicrotask(() => {
        pendingCompact = false;
        void compact();
      });
    }
    return true;
  }

  let hydration = Promise.resolve();
  function hydrate(options?: { serverGeneration: string | null }): Promise<void> {
    hydration = hydration.then(() => hydrateRows(options));
    return hydration;
  }

  async function hydrateRows(options?: { serverGeneration: string | null }): Promise<void> {
    await previousDisposal;
    if (destroyed) return;
    if (!isStorageEncryptionReady()) {
      finishHydration([]);
      return;
    }
    try {
      const db = await getDB();
      const tx = db.transaction(UPDATES_STORE, "readonly");
      const store = tx.objectStore(UPDATES_STORE);
      const range = rangeFor(contentType, contentId);
      const [keys, blobs] = await Promise.all([
        store.getAllKeys(range),
        store.getAll(range),
        tx.done,
      ]);
      if (!options) {
        const generations = new Set(
          (keys as UpdateKey[])
            .filter((key) => key.length === 4 && !key[2].startsWith(RECOVERY_GENERATION_PREFIX))
            .map((key) => key[2]),
        );
        const current = docGeneration(ydoc);
        if (current !== null) options = { serverGeneration: current };
        else if (generations.size === 1) options = { serverGeneration: [...generations][0] };
        else return;
      }
      // The server value was captured before replay. Reading the merged map
      // here would let a stale local LWW entry decide whether it is current.
      const replayGeneration = options.serverGeneration ?? "";
      const rejected = (keys as UpdateKey[]).filter(
        (key) => key.length === 4 && key[2] !== replayGeneration,
      );
      const restored: RetainedUpdate[] = [];
      for (let i = 0; i < blobs.length; i++) {
        const key = keys[i] as UpdateKey;
        if (
          key.length !== 4 ||
          key[2] !== replayGeneration ||
          key[2].startsWith(RECOVERY_GENERATION_PREFIX)
        )
          continue;
        try {
          const row = await readRow(blobs[i]);
          if (destroyed) return;
          if (!row) continue;
          if (row.update.length > 0) Y.applyUpdate(ydoc, row.update, HYDRATION_ORIGIN);
          if (row.kind === "pending") {
            hydratedDirty = true;
            const { updateId, editedAt, receipt } = row.retained;
            if (tracked.has(updateId) || retiring.has(updateId)) continue;
            tracked.set(updateId, { generation: key[2], update: row.update, editedAt, receipt });
            restored.push(row.retained);
          } else {
            hydratedSeqs.add(key[3]);
            hydratedDirty ||= row.dirty;
          }
        } catch {
          // Skip rows that fail to decrypt (rotated DEK, corruption). They
          // also stay out of hydratedSeqs, so compact never deletes content
          // this session has not applied.
        }
      }
      if (rejected.length > 0) {
        persistenceRecoveryStats.generationMismatchRows += rejected.length;
        console.warn("[realtime] retained recovery rows", {
          docKey,
          otherGenerations: rejected.length,
        });
        window.dispatchEvent(new Event(RECOVERY_AVAILABLE_EVENT));
      }
      finishHydration(restored);
    } catch (err) {
      console.warn("[realtime] encrypted persistence hydrate failed", err);
      throw err;
    }
  }

  async function quarantine(): Promise<boolean> {
    await hydration.catch(() => {});
    const previousGeneration = storageGeneration();
    recoveryGeneration = `${RECOVERY_GENERATION_PREFIX}${randomUUID()}`;
    // The recovery copy holds these updates, so their rows leave the lineage they would replay into.
    const moved = [...tracked.keys()].filter(
      (updateId) => tracked.get(updateId)?.generation === previousGeneration,
    );
    for (const updateId of moved) {
      tracked.delete(updateId);
      rowChanges.delete(updateId);
    }
    const update = bytesToBase64(Y.encodeStateAsUpdate(ydoc));
    const retained = memoryRecovery.get(recoveryKey) ?? new Map<string, RecoveredDraft>();
    memoryRecovery.set(recoveryKey, retained);
    retained.set(recoveryGeneration, {
      generation: recoveryGeneration,
      update,
      text: ydoc.getText(MARKDOWN_TEXT_FIELD).toString(),
      hasFragment:
        ydoc.getMap(MARKDOWN_MIRROR_FIELD).get(MIRROR_ACTIVE_KEY) !== false &&
        ydoc.getXmlFragment(PROSEMIRROR_FRAGMENT_FIELD).length > 0,
    });
    dirty = true;
    try {
      await settleWrites();
      if (isStorageEncryptionReady()) {
        const blob = await encryptForStorage({
          kind: "snapshot",
          update,
          dirty: true,
        } satisfies SnapshotRow);
        const target = recoveryGeneration;
        await writeRows(async (store, requests) => {
          const keys = (await store.getAllKeys(rangeFor(contentType, contentId))) as UpdateKey[];
          const removable = selectCompactableSeqs(
            snapshotSeqs(keys, previousGeneration),
            epoch,
            counter,
            hydratedSeqs,
          );
          for (const seq of removable)
            requests.push(store.delete([contentType, contentId, previousGeneration, seq]));
          for (const updateId of moved)
            requests.push(store.delete(pendingKey(previousGeneration, updateId)));
          requests.push(
            store.put(blob, [contentType, contentId, target, updateRowSeq(epoch, ++counter)]),
          );
        });
        hydratedSeqs.clear();
      }
      window.dispatchEvent(new Event(RECOVERY_AVAILABLE_EVENT));
      return true;
    } catch (error) {
      console.warn("[realtime] could not isolate rejected draft", error);
      window.dispatchEvent(new Event(RECOVERY_AVAILABLE_EVENT));
      return false;
    }
  }

  async function compact(): Promise<void> {
    if (!isStorageEncryptionReady()) return;
    if (discardedRecovery.get(ydoc)?.has(storageGeneration())) return;
    // Nothing local happened: no edit, no hydrated row. A snapshot would only
    // add a row of server state that later reads as a phantom draft.
    if (localUpdates === 0 && hydratedSeqs.size === 0) return;
    // Captured with the encode: any own row at or below this counter was
    // applied to the ydoc first, so the snapshot subsumes it. Rows outside
    // the selection (another tab's live writes, an own write landing after
    // this transaction, pending updates) stay in place and are re-applied by
    // a later hydrate, which is safe because Yjs updates are idempotent.
    const snapshotCounter = counter;
    const encodedAt = localUpdates;
    const generation = storageGeneration();
    try {
      const blob = await encryptForStorage(snapshotRow(Y.encodeStateAsUpdate(ydoc)));
      if (generation !== storageGeneration()) return;
      let removable: string[] = [];
      await writeRows(async (store, requests) => {
        const keys = (await store.getAllKeys(rangeFor(contentType, contentId))) as UpdateKey[];
        removable = selectCompactableSeqs(
          snapshotSeqs(keys, generation),
          epoch,
          snapshotCounter,
          hydratedSeqs,
        );
        for (const seq of removable)
          requests.push(store.delete([contentType, contentId, generation, seq]));
        requests.push(
          store.put(blob, [contentType, contentId, generation, updateRowSeq(epoch, ++counter)]),
        );
      });
      for (const seq of removable) hydratedSeqs.delete(seq);
      storageFailed = false;
      persistedUpdates = Math.max(persistedUpdates, encodedAt);
    } catch (err) {
      console.warn("[realtime] encrypted persistence compact failed", err);
      storageFailed = true;
    }
    publishDevice();
  }

  async function clear(): Promise<void> {
    if (!isStorageEncryptionReady()) return;
    try {
      const generation = storageGeneration();
      await writeRows(async (store, requests) => {
        const keys = (await store.getAllKeys(rangeFor(contentType, contentId))) as UpdateKey[];
        const removable = selectCompactableSeqs(
          snapshotSeqs(keys, generation),
          epoch,
          counter,
          hydratedSeqs,
        );
        for (const seq of removable)
          requests.push(store.delete([contentType, contentId, generation, seq]));
      });
      hydratedSeqs.clear();
    } catch (err) {
      console.warn("[realtime] encrypted persistence clear failed", err);
      storageFailed = true;
    }
  }

  async function flush(): Promise<void> {
    if (localUpdates > persistedUpdates) snapshotRequested = true;
    lastWriteFailed = false;
    requestWrite();
    await settleWrites();
  }

  function destroy(options?: { discard?: boolean; checkpointed?: boolean }): Promise<void> {
    if (destroyPromise) return destroyPromise;
    destroyed = true;
    checkpointedClose = Boolean(options?.checkpointed);
    ydoc.off("beforeTransaction", onBeforeTransaction);
    ydoc.off("update", onUpdate);
    unsubscribeCoverage();
    window.removeEventListener(ENCRYPTION_REKEY_EVENT, handleRekey);
    window.removeEventListener(ENCRYPTION_READY_EVENT, handleReady);
    window.removeEventListener(ENCRYPTION_TEARDOWN_EVENT, publishDevice);
    window.removeEventListener("pagehide", handlePageHide);
    requestWrite();
    const finish = options?.discard ? clear : compact;
    const disposal = settleWrites()
      .then(finish)
      .then(() => {
        // Whatever no checkpoint covers stays with the drain until one does.
        if (opts.scope && tracked.size > 0 && isStorageEncryptionReady() && !storageFailed)
          handOffPendingDoc(opts.scope);
      });
    pendingDisposals.set(docKey, disposal);
    destroyPromise = disposal.finally(() => {
      if (pendingDisposals.get(docKey) === disposal) pendingDisposals.delete(docKey);
      // The unload guard stays until the final write has landed.
      window.removeEventListener("beforeunload", handleBeforeUnload);
      sessions.delete(session);
      if (sessions.size === 0 && recoverySessions.get(docKey) === sessions)
        recoverySessions.delete(docKey);
      publishDevice();
    });
    return destroyPromise;
  }

  const requeueAll = () => {
    if (localUpdates > 0) snapshotRequested = true;
    for (const [updateId, update] of tracked) {
      rowChanges.set(updateId, { generation: update.generation, row: update });
    }
    lastWriteFailed = false;
    requestWrite();
    publishDevice();
  };
  const handleRekey = () => {
    // The rekey path wipes the whole DB, so seqs recorded by hydrate no
    // longer exist; this session's edits and pending updates re-seed it.
    hydratedSeqs.clear();
    requeueAll();
  };
  const handleReady = () => requeueAll();
  const handlePageHide = () => {
    void flush();
  };
  const handleBeforeUnload = (event: BeforeUnloadEvent) => {
    void flush();
    if (!atRisk()) return;
    event.preventDefault();
    event.returnValue = "";
  };

  ydoc.on("beforeTransaction", onBeforeTransaction);
  ydoc.on("update", onUpdate);
  window.addEventListener(ENCRYPTION_REKEY_EVENT, handleRekey);
  window.addEventListener(ENCRYPTION_READY_EVENT, handleReady);
  window.addEventListener(ENCRYPTION_TEARDOWN_EVENT, publishDevice);
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("beforeunload", handleBeforeUnload);
  const sessions = recoverySessions.get(docKey) ?? new Set<RecoverySession>();
  recoverySessions.set(docKey, sessions);
  sessions.add(session);
  const attached = transport();
  if (attached) session.link(attached);
  publishDevice();

  const markCheckpointed = async () => {
    await settleWrites();
    if (!destroyed && checkpointedNow()) await compact();
  };
  return {
    hydrate,
    compact,
    markCheckpointed,
    flush,
    quarantine,
    isDirty: () => dirty || hydratedDirty,
    destroy,
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function base64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
