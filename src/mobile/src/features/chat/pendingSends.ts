import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
  digestStringAsync,
  CryptoDigestAlgorithm,
  randomUUID,
} from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { fromBase64 } from "lib0/buffer";
import { encodeUtf8, decodeUtf8 } from "lib0/string";
import { getServerUrl } from "@core/config/serverUrl";

export interface SendRequest {
  channelId: string;
  content: string;
  rootId?: string;
  replyToId?: string;
  attachmentFileIds?: string[];
  metadata?: Record<string, string>;
  alsoSendToChannel?: boolean;
  clientMessageId?: string;
}
export interface PendingSend {
  key: string;
  userId: string;
  organizationId: string;
  createdAt: string;
  request: SendRequest & { clientMessageId: string };
}
const generations = new Map<string, number>();
const keys = new Map<string, Promise<AESEncryptionKey>>();
let database: Promise<SQLiteDatabase> | undefined;
function open() {
  database ??= (async () => {
    const db = await openDatabaseAsync("chat-sends.db");
    await db.execAsync(`PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS sends (key TEXT PRIMARY KEY, user_id TEXT NOT NULL,
      organization_id TEXT NOT NULL, server TEXT NOT NULL, client_id TEXT NOT NULL, ciphertext BLOB NOT NULL);
      CREATE INDEX IF NOT EXISTS sends_scope ON sends(user_id, organization_id, server);`);
    return db;
  })();
  return database;
}
function encryptionKey(userId: string) {
  let loading = keys.get(userId);
  if (!loading) {
    loading = (async () => {
      const name = `chat.pending.${userId}`;
      const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
      const stored = await SecureStore.getItemAsync(name, options);
      if (stored) return AESEncryptionKey.import(stored, "hex");
      if (
        await (await open()).getFirstAsync("SELECT 1 FROM sends WHERE user_id = ? LIMIT 1", userId)
      )
        throw new Error("Pending message encryption key unavailable");
      const key = await AESEncryptionKey.generate();
      await SecureStore.setItemAsync(name, await key.encoded("hex"), options);
      return key;
    })();
    keys.set(userId, loading);
    void loading.catch(() => keys.delete(userId));
  }
  return loading;
}
export function sendFingerprint(request: SendRequest): string {
  return JSON.stringify([
    request.channelId,
    request.rootId ?? null,
    request.replyToId ?? null,
    request.content,
    request.attachmentFileIds ?? [],
    Object.entries(request.metadata ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    request.alsoSendToChannel ?? false,
  ]);
}
async function decrypt(
  row: { key: string; ciphertext: Uint8Array },
  userId: string,
): Promise<PendingSend> {
  const encoded = await aesDecryptAsync(
    AESSealedData.fromCombined(row.ciphertext),
    await encryptionKey(userId),
    { output: "base64", additionalData: encodeUtf8(row.key) },
  );
  return JSON.parse(decodeUtf8(fromBase64(encoded))) as PendingSend;
}
export async function preparePendingSend(
  userId: string,
  organizationId: string,
  request: SendRequest,
): Promise<PendingSend> {
  const generation = generations.get(userId);
  const server = getServerUrl();
  const hash = await digestStringAsync(CryptoDigestAlgorithm.SHA256, sendFingerprint(request));
  const key = JSON.stringify([server, userId, organizationId, hash]);
  const record: PendingSend = {
    key,
    userId,
    organizationId,
    createdAt: new Date().toISOString(),
    request: { ...request, clientMessageId: request.clientMessageId ?? randomUUID() },
  };
  const sealed = await aesEncryptAsync(
    encodeUtf8(JSON.stringify(record)),
    await encryptionKey(userId),
    { additionalData: encodeUtf8(key) },
  );
  const db = await open();
  const ciphertext = await sealed.combined();
  if (generation !== generations.get(userId)) throw new Error("Session changed");
  await db.runAsync(
    "INSERT OR IGNORE INTO sends(key, user_id, organization_id, server, client_id, ciphertext) SELECT ?, ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM sends WHERE user_id = ?) < 200",
    key,
    userId,
    organizationId,
    server,
    record.request.clientMessageId,
    ciphertext,
    userId,
  );
  const row = await db.getFirstAsync<{ key: string; ciphertext: Uint8Array }>(
    "SELECT key, ciphertext FROM sends WHERE key = ?",
    key,
  );
  if (!row) throw new Error("Pending message limit reached. Retry or discard pending sends first.");
  return decrypt(row, userId);
}
export async function pendingSends(userId: string, organizationId: string): Promise<PendingSend[]> {
  const rows = await (
    await open()
  ).getAllAsync<{ key: string; ciphertext: Uint8Array }>(
    "SELECT key, ciphertext FROM sends WHERE user_id = ? AND organization_id = ? AND server = ? ORDER BY rowid",
    userId,
    organizationId,
    getServerUrl(),
  );
  return Promise.all(rows.map((row) => decrypt(row, userId)));
}
export async function forgetPendingSend(record: PendingSend): Promise<void> {
  await (
    await open()
  ).runAsync(
    "DELETE FROM sends WHERE key = ? AND client_id = ?",
    record.key,
    record.request.clientMessageId,
  );
}
export async function clearPendingSends(userId: string, organizationId?: string): Promise<void> {
  generations.set(userId, (generations.get(userId) ?? 0) + 1);
  if (organizationId)
    await (
      await open()
    ).runAsync(
      "DELETE FROM sends WHERE user_id = ? AND organization_id = ? AND server = ?",
      userId,
      organizationId,
      getServerUrl(),
    );
  else {
    await (await open()).runAsync("DELETE FROM sends WHERE user_id = ?", userId);
    keys.delete(userId);
    await SecureStore.deleteItemAsync(`chat.pending.${userId}`);
  }
}

export async function pendingSendOrganizations(userId: string): Promise<string[]> {
  const rows = await (
    await open()
  ).getAllAsync<{ organization_id: string }>(
    "SELECT DISTINCT organization_id FROM sends WHERE user_id = ? AND server = ?",
    userId,
    getServerUrl(),
  );
  return rows.map((row) => row.organization_id);
}
