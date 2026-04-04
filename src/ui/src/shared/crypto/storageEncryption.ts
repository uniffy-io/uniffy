/**
 * Client-side storage encryption module.
 *
 * Provides AES-256-GCM encryption for IndexedDB content using a three-key hierarchy:
 * - cache_key_seed (backend, per user) -> KEK (in memory, derived via HKDF) -> DEK (in memory, wraps content)
 *
 * See docs/specs/client-storage-encryption-spec.md for full design.
 */

// --- Constants ---

const HKDF_SALT = new TextEncoder().encode('uniffy-client-storage-kek');
const WRAPPED_DEK_KEY = 'uniffy_wrapped_dek';
const ENCRYPTION_CHANNEL_NAME = 'uniffy-storage-encryption';

// --- Module state (never in Redux - see spec Section 7.4) ---

let activeDEK: CryptoKey | null = null;
let cachedKEK: CryptoKey | null = null;
let cachedSeed: Uint8Array | null = null;
let cachedUserId: string | null = null;
let encryptionChannel: BroadcastChannel | null = null;

// --- Types ---

type EncryptionMessage =
  | { type: 'ENCRYPTION_REKEY'; seed: string; userId: string }
  | { type: 'ENCRYPTION_DEK_CHANGED' }
  | { type: 'ENCRYPTION_TEARDOWN' };

// --- Key derivation ---

