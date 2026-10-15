import * as SecureStore from "expo-secure-store";
import * as Y from "yjs";
import { fromBase64 } from "lib0/buffer";

import {
  clearEncryptedDrafts,
  decryptDraft,
  deleteEncryptedDrafts,
  draftUser,
  encryptedDraftRecords,
  listEncryptedDraftKeys,
  replaceEncryptedDraft,
  type EncryptedDraftRecord,
} from "@shared/realtime/encryptedDraftStore";

const writes = new Map<string, Promise<void>>();
const pendingWrites = new Map<string, { update: Uint8Array; promise: Promise<void> }>();
const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const signedOut = new Set<string>();

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
  await Promise.allSettled(writes.values());
  for (const key of await listDraftKeys(userId)) {
    for (const record of await readRecords(key)) await discardDraft(key, record.id);
    await SecureStore.deleteItemAsync(key, options);
  }
  await clearEncryptedDrafts(userId);
  await SecureStore.deleteItemAsync(`realtime.index.${userId}`, options);
}

export function discardGeneration(key: string, generation: string): Promise<void> {
  return queue(key, async () => {
    const records = await readRecords(key);
    const removed = records.filter((item) => item.generation === generation);
    await removeRecords(key, records, removed);
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
  void write.catch((error) => console.warn("[realtime] draft storage failed", error));
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
    const records = await readRecords(key);
    const record = records.find((item) => item.id === id);
    if (!record) return;
    await removeRecords(key, records, [record]);
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
    const draft = new Y.Doc();
    try {
      if (!record.generation) continue;
      const encoded = await readRecord(key, record);
      Y.applyUpdate(draft, fromBase64(encoded));
      const base = draft.getMap("draft_meta").get("base");
      recovered.push({
        id: record.id,
        generation: record.generation,
        base: typeof base === "string" ? base : null,
        text: draft.getText("markdown").toString(),
        update: encoded,
      });
    } catch (error) {
      console.warn("[realtime] stored draft could not be read", error);
    } finally {
      draft.destroy();
    }
  }
  return recovered;
}
