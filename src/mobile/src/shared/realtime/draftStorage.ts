import * as SecureStore from "expo-secure-store";
import * as Y from "yjs";
import { fromBase64, toBase64 } from "lib0/buffer";

import {
  clearEncryptedDrafts,
  decryptDraft,
  decryptUpdate,
  deleteEncryptedDrafts,
  deleteUpdateRecords,
  draftUser,
  encryptedDraftRecords,
  listEncryptedDraftKeys,
  replaceEncryptedDraft,
  updateRecords,
  writeUpdateRecords,
  type EncryptedDraftRecord,
  type UpdateRecordWrite,
} from "@shared/realtime/encryptedDraftStore";
import type {
  RealtimeDocState,
  RetainedUpdate,
  UpdateCoverageEvent,
} from "@shared/realtime/multiplexer";

const writes = new Map<string, Promise<void>>();
const pendingWrites = new Map<string, { update: Uint8Array; promise: Promise<void> }>();
const coverageWrites = new Map<
  string,
  { writes: Map<string, UpdateRecordWrite>; promise: Promise<void> | null }
>();
const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const signedOut = new Set<string>();
const saveListeners = new Set<(key: string) => void>();
// Recovered-draft id of a generation that only retained updates still hold.
const RETAINED_DRAFT_PREFIX = "retained.";

export function isDraftStorageActive(userId: string): boolean {
  return !signedOut.has(userId);
}

export function resumeDraftStorage(userId: string): void {
  signedOut.delete(userId);
}

export function listDraftKeys(userId: string): Promise<string[]> {
  const index = `realtime.index.${userId}`;
  return queue(index, async () => {
    const chunked = JSON.parse(
      (await SecureStore.getItemAsync(index, options)) ?? "[]",
    ) as string[];
    return [...new Set([...chunked, ...(await listEncryptedDraftKeys(userId))])];
  });
}

export async function clearUserDrafts(userId: string): Promise<void> {
  signedOut.add(userId);
  await settleDraftWrites();
  for (const key of await listDraftKeys(userId)) {
    for (const record of await readRecords(key)) await discardDraft(key, record.id);
    await SecureStore.deleteItemAsync(key, options);
  }
  await clearEncryptedDrafts(userId);
  await SecureStore.deleteItemAsync(`realtime.index.${userId}`, options);
  for (const key of coverageWrites.keys())
    if (draftUser(key) === userId) coverageWrites.delete(key);
}

/** Resolves once every queued draft and retained-update write has landed or failed. */
export async function settleDraftWrites(): Promise<void> {
  await Promise.allSettled(writes.values());
}

/** Fires with the document key after each stored draft save. */
export function subscribeDraftSaves(listener: (key: string) => void): () => void {
  saveListeners.add(listener);
  return () => {
    saveListeners.delete(listener);
  };
}

/** Drops a generation's device copy after a session or drain saw every own edit checkpointed. */
export function discardGeneration(key: string, generation: string): Promise<void> {
  return queue(key, async () => {
    // Retained updates still waiting for a checkpoint keep their generation's draft.
    if ((await updateRecords(key)).some((record) => record.generation === generation)) return;
    const records = await readRecords(key);
    const removed = records.filter((item) => item.generation === generation);
    await removeRecords(key, records, removed);
  });
}

/**
 * Persists own updates no checkpoint covers: raw bytes from the first local event, removal once a
 * checkpoint covers them. A receipt changes nothing on the device, since a restart replays every
 * retained update under its id. Writes coalesce while one is in flight; a failed batch rejects and
 * rejoins the next one.
 */
export function recordCoverage(
  key: string,
  generation: RealtimeDocState["generation"],
  events: readonly UpdateCoverageEvent[],
): Promise<void> {
  if (signedOut.has(draftUser(key))) return Promise.resolve();
  let queued = coverageWrites.get(key);
  if (!queued) {
    queued = { writes: new Map(), promise: null };
    coverageWrites.set(key, queued);
  }
  for (const event of events) {
    if (event.coverage === "checkpointed")
      queued.writes.set(event.updateId, { kind: "delete", updateId: event.updateId });
    // Without a generation the update can never replay, exactly like an unsaved draft.
    else if (event.coverage === "local" && generation)
      queued.writes.set(event.updateId, {
        kind: "put",
        record: { updateId: event.updateId, generation, editedAt: event.editedAt },
        update: event.update,
      });
  }
  if (queued.promise) return queued.promise;
  const batch = queued;
  const promise = queue(key, async () => {
    batch.promise = null;
    const pending = batch.writes;
    batch.writes = new Map();
    if (!pending.size || signedOut.has(draftUser(key))) return;
    try {
      await writeUpdateRecords(key, [...pending.values()]);
    } catch (error) {
      for (const [updateId, write] of batch.writes) pending.set(updateId, write);
      batch.writes = pending;
      throw error;
    }
  });
  batch.promise = promise;
  return promise;
}

