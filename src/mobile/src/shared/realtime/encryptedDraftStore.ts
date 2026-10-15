import { AESEncryptionKey, AESSealedData, aesDecryptAsync, aesEncryptAsync } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { encodeUtf8 } from "lib0/string";

const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
const databases = new Map<string, Promise<SQLiteDatabase>>();
const keys = new Map<string, Promise<AESEncryptionKey>>();
const transactions = new Map<string, Promise<unknown>>();

export interface EncryptedDraftRecord {
  id: string;
  generation: string;
  ciphertext: Uint8Array;
}

export function draftUser(key: string): string {
  const user = key.split(".")[1];
  if (!user || !/^[a-zA-Z0-9-]+$/.test(user)) throw new Error("Invalid draft user scope");
  return user;
}

function databaseName(user: string): string {
  if (!/^[a-zA-Z0-9-]+$/.test(user)) throw new Error("Invalid draft user scope");
  return `realtime-${user}.db`;
}

function database(user: string): Promise<SQLiteDatabase> {
  const existing = databases.get(user);
  if (existing) return existing;
  const opening = (async () => {
    const db = await openDatabaseAsync(databaseName(user));
    try {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = FULL;
        CREATE TABLE IF NOT EXISTS drafts (
          document TEXT NOT NULL, id TEXT NOT NULL, generation TEXT NOT NULL,
          ciphertext BLOB NOT NULL, PRIMARY KEY (document, id)
        );
      `);
      return db;
    } catch (error) {
      await db.closeAsync();
      throw error;
    }
  })();
  databases.set(user, opening);
  void opening.catch(() => databases.delete(user));
  return opening;
}

function encryptionKey(user: string): Promise<AESEncryptionKey> {
  const existing = keys.get(user);
  if (existing) return existing;
  const loading = (async () => {
    const name = `realtime.key.${user}`;
    const encoded = await SecureStore.getItemAsync(name, options);
    if (encoded) return AESEncryptionKey.import(encoded, "hex");
    const db = await database(user);
    if (await db.getFirstAsync("SELECT 1 FROM drafts LIMIT 1"))
      throw new Error("Draft encryption key unavailable");
    const key = await AESEncryptionKey.generate();
    await SecureStore.setItemAsync(name, await key.encoded("hex"), options);
    return key;
  })();
  keys.set(user, loading);
  void loading.catch(() => keys.delete(user));
  return loading;
}

function additionalData(key: string, record: Pick<EncryptedDraftRecord, "id" | "generation">) {
  return encodeUtf8(JSON.stringify([key, record.id, record.generation]));
}

export async function encryptedDraftRecords(key: string): Promise<EncryptedDraftRecord[]> {
  const db = await database(draftUser(key));
  return db.getAllAsync<EncryptedDraftRecord>(
    "SELECT id, generation, ciphertext FROM drafts WHERE document = ? ORDER BY rowid",
    key,
  );
}

export async function decryptDraft(key: string, record: EncryptedDraftRecord): Promise<string> {
  return aesDecryptAsync(
    AESSealedData.fromCombined(record.ciphertext),
    await encryptionKey(draftUser(key)),
    { output: "base64", additionalData: additionalData(key, record) },
  );
}

function transaction<T>(user: string, action: (db: SQLiteDatabase) => Promise<T>): Promise<T> {
  // One writer per user prevents exclusive transactions on different docs from colliding.
  const result = (transactions.get(user) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const db = await database(user);
      let value!: T;
      await db.withExclusiveTransactionAsync(async (tx) => {
        value = await action(tx);
      });
      return value;
    });
  transactions.set(user, result);
  void result
    .finally(() => {
      if (transactions.get(user) === result) transactions.delete(user);
    })
    .catch(() => {});
  return result;
}

export async function replaceEncryptedDraft(
  key: string,
  record: { id: string; generation: string },
  update: Uint8Array,
  replaced: string[],
): Promise<void> {
  const user = draftUser(key);
  const sealed = await aesEncryptAsync(update, await encryptionKey(user), {
    additionalData: additionalData(key, record),
  });
  const ciphertext = await sealed.combined();
  await transaction(user, async (db) => {
    await db.runAsync(
      "INSERT INTO drafts (document, id, generation, ciphertext) VALUES (?, ?, ?, ?)",
      key,
      record.id,
      record.generation,
      ciphertext,
    );
    for (const id of replaced)
      await db.runAsync("DELETE FROM drafts WHERE document = ? AND id = ?", key, id);
  });
}

export async function deleteEncryptedDrafts(key: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  await transaction(draftUser(key), async (db) => {
    for (const id of ids)
      await db.runAsync("DELETE FROM drafts WHERE document = ? AND id = ?", key, id);
  });
}

export async function listEncryptedDraftKeys(user: string): Promise<string[]> {
  const db = await database(user);
  const rows = await db.getAllAsync<{ document: string }>("SELECT DISTINCT document FROM drafts");
  return rows.map((row) => row.document);
}

export async function clearEncryptedDrafts(user: string): Promise<void> {
  await transactions.get(user)?.catch(() => {});
  const db = databases.get(user);
  if (db) await (await db).closeAsync();
  databases.delete(user);
  await deleteDatabaseAsync(databaseName(user));
  await SecureStore.deleteItemAsync(`realtime.key.${user}`, options);
  keys.delete(user);
}