async function deriveKEK(cacheKeySeed: Uint8Array, userId: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey('raw', cacheKeySeed as BufferSource, 'HKDF', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: HKDF_SALT,
      info: new TextEncoder().encode(userId),
    },
    keyMaterial,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

async function generateDEK(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

async function wrapDEK(dek: CryptoKey, kek: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.wrapKey('raw', dek, kek, { name: 'AES-KW' });
}

async function unwrapDEK(wrappedDek: ArrayBuffer, kek: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    wrappedDek,
    kek,
    { name: 'AES-KW' },
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

// --- Base64 helpers ---

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function uint8ArrayToBase64(arr: Uint8Array): string {
  return arrayBufferToBase64(arr.buffer as ArrayBuffer);
}

function base64ToUint8Array(base64: string): Uint8Array {
  return new Uint8Array(base64ToArrayBuffer(base64));
}

// --- Multi-tab coordination ---

function initEncryptionChannel(): void {
  if (encryptionChannel) return;

  if (typeof BroadcastChannel === 'undefined') {
    initStorageFallback();
    return;
  }

  encryptionChannel = new BroadcastChannel(ENCRYPTION_CHANNEL_NAME);
  encryptionChannel.onmessage = async (event: MessageEvent<EncryptionMessage>) => {
    const msg = event.data;

    switch (msg.type) {
      case 'ENCRYPTION_REKEY': {
        const newSeed = base64ToUint8Array(msg.seed);
        await clearAllEncryptedStorage();
        localStorage.removeItem(WRAPPED_DEK_KEY);
        await initStorageEncryption(newSeed, msg.userId);
        break;
      }
      case 'ENCRYPTION_DEK_CHANGED': {
        const storedWrapped = localStorage.getItem(WRAPPED_DEK_KEY);
        if (storedWrapped && cachedKEK) {
          try {
            const wrappedBytes = base64ToArrayBuffer(storedWrapped);
            activeDEK = await unwrapDEK(wrappedBytes, cachedKEK);
          } catch {
            activeDEK = null;
          }
        } else {
          activeDEK = null;
        }
        break;
      }
      case 'ENCRYPTION_TEARDOWN': {
        activeDEK = null;
        cachedKEK = null;
        cachedSeed = null;
        cachedUserId = null;
        localStorage.removeItem(WRAPPED_DEK_KEY);
        break;
      }
    }
  };
}

function initStorageFallback(): void {
  window.addEventListener('storage', async (event) => {
    if (event.key !== WRAPPED_DEK_KEY) return;

    if (event.newValue === null) {
      activeDEK = null;
    } else if (cachedKEK) {
      try {
        const wrappedBytes = base64ToArrayBuffer(event.newValue);
        activeDEK = await unwrapDEK(wrappedBytes, cachedKEK);
      } catch {
        activeDEK = null;
        await clearAllEncryptedStorage();
      }
    }
  });
}

// --- Initialization and teardown ---

/**
 * Initialize client-side storage encryption.
 * Called once per session after GetCacheKeySeed returns.
 */
export async function initStorageEncryption(
  cacheKeySeed: Uint8Array,
  userId: string,
): Promise<void> {
  if (!crypto.subtle) {
    console.warn('Storage encryption unavailable: crypto.subtle not present (insecure context)');
    return;
  }

  const kek = await deriveKEK(cacheKeySeed, userId);
  cachedKEK = kek;
  cachedSeed = cacheKeySeed;
  cachedUserId = userId;

  const storedWrapped = localStorage.getItem(WRAPPED_DEK_KEY);

  if (storedWrapped) {
    try {
      const wrappedBytes = base64ToArrayBuffer(storedWrapped);
      activeDEK = await unwrapDEK(wrappedBytes, kek);
      initEncryptionChannel();
      return;
    } catch {
      // Unwrap failed: seed was rotated or data corrupted
      await clearAllEncryptedStorage();
      localStorage.removeItem(WRAPPED_DEK_KEY);
    }
  }

  // First login on this device (or cache was cleared)
  activeDEK = await generateDEK();
  const wrapped = await wrapDEK(activeDEK, kek);
  localStorage.setItem(WRAPPED_DEK_KEY, arrayBufferToBase64(wrapped));
  initEncryptionChannel();
}

/**
 * Tear down encryption on logout. Clears all in-memory keys and notifies other tabs.
 */
export function teardownStorageEncryption(): void {
  encryptionChannel?.postMessage({ type: 'ENCRYPTION_TEARDOWN' } as EncryptionMessage);
  encryptionChannel?.close();
  encryptionChannel = null;
  activeDEK = null;
  cachedKEK = null;
  cachedSeed = null;
  cachedUserId = null;
  localStorage.removeItem(WRAPPED_DEK_KEY);
}

/**
 * Check if storage encryption is initialized and ready.
 */
export function isStorageEncryptionReady(): boolean {
  return activeDEK !== null;
}

// --- Encrypt and decrypt ---

/**
 * Encrypt an object for IndexedDB storage.
 * Returns an ArrayBuffer containing [12-byte IV | ciphertext].
 */
export async function encryptForStorage(data: unknown): Promise<ArrayBuffer> {
  if (!activeDEK) {
    throw new Error('Storage encryption not initialized');
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, activeDEK, plaintext);

  const result = new Uint8Array(iv.length + ciphertext.byteLength);
  result.set(iv);
  result.set(new Uint8Array(ciphertext), iv.length);
  return result.buffer;
}

/**
 * Decrypt an ArrayBuffer from IndexedDB storage.
 * Expects format [12-byte IV | ciphertext].
 */
export async function decryptFromStorage<T = unknown>(buffer: ArrayBuffer): Promise<T> {
  if (!activeDEK) {
    throw new Error('Storage encryption not initialized');
  }
  const data = new Uint8Array(buffer);
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, activeDEK, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

// --- Kill switch functions ---

/**
 * Clear this device only (no backend call).
 * Deletes all encrypted IndexedDB stores, generates a new DEK.
 */
export async function clearLocalEncryptedStorage(): Promise<void> {
  await clearAllEncryptedStorage();
  localStorage.removeItem(WRAPPED_DEK_KEY);

  if (cachedSeed && cachedUserId) {
    await initStorageEncryption(cachedSeed, cachedUserId);
  }

  encryptionChannel?.postMessage({ type: 'ENCRYPTION_DEK_CHANGED' } as EncryptionMessage);
}

/**
 * Clear all devices (after backend RotateCacheKeySeed call).
 * Re-initializes with the new seed and notifies other tabs.
 */
export async function rotateAndClearAll(
  newCacheKeySeed: Uint8Array,
  userId: string,
): Promise<void> {
  await clearAllEncryptedStorage();
  localStorage.removeItem(WRAPPED_DEK_KEY);
  await initStorageEncryption(newCacheKeySeed, userId);

  encryptionChannel?.postMessage({
    type: 'ENCRYPTION_REKEY',
    seed: uint8ArrayToBase64(newCacheKeySeed),
    userId,
  } as EncryptionMessage);
}

// --- IndexedDB cleanup ---

/**
 * Delete all IndexedDB databases that contain encrypted content.
 * Encrypted store names are registered here as they are added.
 */
const ENCRYPTED_DB_NAMES: string[] = [
  // Chat message content will be added here when chat is implemented
  // 'uniffy-messages',
];

async function clearAllEncryptedStorage(): Promise<void> {
  for (const dbName of ENCRYPTED_DB_NAMES) {
    try {
      const deleteRequest = indexedDB.deleteDatabase(dbName);
      await new Promise<void>((resolve, reject) => {
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
        deleteRequest.onblocked = () => resolve();
      });
    } catch {
      console.warn(`Failed to delete IndexedDB: ${dbName}`);
    }
  }
}

/**
 * Register an IndexedDB database name as containing encrypted content.
 * Registered databases are cleared on seed rotation and device clear.
 */
export function registerEncryptedDatabase(dbName: string): void {
  if (!ENCRYPTED_DB_NAMES.includes(dbName)) {
    ENCRYPTED_DB_NAMES.push(dbName);
  }
}