/** Uncheckpointed own updates of one generation in creation order, for replay under their ids. */
export function readRetainedUpdates(key: string, generation: string): Promise<RetainedUpdate[]> {
  return queue(key, async () => {
    const retained: RetainedUpdate[] = [];
    for (const record of await updateRecords(key)) {
      if (record.generation !== generation) continue;
      try {
        const update = await decryptUpdate(key, record);
        retained.push({ updateId: record.updateId, update, editedAt: record.editedAt });
      } catch (error) {
        console.warn("[realtime] retained update could not be read", error);
      }
    }
    return retained;
  });
}

type DraftRecord = EncryptedDraftRecord | { generation: string; id: string; chunks: number };
export interface MobileRecoveredDraft {
  id: string;
  generation: string;
  base: string | null;
  text: string;
  update: string;
}

async function readRecords(key: string): Promise<DraftRecord[]> {
  return [...(await readChunkedRecords(key)), ...(await encryptedDraftRecords(key))];
}

async function readChunkedRecords(key: string): Promise<DraftRecord[]> {
  const raw = await SecureStore.getItemAsync(key, options);
  if (raw === null) return [];
  try {
    const records: unknown = JSON.parse(raw);
    if (
      !Array.isArray(records) ||
      !records.every(
        (record) =>
          record &&
          typeof record.id === "string" &&
          typeof record.generation === "string" &&
          Number.isSafeInteger(record.chunks) &&
          record.chunks > 0 &&
          record.chunks < 100000,
      )
    )
      throw new Error("Invalid draft manifest");
    return records as DraftRecord[];
  } catch {
    // Keep the unreadable manifest and its chunks before enabling fresh writes.
    await SecureStore.setItemAsync(`${key}.corrupt.${Date.now()}`, raw, options);
    await SecureStore.setItemAsync(key, "[]", options);
    return [];
  }
}

async function readRecord(key: string, record: DraftRecord): Promise<string> {
  if ("ciphertext" in record) return decryptDraft(key, record);
  let encoded = "";
  for (let index = 0; index < record.chunks; index++) {
    const chunk = await SecureStore.getItemAsync(`${key}.${record.id}.${index}`, options);
    if (chunk === null) throw new Error("Incomplete stored draft");
    encoded += chunk;
  }
  return encoded;
}

export function saveTextDraft(
  key: string,
  text: string,
  base: string | null,
  lineage: string,
): Promise<void> {
  const draft = new Y.Doc();
  draft.getMap("doc_meta").set("generation", `unmerged:${lineage}`);
  draft.getMap("draft_meta").set("base", base);
  draft.getText("markdown").insert(0, text);
  const saved = saveDraft(key, draft);
  draft.destroy();
  return saved;
}

