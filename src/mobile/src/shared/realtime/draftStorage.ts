import * as SecureStore from "expo-secure-store";
import * as Y from "yjs";
import { fromBase64, toBase64 } from "lib0/buffer";

const writes = new Map<string, Promise<void>>();
const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const CHUNK_SIZE = 1500;

interface DraftRecord {
  generation: string;
  id: string;
  chunks: number;
}
export interface MobileRecoveredDraft {
  text: string;
  update: string;
}

async function readRecord(key: string, record: DraftRecord): Promise<string> {
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
): void {
  const draft = new Y.Doc();
  draft.getMap("doc_meta").set("generation", `unmerged:${lineage}`);
  draft.getMap("draft_meta").set("base", base);
  draft.getText("markdown").insert(0, text);
  void saveDraft(key, draft);
  draft.destroy();
}

export function saveDraft(key: string, doc: Y.Doc): Promise<void> {
  const update = Y.encodeStateAsUpdate(doc);
  const generation = String(doc.getMap("doc_meta").get("generation") ?? "");
  const id = `${doc.guid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const write = (writes.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const records: DraftRecord[] = JSON.parse(
        (await SecureStore.getItemAsync(key, options)) ?? "[]",
      );
      const replaced: DraftRecord[] = [];
      let merged = update;
      for (const record of records.filter((item) => item.generation === generation)) {
        try {
          // Closing before hydration must not replace the only offline copy with server state.
          if (!generation.startsWith("unmerged:")) {
            merged = Y.mergeUpdates([merged, fromBase64(await readRecord(key, record))]);
          }
          replaced.push(record);
        } catch (error) {
          console.warn("[realtime] stored draft retained after read failure", error);
        }
      }
      const value = toBase64(merged);
      const chunks = Math.ceil(value.length / CHUNK_SIZE);
      for (let index = 0; index < chunks; index++) {
        await SecureStore.setItemAsync(
          `${key}.${id}.${index}`,
          value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
          options,
        );
      }
      const retained = records.filter((record) => !replaced.includes(record));
      await SecureStore.setItemAsync(
        key,
        JSON.stringify([...retained, { generation, id, chunks }]),
        options,
      );
      for (const record of replaced) {
        for (let index = 0; index < record.chunks; index++)
          await SecureStore.deleteItemAsync(`${key}.${record.id}.${index}`, options);
      }
    });
  writes.set(key, write);
  void write.catch((error) => console.warn("[realtime] draft storage failed", error));
  return write;
}

export function restoreDraft(
  key: string,
  doc: Y.Doc,
  origin: unknown,
): Promise<MobileRecoveredDraft[]> {
  const recovery = (writes.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() => readDrafts(key, doc, origin));
  // A writer cannot remove chunks while recovery is reading its manifest.
  writes.set(
    key,
    recovery.then(() => {}),
  );
  return recovery;
}

async function readDrafts(
  key: string,
  doc: Y.Doc,
  origin: unknown,
): Promise<MobileRecoveredDraft[]> {
  const records: DraftRecord[] = JSON.parse((await SecureStore.getItemAsync(key, options)) ?? "[]");
  const generation = String(doc.getMap("doc_meta").get("generation") ?? "");
  const recovered: MobileRecoveredDraft[] = [];
  for (const record of records) {
    try {
      const encoded = await readRecord(key, record);
      const bytes = fromBase64(encoded);
      if (record.generation === generation) Y.applyUpdate(doc, bytes, origin);
      else {
        const draft = new Y.Doc();
        Y.applyUpdate(draft, bytes);
        const text = draft.getText("markdown").toString();
        if (text !== doc.getText("markdown").toString()) recovered.push({ text, update: encoded });
        draft.destroy();
      }
    } catch (error) {
      console.warn("[realtime] stored draft could not be read", error);
    }
  }
  return recovered;
}
