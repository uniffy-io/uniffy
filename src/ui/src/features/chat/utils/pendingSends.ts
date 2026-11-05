import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { randomUUID } from "@/shared/utils/uuid";
import {
  decryptFromStorage,
  encryptForStorage,
  registerEncryptedDatabase,
  ENCRYPTION_TEARDOWN_EVENT,
  ENCRYPTION_REKEY_EVENT,
} from "@/shared/crypto/storageEncryption";

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
interface PendingDatabase extends DBSchema {
  sends: {
    key: string;
    value: { key: string; scope: string; userId: string; ciphertext: ArrayBuffer };
    indexes: { scope: string; userId: string };
  };
}
const volatileSends = new Map<string, PendingSend>();
let storageEpoch = 0;
if (typeof window !== "undefined") {
  const invalidate = () => {
    storageEpoch++;
    volatileSends.clear();
  };
  window.addEventListener(ENCRYPTION_TEARDOWN_EVENT, invalidate);
  window.addEventListener(ENCRYPTION_REKEY_EVENT, invalidate);
}
const generations = new Map<string, number>();
const generation = (userId: string, organizationId: string) =>
  `${generations.get(userId) ?? 0}:${generations.get(`${userId}:${organizationId}`) ?? 0}`;
const DATABASE = "uniffy-chat-sends";
let database: Promise<IDBPDatabase<PendingDatabase>> | undefined;
function open() {
  if (!database) {
    database = openDB<PendingDatabase>(DATABASE, 1, {
      upgrade(db) {
        const store = db.createObjectStore("sends", { keyPath: "key" });
        store.createIndex("scope", "scope");
        store.createIndex("userId", "userId");
      },
      blocking() {
        void database?.then((db) => db.close());
        database = undefined;
      },
      terminated() {
        database = undefined;
      },
    });
    registerEncryptedDatabase(DATABASE, async () => {
      (await database)?.close();
      database = undefined;
    });
    void database.catch(() => {
      database = undefined;
    });
  }
  return database;
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
export async function preparePendingSend(
  userId: string,
  organizationId: string,
  request: SendRequest,
): Promise<PendingSend> {
  if (!crypto.subtle) {
    const key = JSON.stringify([userId, organizationId, sendFingerprint(request)]);
    const existing = volatileSends.get(key);
    if (existing) return existing;
    if (volatileSends.size >= 200)
      throw new Error("Pending message limit reached. Retry or discard pending sends first.");
    const record: PendingSend = {
      key,
      userId,
      organizationId,
      createdAt: new Date().toISOString(),
      request: { ...request, clientMessageId: request.clientMessageId ?? randomUUID() },
    };
    volatileSends.set(key, record);
    return record;
  }
  const epoch = generation(userId, organizationId);
  const keyEpoch = storageEpoch;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(sendFingerprint(request)),
  );
  const hash = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, "0")).join("");
  const scope = `${userId}:${organizationId}`;
  const key = `${scope}:${hash}`;
  const aad = new TextEncoder().encode(key);
  const record: PendingSend = {
    key,
    userId,
    organizationId,
    createdAt: new Date().toISOString(),
    request: { ...request, clientMessageId: request.clientMessageId ?? randomUUID() },
  };
  const ciphertext = await encryptForStorage(record, aad);
  const db = await open();
  if (generation(userId, organizationId) !== epoch || keyEpoch !== storageEpoch)
    throw new Error("Session changed");
  const tx = db.transaction("sends", "readwrite");
  const existing = await tx.store.get(key);
  if (!existing && (await tx.store.index("userId").count(userId)) >= 200) {
    await tx.done;
    throw new Error("Pending message limit reached. Retry or discard pending sends first.");
  }
  if (!existing) await tx.store.put({ key, scope, userId, ciphertext });
  await tx.done;
  return existing ? decryptFromStorage<PendingSend>(existing.ciphertext, aad) : record;
}
export async function pendingSends(userId: string, organizationId: string): Promise<PendingSend[]> {
  if (!crypto.subtle)
    return [...volatileSends.values()].filter(
      (row) => row.userId === userId && row.organizationId === organizationId,
    );
  const rows = await (
    await open()
  ).getAllFromIndex("sends", "scope", `${userId}:${organizationId}`);
  return Promise.all(
    rows.map((row) =>
      decryptFromStorage<PendingSend>(row.ciphertext, new TextEncoder().encode(row.key)),
    ),
  );
}
export async function forgetPendingSend(record: PendingSend): Promise<void> {
  if (!crypto.subtle) {
    if (volatileSends.get(record.key)?.request.clientMessageId === record.request.clientMessageId)
      volatileSends.delete(record.key);
    return;
  }
  const db = await open();
  const current = await db.get("sends", record.key);
  if (!current) return;
  const stored = await decryptFromStorage<PendingSend>(
    current.ciphertext,
    new TextEncoder().encode(record.key),
  );
  if (stored.request.clientMessageId !== record.request.clientMessageId) return;
  const tx = db.transaction("sends", "readwrite");
  const latest = await tx.store.get(record.key);
  const bytes = new Uint8Array(current.ciphertext);
  if (
    latest &&
    latest.ciphertext.byteLength === bytes.byteLength &&
    new Uint8Array(latest.ciphertext).every((v, i) => v === bytes[i])
  )
    await tx.store.delete(record.key);
  await tx.done;
}
export async function clearPendingSends(userId: string, organizationId?: string): Promise<void> {
  for (const [key, row] of volatileSends)
    if (row.userId === userId && (!organizationId || row.organizationId === organizationId))
      volatileSends.delete(key);
  const scope = organizationId ? `${userId}:${organizationId}` : userId;
  generations.set(scope, (generations.get(scope) ?? 0) + 1);
  const db = await open();
  const tx = db.transaction("sends", "readwrite");
  const keys = organizationId
    ? await tx.store.index("scope").getAllKeys(`${userId}:${organizationId}`)
    : await tx.store.index("userId").getAllKeys(userId);
  await Promise.all(keys.map((key) => tx.store.delete(key)));
  await tx.done;
}

export async function pendingSendOrganizations(userId: string): Promise<string[]> {
  const rows = await (await open()).getAllFromIndex("sends", "userId", userId);
  return [
    ...new Set([
      ...rows.map((row) => row.scope.slice(userId.length + 1)),
      ...[...volatileSends.values()]
        .filter((row) => row.userId === userId)
        .map((row) => row.organizationId),
    ]),
  ];
}