export function saveDraft(key: string, doc: Y.Doc): Promise<void> {
  if (signedOut.has(draftUser(key))) return Promise.resolve();
  const update = Y.encodeStateAsUpdate(doc);
  const generation = String(doc.getMap("doc_meta").get("generation") ?? "");
  if (!generation) return Promise.resolve();
  const pendingKey = `${key}:${generation}`;
  const queued = pendingWrites.get(pendingKey);
  if (queued) {
    queued.update = generation.startsWith("unmerged:")
      ? update
      : Y.mergeUpdates([queued.update, update]);
    return queued.promise;
  }
  const pending = { update, promise: Promise.resolve() };
  const id = `${doc.guid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const write = (writes.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      pendingWrites.delete(pendingKey);
      const records = await readRecords(key);
      const replaced: DraftRecord[] = [];
      let merged = pending.update;
      for (const record of records.filter((item) => item.generation === generation)) {
        try {
          // Closing before hydration must not replace the only offline copy with server state.
          const previous = fromBase64(await readRecord(key, record));
          if (generation.startsWith("unmerged:")) Y.decodeUpdate(previous);
          else merged = Y.mergeUpdates([merged, previous]);
          replaced.push(record);
        } catch (error) {
          console.warn("[realtime] stored draft retained after read failure", error);
        }
      }
      await replaceEncryptedDraft(
        key,
        { id, generation },
        merged,
        replaced.filter((record) => "ciphertext" in record).map((record) => record.id),
      );
      // Commit the encrypted replacement before retiring any SecureStore source bytes.
      await removeChunkedRecords(key, records, replaced);
    });
  pending.promise = write;
  pendingWrites.set(pendingKey, pending);
  trackWrite(key, write);
  void write.then(
    () => {
      for (const listener of saveListeners) listener(key);
    },
    (error) => console.warn("[realtime] draft storage failed", error),
  );
  return write;
}

function queue<T>(key: string, action: () => Promise<T>): Promise<T> {
  const result = (writes.get(key) ?? Promise.resolve()).catch(() => {}).then(action);
  trackWrite(
    key,
    result.then(
      () => {},
      () => {},
    ),
  );
  return result;
}

function trackWrite(key: string, write: Promise<void>): void {
  writes.set(key, write);
  void write
    .finally(() => {
      if (writes.get(key) === write) writes.delete(key);
    })
    .catch(() => {});
}

export function readStoredDrafts(key: string): Promise<MobileRecoveredDraft[]> {
  return queue(key, () => readDrafts(key));
}

export function discardDraft(key: string, id: string): Promise<void> {
  return queue(key, async () => {
    if (id.startsWith(RETAINED_DRAFT_PREFIX)) {
      await deleteUpdateRecords(key, id.slice(RETAINED_DRAFT_PREFIX.length));
      return;
    }
    const records = await readRecords(key);
    const record = records.find((item) => item.id === id);
    if (!record) return;
    await removeRecords(key, records, [record]);
    // A discarded generation never replays, so its retained updates go with its last draft.
    if (!records.some((item) => item !== record && item.generation === record.generation))
      await deleteUpdateRecords(key, record.generation);
  });
}

async function removeRecords(
  key: string,
  records: DraftRecord[],
  removed: DraftRecord[],
): Promise<void> {
  await deleteEncryptedDrafts(
    key,
    removed.filter((record) => "ciphertext" in record).map((record) => record.id),
  );
  await removeChunkedRecords(key, records, removed);
}

async function removeChunkedRecords(
  key: string,
  records: DraftRecord[],
  removed: DraftRecord[],
): Promise<void> {
  const chunked = removed.filter((record) => "chunks" in record);
  if (!chunked.length) return;
  await SecureStore.setItemAsync(
    key,
    JSON.stringify(records.filter((record) => "chunks" in record && !removed.includes(record))),
    options,
  );
  for (const record of chunked)
    for (let index = 0; index < record.chunks; index++)
      await SecureStore.deleteItemAsync(`${key}.${record.id}.${index}`, options);
}

export function restoreDraft(
  key: string,
  doc: Y.Doc,
  origin: unknown,
  isActive: () => boolean = () => true,
): Promise<MobileRecoveredDraft[]> {
  return queue(key, async () => {
    const drafts = await readDrafts(key);
    if (!isActive()) return [];
    const generation = String(doc.getMap("doc_meta").get("generation") ?? "");
    for (const draft of drafts) {
      if (generation && draft.generation === generation) {
        Y.applyUpdate(doc, fromBase64(draft.update), origin);
      }
    }
    return drafts.filter(
      (draft) =>
        draft.generation !== generation && draft.text !== doc.getText("markdown").toString(),
    );
  });
}

async function readDrafts(key: string): Promise<MobileRecoveredDraft[]> {
  const records = await readRecords(key);
  const recovered: MobileRecoveredDraft[] = [];
  for (const record of records) {
    if (!record.generation) continue;
    try {
      const draft = describeDraft(await readRecord(key, record));
      recovered.push({ id: record.id, generation: record.generation, ...draft });
    } catch (error) {
      console.warn("[realtime] stored draft could not be read", error);
    }
  }
  // Retained updates are a draft of their own when no readable snapshot holds their generation.
  const retained = new Map<string, Uint8Array[]>();
  for (const record of await updateRecords(key)) {
    if (recovered.some((draft) => draft.generation === record.generation)) continue;
    try {
      const update = await decryptUpdate(key, record);
      retained.set(record.generation, [...(retained.get(record.generation) ?? []), update]);
    } catch (error) {
      console.warn("[realtime] retained update could not be read", error);
    }
  }
  for (const [generation, updates] of retained) {
    const draft = describeDraft(toBase64(Y.mergeUpdates(updates)));
    recovered.push({ id: `${RETAINED_DRAFT_PREFIX}${generation}`, generation, ...draft });
  }
  return recovered;
}

function describeDraft(encoded: string): Omit<MobileRecoveredDraft, "id" | "generation"> {
  const draft = new Y.Doc();
  try {
    Y.applyUpdate(draft, fromBase64(encoded));
    const base = draft.getMap("draft_meta").get("base");
    return {
      base: typeof base === "string" ? base : null,
      text: draft.getText("markdown").toString(),
      update: encoded,
    };
  } finally {
    draft.destroy();
  }
}
