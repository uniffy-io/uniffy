# Client-Side Storage Encryption

> Status: Draft
> Author: AI-assisted design
> Date: 2026-03-21
> Scope: Platform-wide (all features that cache user content in the browser)

---

## 1. Overview

Uniffy caches user content in the browser (IndexedDB, localStorage) to reduce API calls and enable offline-like responsiveness. This cached data must be encrypted at rest to protect against physical device access, browser profile theft, forensic disk analysis, and malicious browser extensions.

This spec defines a **platform-wide encryption layer** for all client-side storage. It is not specific to any single feature - chat messages, notes, file metadata, calendar events, and any future cached content all use the same key management and encrypt/decrypt primitives.

---

## 2. Threat Model

| Attack vector | Without encryption | With encryption |
|---|---|---|
| XSS (script on your origin) | Readable | Still readable (key is in JS memory) |
| Malicious browser extension | Readable | **Protected** (no access to in-memory key) |
| Physical device access (cold) | Readable (raw IndexedDB files on disk) | **Protected** |
| Device theft (active session) | Readable | **Protected** (key gone after tab close) |
| Forensic disk analysis | Plaintext in browser storage | Ciphertext only |

**What this does NOT protect against:** XSS. If an attacker executes JavaScript on the Uniffy origin, they can access the in-memory DEK and decrypt anything. XSS prevention relies on strict CSP headers and input sanitization - that is the primary defense. Client-side encryption is defense in depth, not the primary barrier.

---

## 3. Architecture

### 3.1 Key Hierarchy

```
Backend (PostgreSQL)                Browser (per device)
+------------------------+         +---------------------------+
| User.cache_key_seed    |         | localStorage:             |
| (32 random bytes,      |---+     |   wrapped_dek (ciphertext)|
|  stable per user)      |   |     +---------------------------+
+------------------------+   |              |
                             |     +--------v------------------+
                             +---->| KEK (in memory only)      |
                                   | = HKDF(cache_key_seed)    |
                                   +--------+------------------+
                                            |
                                   +--------v------------------+
                                   | DEK (in memory only)      |
                                   | = unwrap(wrapped_dek, KEK)|
                                   +---------------------------+
                                            |
                                   +--------v------------------+
                                   | IndexedDB                 |
                                   | (AES-256-GCM ciphertext)  |
                                   +---------------------------+
```

**Three keys, each with a distinct role:**

| Key | Full name | Where it lives | Lifetime | Purpose |
|-----|-----------|---------------|----------|---------|
| `cache_key_seed` | Cache Key Seed | Backend (User model in PostgreSQL) | Until explicitly rotated | Stable secret used to derive the KEK. Only available after authentication. |
| KEK | Key Encryption Key | Browser memory only (never persisted) | Current session | Derived from `cache_key_seed` via HKDF. Used to wrap/unwrap the DEK. |
| DEK | Device Encryption Key | Browser memory (active) + localStorage (wrapped) | Permanent per device (until logout or seed rotation) | Random AES-256-GCM key that encrypts/decrypts all IndexedDB content. |

### 3.2 Why This Design

| Concern | How it's addressed |
|---------|-------------------|
| Token rotation | KEK derived from `cache_key_seed`, not the access token. Token refreshes have zero impact on encryption. |
| Cross-session persistence | `cache_key_seed` is stable across logins. Same user on same device always derives the same KEK, which unwraps the same DEK. |
| Device compromise | `wrapped_dek` in localStorage is ciphertext. Without `cache_key_seed` (only available after authentication via API), it cannot be unwrapped. |
| "Sign out everywhere" | Rotating `cache_key_seed` on the backend invalidates all device caches in one operation. |
| No device registry | The backend does not track devices. Each device independently generates and wraps its own DEK. |
| Feature independence | Any feature that stores data in IndexedDB uses the same DEK. No per-feature key management. |

---

## 4. Backend Changes

### 4.1 User Model

Add `cache_key_seed` to the User model:

```python
class User(SQLModel, table=True):
    # ... existing fields ...
    cache_key_seed: bytes = Field(
        default_factory=lambda: os.urandom(32),
        sa_column=sa.Column(sa.LargeBinary(32), nullable=False),
    )
```

Generated automatically on user creation. 32 bytes of `os.urandom()`.

### 4.2 Dedicated Seed Retrieval RPC

The `cache_key_seed` is **not** included in `GetCurrentUserResponse`. It is the root of trust for all client-side encryption - embedding it in a general-purpose user profile response creates unnecessary exposure surface. Any middleware, error tracker (Sentry), request logger, or network inspector that captures `GetCurrentUser` responses would silently leak the seed.

Instead, the seed is fetched via a dedicated RPC that exists solely for this purpose:

```protobuf
// In auth.v1.AuthService

rpc GetCacheKeySeed(GetCacheKeySeedRequest) returns (GetCacheKeySeedResponse);

message GetCacheKeySeedRequest {}

message GetCacheKeySeedResponse {
    bytes cache_key_seed = 1;  // 32-byte seed
}
```

**Properties of this RPC:**

| Property | Value |
|----------|-------|
| Authentication | Required (JWT access token) |
| Authorization | Returns only the authenticated user's own seed |
| Rate limiting | Standard authenticated rate limit (no special treatment needed - called once per session) |
| Caching | None. Never cache this response at any layer (CDN, service worker, HTTP cache) |
| Response logging | **NEVER log.** See Section 7.4 |

**Why a separate RPC is better than a field on GetCurrentUser:**

- `GetCurrentUser` is called frequently (app startup, token refresh, org switch). The seed only needs to be fetched once per session.
- `GetCurrentUser` responses are commonly logged, serialized to Redux devtools, captured in error reports. A separate RPC makes it trivial to exclude from all of these.
- The handler is a single-purpose function with no risk of the seed leaking through field additions, response transformations, or converter bugs in the user profile pipeline.
- The RPC can be independently audited and rate-limited if needed in the future.

**Backend handler:**

```python
async def get_cache_key_seed(self, user_id: UUID) -> bytes:
    """Return the cache_key_seed for the authenticated user."""
    result = await self.session.execute(
        select(User.cache_key_seed).where(User.id == user_id)
    )
    seed = result.scalar_one_or_none()
    if not seed:
        raise NotFoundError("User not found")
    return seed
```

### 4.3 Seed Rotation

The `cache_key_seed` is rotated (regenerated with `os.urandom(32)`) when:

| Trigger | Where |
|---------|-------|
| Password change | `AuthOperations.change_password()` |
| "Sign out all devices" | `AuthOperations.revoke_all_tokens()` (already increments `token_version`) |
| Admin account reset | `UsersOperations.admin_reset_user()` |

Rotation invalidates all device caches simultaneously. On each device's next login, the KEK derived from the new seed cannot unwrap the old `wrapped_dek`. The client detects the unwrap failure and clears the cache (see Section 5.5).

### 4.4 Migration

```python
def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "cache_key_seed",
            sa.LargeBinary(32),
            nullable=False,
            server_default=sa.text("gen_random_bytes(32)"),
        ),
    )
    # Remove server_default after backfill (existing rows get random values via server_default)
    op.alter_column("users", "cache_key_seed", server_default=None)
```

---

## 5. Frontend Implementation

### 5.1 Key Derivation and Setup

```typescript
// src/ui/src/shared/crypto/storageEncryption.ts

const HKDF_SALT = new TextEncoder().encode("uniffy-client-storage-kek");
const WRAPPED_DEK_KEY = "uniffy_wrapped_dek";

async function deriveKEK(cacheKeySeed: Uint8Array, userId: string): Promise<CryptoKey> {
    const keyMaterial = await crypto.subtle.importKey(
        "raw", cacheKeySeed, "HKDF", false, ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
        {
            name: "HKDF",
            hash: "SHA-256",
            salt: HKDF_SALT,
            info: new TextEncoder().encode(userId),
        },
        keyMaterial,
        { name: "AES-KW", length: 256 },
        false,
        ["wrapKey", "unwrapKey"],
    );
}

async function generateDEK(): Promise<CryptoKey> {
    return crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,  // extractable (needed for wrapKey)
        ["encrypt", "decrypt"],
    );
}

async function wrapDEK(dek: CryptoKey, kek: CryptoKey): Promise<ArrayBuffer> {
    return crypto.subtle.wrapKey("raw", dek, kek, { name: "AES-KW" });
}

async function unwrapDEK(
    wrappedDek: ArrayBuffer, kek: CryptoKey,
): Promise<CryptoKey> {
    return crypto.subtle.unwrapKey(
        "raw", wrappedDek, kek,
        { name: "AES-KW" },
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"],
    );
}
```

### 5.2 Initialization Flow

```typescript
// Called after GetCacheKeySeed completes successfully (once per session, after login)

let activeDEK: CryptoKey | null = null;
let cachedKEK: CryptoKey | null = null;
let cachedSeed: Uint8Array | null = null;
let cachedUserId: string | null = null;

async function initStorageEncryption(
    cacheKeySeed: Uint8Array,
    userId: string,
): Promise<void> {
    const kek = await deriveKEK(cacheKeySeed, userId);
    cachedKEK = kek;           // Cached for cross-tab DEK unwrap (Section 5.4)
    cachedSeed = cacheKeySeed;  // Cached for device-clear re-init
    cachedUserId = userId;

    const storedWrapped = localStorage.getItem(WRAPPED_DEK_KEY);

    if (storedWrapped) {
        try {
            const wrappedBytes = base64ToArrayBuffer(storedWrapped);
            activeDEK = await unwrapDEK(wrappedBytes, kek);
            // Cache is usable - DEK recovered
            initEncryptionChannel(); // Start listening for cross-tab events
            return;
        } catch {
            // Unwrap failed: seed was rotated or data corrupted
            // Clear everything and start fresh
            await clearAllEncryptedStorage();
            localStorage.removeItem(WRAPPED_DEK_KEY);
        }
    }

    // First login on this device (or cache was cleared)
    activeDEK = await generateDEK();
    const wrapped = await wrapDEK(activeDEK, kek);
    localStorage.setItem(WRAPPED_DEK_KEY, arrayBufferToBase64(wrapped));
    initEncryptionChannel(); // Start listening for cross-tab events
}

function teardownStorageEncryption(): void {
    encryptionChannel?.postMessage({ type: 'ENCRYPTION_TEARDOWN' });
    encryptionChannel?.close();
    encryptionChannel = null;
    activeDEK = null;
    cachedKEK = null;
    cachedSeed = null;
    cachedUserId = null;
    localStorage.removeItem(WRAPPED_DEK_KEY);
}
```

`initStorageEncryption()` is called once during app startup, after `GetCacheKeySeed` returns. The call sequence is: `GetCurrentUser` (get user ID) -> `GetCacheKeySeed` (get seed) -> `initStorageEncryption()`. `teardownStorageEncryption()` is called on logout.

### 5.3 Encrypt and Decrypt

```typescript
async function encryptForStorage(data: object): Promise<ArrayBuffer> {
    if (!activeDEK) throw new Error("Storage encryption not initialized");
    const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV
    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        activeDEK,
        plaintext,
    );
    // Prepend IV to ciphertext (IV is not secret)
    const result = new Uint8Array(iv.length + ciphertext.byteLength);
    result.set(iv);
    result.set(new Uint8Array(ciphertext), iv.length);
    return result.buffer;
}

async function decryptFromStorage(buffer: ArrayBuffer): Promise<object> {
    if (!activeDEK) throw new Error("Storage encryption not initialized");
    const data = new Uint8Array(buffer);
    const iv = data.slice(0, 12);
    const ciphertext = data.slice(12);
    const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        activeDEK,
        ciphertext,
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
}
```

These are the only two functions that feature code needs to call. Everything else (key derivation, DEK management, localStorage wrapping) is internal to the encryption module.

### 5.4 Multi-Tab Coordination

Multiple tabs share the same `localStorage` and IndexedDB but each holds its own in-memory DEK. When one tab changes the encryption state (seed rotation, device clear, logout), other tabs must synchronize or they will read/write with a stale key, corrupting the cache.

**Channel:** `BroadcastChannel('uniffy-storage-encryption')`

This follows the same pattern used for service worker token sync (`uniffy-auth-token` channel in `src/ui/src/workers/registerMediaWorker.ts`).

**Message types:**

| Type | Payload | Trigger | Receiver action |
|------|---------|---------|-----------------|
| `ENCRYPTION_REKEY` | `{ seed: base64, userId: string }` | Seed rotation (Clear All Devices, password change response) | Clear IndexedDB, re-derive KEK from new seed, generate new DEK, wrap and store |
| `ENCRYPTION_DEK_CHANGED` | (none) | Clear This Device | Read new `wrapped_dek` from localStorage, unwrap with existing KEK, replace in-memory DEK |
| `ENCRYPTION_TEARDOWN` | (none) | Logout | Null `activeDEK`, remove `wrapped_dek` from localStorage |

**Why three distinct messages:**

- `ENCRYPTION_REKEY` carries the new seed because receiving tabs cannot derive the new KEK without it. The old KEK cannot unwrap the new `wrapped_dek`. Broadcasting the seed over BroadcastChannel is safe - it is same-origin only, the same security boundary as the in-memory DEK itself.
- `ENCRYPTION_DEK_CHANGED` carries no payload. The receiving tab reads the updated `wrapped_dek` from localStorage (shared across tabs) and unwraps it with its existing KEK (unchanged). This works because "Clear This Device" does not rotate the seed.
- `ENCRYPTION_TEARDOWN` carries no payload. Receiving tabs null their DEK and stop all encrypted storage operations.

**Implementation:**

```typescript
// src/ui/src/shared/crypto/storageEncryption.ts

const ENCRYPTION_CHANNEL_NAME = 'uniffy-storage-encryption';
let encryptionChannel: BroadcastChannel | null = null;

type EncryptionMessage =
    | { type: 'ENCRYPTION_REKEY'; seed: string; userId: string }
    | { type: 'ENCRYPTION_DEK_CHANGED' }
    | { type: 'ENCRYPTION_TEARDOWN' };

function initEncryptionChannel(): void {
    if (encryptionChannel) return;

    encryptionChannel = new BroadcastChannel(ENCRYPTION_CHANNEL_NAME);
    encryptionChannel.onmessage = async (event: MessageEvent<EncryptionMessage>) => {
        const msg = event.data;

        switch (msg.type) {
            case 'ENCRYPTION_REKEY': {
                // Another tab rotated the seed. Re-initialize from scratch.
                const newSeed = base64ToUint8Array(msg.seed);
                await clearAllEncryptedStorage();
                localStorage.removeItem(WRAPPED_DEK_KEY);
                await initStorageEncryption(newSeed, msg.userId);
                break;
            }
            case 'ENCRYPTION_DEK_CHANGED': {
                // Another tab cleared this device. Pick up the new wrapped DEK.
                const storedWrapped = localStorage.getItem(WRAPPED_DEK_KEY);
                if (storedWrapped && cachedKEK) {
                    try {
                        const wrappedBytes = base64ToArrayBuffer(storedWrapped);
                        activeDEK = await unwrapDEK(wrappedBytes, cachedKEK);
                    } catch {
                        // KEK mismatch (should not happen). Full re-init on next API call.
                        activeDEK = null;
                    }
                } else {
                    activeDEK = null;
                }
                break;
            }
            case 'ENCRYPTION_TEARDOWN': {
                // Another tab logged out.
                activeDEK = null;
                cachedKEK = null;
                localStorage.removeItem(WRAPPED_DEK_KEY);
                break;
            }
        }
    };
}
```

**Broadcast points** (added to existing functions):

```typescript
// In rotateAndClearAll() - after re-initializing with new seed
encryptionChannel?.postMessage({
    type: 'ENCRYPTION_REKEY',
    seed: uint8ArrayToBase64(newCacheKeySeed),
    userId,
});

// In clearLocalEncryptedStorage() - after generating new DEK
encryptionChannel?.postMessage({ type: 'ENCRYPTION_DEK_CHANGED' });

// In teardownStorageEncryption() - on logout
encryptionChannel?.postMessage({ type: 'ENCRYPTION_TEARDOWN' });
```

**Lifecycle:**

- `initEncryptionChannel()` is called inside `initStorageEncryption()` (once per session).
- The channel is closed in `teardownStorageEncryption()` after broadcasting teardown.
- The channel is re-created on next login.

**Fallback for missing BroadcastChannel:**

BroadcastChannel is supported in all modern browsers (Chrome 54+, Firefox 38+, Safari 15.4+). For the rare case where it is unavailable, the `storage` event on `window` provides a fallback. The `storage` event fires in other tabs when any `localStorage` key changes:

```typescript
// Fallback: only used if BroadcastChannel is unavailable
if (typeof BroadcastChannel === 'undefined') {
    window.addEventListener('storage', async (event) => {
        if (event.key !== WRAPPED_DEK_KEY) return;

        if (event.newValue === null) {
            // wrapped_dek was removed (logout or rotation in progress)
            activeDEK = null;
        } else if (cachedKEK) {
            // wrapped_dek was updated (new DEK written by another tab)
            try {
                const wrappedBytes = base64ToArrayBuffer(event.newValue);
                activeDEK = await unwrapDEK(wrappedBytes, cachedKEK);
            } catch {
                // Seed was rotated - KEK no longer matches. Cannot recover
                // without the new seed. Null the DEK; next API call will
                // trigger GetCurrentUser which re-initializes everything.
                activeDEK = null;
                await clearAllEncryptedStorage();
            }
        }
    });
}
```

The `storage` fallback is less capable than BroadcastChannel (it cannot carry the new seed on rotation, so the receiving tab must wait for its next `GetCurrentUser` call to recover). This is acceptable since BroadcastChannel coverage is near-universal.

**Additional state needed:**

The `initStorageEncryption` function must cache the KEK in a module-scoped variable so that `ENCRYPTION_DEK_CHANGED` handlers can unwrap the new `wrapped_dek` without re-deriving from the seed:

```typescript
let cachedKEK: CryptoKey | null = null;

async function initStorageEncryption(
    cacheKeySeed: Uint8Array,
    userId: string,
): Promise<void> {
    const kek = await deriveKEK(cacheKeySeed, userId);
    cachedKEK = kek;  // Cache for cross-tab unwrap
    // ... rest of existing init logic
    initEncryptionChannel();
}

function teardownStorageEncryption(): void {
    encryptionChannel?.postMessage({ type: 'ENCRYPTION_TEARDOWN' });
    encryptionChannel?.close();
    encryptionChannel = null;
    activeDEK = null;
    cachedKEK = null;
    localStorage.removeItem(WRAPPED_DEK_KEY);
}
```

**Race condition mitigation:**

If two tabs both call `clearLocalEncryptedStorage()` simultaneously, both generate a new DEK, and the last writer wins in localStorage. The other tab's in-memory DEK becomes stale, but it will immediately receive the `ENCRYPTION_DEK_CHANGED` broadcast and re-read the winning `wrapped_dek`. Since both tabs cleared IndexedDB, no data was encrypted with the losing DEK. This is safe.

For seed rotation, the backend call is serialized (only one tab calls `RotateCacheKeySeed`), so there is no race on the seed itself.

### 5.5 Failure Handling

| Failure | Behavior |
|---------|----------|
| Unwrap fails (rotated seed, corrupted localStorage) | Clear all IndexedDB stores + localStorage wrapped key. Generate new DEK. User experiences a cold start (all data fetched from API). No error shown. |
| Decrypt fails (corrupted IndexedDB entry) | Skip the entry, fetch from API. Log warning. Do not clear entire cache - isolated corruption. |
| `crypto.subtle` unavailable (insecure context) | Disable IndexedDB caching entirely. App works without cache (API-only). Log warning on startup. |
| `activeDEK` is null (encryption not initialized) | Throw error. This should never happen - `initStorageEncryption` runs before any storage access. Indicates a startup ordering bug. |

### 5.6 Performance

Web Crypto AES-GCM is hardware-accelerated on all modern browsers:

| Operation | Time per item | 50 items |
|-----------|--------------|----------|
| Encrypt (write to IndexedDB) | ~0.1-0.5ms | 5-25ms |
| Decrypt (read from IndexedDB) | ~0.1-0.5ms | 5-25ms |
| HKDF key derivation (once per session) | ~1ms | - |
| DEK generation (once per device) | ~1ms | - |
| Wrap/unwrap DEK (once per session) | ~0.5ms | - |

The per-session overhead (HKDF + unwrap) is ~2ms total. Per-item encrypt/decrypt is negligible compared to IndexedDB I/O and DOM rendering.

---

## 6. Integration Guide for Features

Any feature that caches user content in IndexedDB should use this system. The integration is minimal:

### 6.1 IndexedDB Writes

```typescript
import { encryptForStorage } from '@/shared/crypto/storageEncryption';

// Before: store plaintext
// await idbStore.put({ id: msg.id, content: msg.content, ... });

// After: store ciphertext
const encrypted = await encryptForStorage({ id: msg.id, content: msg.content, ... });
await idbStore.put(encrypted, msg.id);  // ArrayBuffer value, explicit key
```

### 6.2 IndexedDB Reads

```typescript
import { decryptFromStorage } from '@/shared/crypto/storageEncryption';

// Before: read plaintext
// const msg = await idbStore.get(msgId);

// After: read and decrypt
const encrypted = await idbStore.get(msgId);
if (encrypted) {
    const msg = await decryptFromStorage(encrypted) as ChatMessage;
}
```

### 6.3 IndexedDB Schema Impact

Encrypted object stores hold `ArrayBuffer` values instead of structured objects. This means:

- **No compound indexes on encrypted stores.** You cannot index on fields inside the ciphertext. The store key must be set explicitly (not auto-generated from a field).
- **Metadata stores stay unencrypted.** Stores that hold only IDs, timestamps, and sync cursors (no user content) do not need encryption. Example: `channel_sync` (channel IDs + message IDs).
- **The encryption boundary is the object store level.** Either an entire store is encrypted or it's not. No per-field encryption.

For most features (notes, files, calendar events), this is not a problem - content is fetched by ID or in bulk, so a simple `get(id)` on the encrypted store is sufficient.

**Chat messages are the exception.** Chat requires ordered access: scroll-up pagination within a channel, range queries by timestamp, jump-to-message lookups. Encrypting the entire message store as opaque blobs would destroy all of these. See Section 6.5 for the split-store pattern that solves this.

### 6.4 Applicability

| Feature | What's cached | Store pattern | Encrypt? | Status |
|---------|--------------|---------------|----------|--------|
| Notes | Note content, titles, tree structure | Single encrypted store (`uniffy-notes-cache`), keyed by org ID | Yes | **Implemented** |
| Thumbnails | Rendered image data URLs | Single encrypted store (`uniffy-thumbnails`), keyed by file ID | Yes | **Implemented** |
| Chat messages | Message content, sender info | Split-store (Section 6.5) | Content: Yes. Index: No (structural metadata only) | Planned (next) |
| Calendar events (future) | Event titles, descriptions | Single encrypted store, keyed by event ID | Yes | Planned |
| Channel sync cursors | Channel IDs, message IDs, timestamps | Unencrypted | No (no user content) | N/A |
| Chat message indexes | message ID, channel ID, root ID, timestamp | Unencrypted (part of split-store) | No (structural metadata only) | N/A |
| UI preferences | Theme, density, panel sizes | Unencrypted (localStorage) | No (not sensitive) | N/A |
| Auth tokens | Access token (memory-only), refresh token | N/A | N/A (not in IndexedDB) | N/A |

### 6.4.1 Integration Checklist for New Consumers

When adding encryption to a new IndexedDB cache:

1. **Register the database** at module scope so it's cleared on seed rotation:
   ```typescript
   import { registerEncryptedDatabase } from '@/shared/crypto/storageEncryption';
   registerEncryptedDatabase('your-db-name');
   ```

2. **Bump the DB version** to trigger `onupgradeneeded`. In the upgrade handler, delete the old plaintext store and recreate without `keyPath` (out-of-line keys, since values are now opaque `ArrayBuffer`s).

3. **Guard all reads/writes** with `isStorageEncryptionReady()`. If encryption isn't initialized (e.g., seed not yet fetched), skip the cache and fall through to the API. This ensures the app works during the brief window between page load and encryption init.
   ```typescript
   import { isStorageEncryptionReady } from '@/shared/crypto/storageEncryption';
   if (!isStorageEncryptionReady()) return null; // skip cache, hit API
   ```

4. **Encrypt on write** using `encryptForStorage(data)` which returns an `ArrayBuffer`. Store it with an explicit key: `store.put(encrypted, yourKey)`.

5. **Decrypt on read** using `decryptFromStorage<YourType>(buffer)`. Wrap in try/catch - if decryption fails (corrupted entry, stale key), return `null` and let the caller fetch from the API.

6. **Handle v1-to-v2 migration gracefully.** If the old store had a `keyPath` (in-line keys), the new code passing an explicit key to `put()` will throw `DataError`. The upgrade handler should delete and recreate the store. Add a runtime safety check for cases where the upgrade was blocked by another tab (see notes cache implementation for the pattern).

### 6.5 Split-Store Pattern (Chat Messages)

#### 6.5.1 Problem

The chat feature requires IndexedDB queries that are impossible on encrypted stores:

- **Scroll-up pagination:** "Load 50 messages before this timestamp in channel X" - requires a compound index on `[channel_id, created_at]` and a cursor range query.
- **Jump to message:** "Find message Y and load 25 messages before and after it" - requires index lookup by message ID, then a range scan.
- **Thread loading:** "Load messages with root_id = X ordered by created_at" - requires a compound index on `[root_id, created_at]`.
- **Cache eviction:** "Delete messages older than 30 days" or "evict the oldest channel" - requires timestamp range queries.

If the entire message object is encrypted as a single `ArrayBuffer`, none of these indexes exist. The only option would be to decrypt every message in every channel into memory and filter in JavaScript - defeating the purpose of a cache.

#### 6.5.2 Solution: Separate Index and Content Stores

Split the single `messages` store into two stores: an unencrypted **index store** for queryable metadata, and an encrypted **content store** for user-generated content.

```
Object store: "message_index" (UNENCRYPTED)
  Key: message_id (UUID)
  Value: {
      id,              // message ID
      channel_id,      // which channel
      root_id,         // thread parent (null for root messages)
      created_at,      // timestamp (ISO string or epoch ms)
      is_deleted,      // soft-delete flag
  }
  Indexes:
    - [channel_id, created_at, id]   (compound, timeline pagination)
    - [root_id, created_at, id]      (compound, thread replies)

Object store: "message_content" (ENCRYPTED)
  Key: message_id (UUID)
  Value: ArrayBuffer (AES-256-GCM ciphertext of full message object)

Object store: "channel_sync" (UNENCRYPTED, unchanged)
  Key: channel_id
  Value: { latest_message_id, oldest_message_id, synced_at }
```

**What is in the index (unencrypted):**

| Field | Why it's safe | Why it's needed |
|-------|---------------|-----------------|
| `id` | System-generated UUID, not user content | Primary key, referenced from content store |
| `channel_id` | System-generated UUID, not user content | Compound index for per-channel timeline queries |
| `root_id` | System-generated UUID, not user content | Compound index for thread queries |
| `created_at` | Timestamp reveals "a message exists at this time" but not what it says | Range queries for pagination, age-based eviction |
| `is_deleted` | Boolean flag | Skip deleted messages without decrypting |

**What is NOT in the index:**

| Field | Why excluded |
|-------|-------------|
| `content` | User-generated text - the primary thing we're protecting |
| `sender_id` / `sender_type` | Reveals who sent what and when (privacy-sensitive metadata) |
| `edited_at` | Reveals editing patterns |
| `metadata` | May contain user content (link previews, etc.) |
| `is_pinned` | Reveals user curation intent |

The threat model explicitly accepts that an attacker with disk access can determine "N messages exist in channel X with these timestamps." They cannot determine who sent them, what they say, or any content. This matches the existing `channel_sync` store which already exposes channel IDs and message ID ranges unencrypted.

#### 6.5.3 Read Path

**Scroll-up pagination (load 50 older messages in a channel):**

```typescript
async function loadOlderMessages(
    channelId: string,
    beforeTimestamp: string,
    limit: number,
): Promise<ChatMessage[]> {
    // Step 1: Query the unencrypted index (uses compound index, fast)
    const index = messageIndexStore
        .index('[channel_id, created_at, id]');
    const range = IDBKeyRange.bound(
        [channelId, ''],                    // lower bound: channel start
        [channelId, beforeTimestamp, ''],    // upper bound: before this timestamp
    );
    const indexEntries = await index.getAll(range, limit);

    // Step 2: Batch-get encrypted content by message IDs
    const messageIds = indexEntries.map(e => e.id);
    const encryptedBlobs = await Promise.all(
        messageIds.map(id => messageContentStore.get(id)),
    );

    // Step 3: Decrypt in parallel
    const messages = await Promise.all(
        encryptedBlobs
            .filter(Boolean)
            .map(blob => decryptFromStorage(blob) as Promise<ChatMessage>),
    );

    return messages;
}
```

**Jump to message:**

```typescript
async function loadAroundMessage(
    messageId: string,
    channelId: string,
    contextSize: number,  // messages before and after
): Promise<ChatMessage[]> {
    // Step 1: Look up the target in the index to get its timestamp
    const target = await messageIndexStore.get(messageId);
    if (!target) return [];  // not in cache, fall through to API

    // Step 2: Range query for surrounding messages
    const beforeRange = IDBKeyRange.bound(
        [channelId, ''],
        [channelId, target.created_at, target.id],
    );
    const afterRange = IDBKeyRange.lowerBound(
        [channelId, target.created_at, target.id],
        true,  // exclusive
    );

    const before = await index.getAll(beforeRange, contextSize);
    const after = await index.getAll(afterRange, contextSize);
    const allIds = [...before, target, ...after].map(e => e.id);

    // Step 3: Batch decrypt
    // ... same pattern as above
}
```

#### 6.5.4 Write Path

Every write to the cache writes to both stores atomically (same IDB transaction):

```typescript
async function cacheMessage(message: ChatMessage): Promise<void> {
    const encrypted = await encryptForStorage(message);

    const tx = db.transaction(
        ['message_index', 'message_content'],
        'readwrite',
    );

    // Write index entry (unencrypted structural metadata)
    tx.objectStore('message_index').put({
        id: message.id,
        channel_id: message.channel_id,
        root_id: message.root_id ?? null,
        created_at: message.created_at,
        is_deleted: message.is_deleted ?? false,
    });

    // Write encrypted content
    tx.objectStore('message_content').put(encrypted, message.id);

    await tx.done;
}
```

**Deletions** update both stores: set `is_deleted = true` in the index, and either remove or overwrite the content store entry. Keeping the index entry allows the "message was deleted" placeholder to render without decryption.

**Cache eviction** (age-based, size-based) operates on the index store only for the query phase, then bulk-deletes matching IDs from both stores.

#### 6.5.5 Performance Impact

The split-store approach adds one extra IDB read per query (index lookup + content fetch) compared to the original single-store design. In practice:

| Operation | Single store (no encryption) | Split store (encrypted) | Delta |
|-----------|------------------------------|------------------------|-------|
| Load 50 messages (scroll-up) | 1 range query | 1 range query + 50 gets + 50 decrypts | ~5-25ms extra (decrypt) |
| Write 1 message | 1 put | 1 encrypt + 2 puts (same transaction) | ~0.5ms extra (encrypt) |
| Jump to message | 1 get + 2 range queries | 1 get + 2 range queries + N gets + N decrypts | ~5-25ms extra (decrypt) |
| Evict old messages | 1 range delete | 1 range query + 2 range deletes | negligible |

The per-message decrypt cost (~0.1-0.5ms) is dominated by IndexedDB I/O and DOM rendering. Users will not perceive the difference.

---

## 7. Security Considerations

### 7.1 What Is Stored Where

| Data | Location | Encrypted | Accessible without auth |
|------|----------|-----------|------------------------|
| `cache_key_seed` | PostgreSQL (User table) | No (protected by DB access controls) | No (returned only via authenticated RPC) |
| `wrapped_dek` | localStorage | Yes (AES-KW wrapped) | Yes (but useless without `cache_key_seed`) |
| Cached content | IndexedDB | Yes (AES-256-GCM) | Yes (but undecryptable without DEK) |
| DEK | Browser memory | N/A (never persisted as plaintext) | Only during active session |
| KEK | Browser memory (cached as `cachedKEK`) | N/A (never persisted) | Only during active session |

### 7.2 Attack Scenarios

| Scenario | Outcome |
|----------|---------|
| Attacker steals browser profile (disk) | Gets `wrapped_dek` + encrypted IndexedDB. Cannot derive KEK without `cache_key_seed` (requires authenticating to API). Data is safe. |
| Attacker has localStorage access (extension) | Gets `wrapped_dek` (useless without seed). Cannot read IndexedDB ciphertext. |
| Attacker has XSS | Can read DEK from memory, decrypt everything. **Not protected.** Prevent XSS with CSP. |
| User changes password | `cache_key_seed` rotated. All devices' caches invalidated on next login. |
| Admin resets user | Same as password change. Clean slate on all devices. |
| Attacker compromises `cache_key_seed` from DB | Needs access to a specific device's `wrapped_dek` to unwrap the DEK. Cross-device attack requires both DB access AND physical device access. |

### 7.3 Cryptographic Choices

| Choice | Rationale |
|--------|-----------|
| AES-256-GCM for content | Authenticated encryption. Detects tampering. Hardware-accelerated. |
| AES-KW for key wrapping | Purpose-built for wrapping symmetric keys. No IV needed (deterministic). |
| HKDF-SHA-256 for key derivation | Standard KDF for deriving keys from high-entropy input. |
| 96-bit random IV per encrypt | Standard for AES-GCM. Prepended to ciphertext (not secret). |
| 32-byte seed | 256 bits of entropy. Matches AES-256 key strength. |

### 7.4 Logging and Observability Restrictions

The `cache_key_seed` is the root secret of the entire client-side encryption scheme. If it leaks through logs, error reports, or observability tooling, all device caches for that user become decryptable. **This field must never be logged, serialized to debug output, or captured by error tracking.**

**Backend rules:**

| Layer | Rule |
|-------|------|
| `GetCacheKeySeed` handler | Must not log the response body. Use `loguru` context filtering or exclude this handler from request/response logging middleware. |
| `RotateCacheKeySeed` handler | Same as above - the response contains `new_cache_key_seed`. |
| Observability middleware | If the backend has a global RPC logging interceptor, both RPCs must be excluded by name. |
| Error tracking (Sentry, etc.) | The `cache_key_seed` field on the `User` model must be added to Sentry's `before_send` scrubbing or equivalent. If the User object appears in an error context, the seed must be redacted. |
| Database query logs | No special action needed - PostgreSQL logs queries, not result values, at default log levels. Do not enable `log_min_duration_statement = 0` in production on the users table. |

**Frontend rules:**

| Layer | Rule |
|-------|------|
| Redux DevTools | The seed must never be stored in Redux state. It is consumed by `initStorageEncryption()` and discarded. The only in-memory copies are `cachedSeed` (module-scoped, not in Redux) and the `CryptoKey` objects (opaque, non-inspectable). |
| Network tab / service worker | The `GetCacheKeySeed` response is a standard ConnectRPC call. It will be visible in the browser network tab (unavoidable for the authenticated user on their own device - this is acceptable). It must NOT be intercepted or cached by the media stream service worker. |
| Error tracking (Sentry, etc.) | If frontend Sentry breadcrumbs capture RPC calls, exclude `GetCacheKeySeed` and `RotateCacheKeySeed` by method name. |
| Console logging | Never log the seed value. Log only lifecycle events: "Storage encryption initialized", "DEK rotated", "Cache cleared". |
| BroadcastChannel | The `ENCRYPTION_REKEY` message carries the seed in base64. This is same-origin only and never leaves the browser. Acceptable. |

**Implementation checklist for backend logging exclusion:**

```python
# In the request/response logging middleware (if applicable):

# RPCs whose responses must NEVER be logged
SENSITIVE_RPCS = frozenset({
    "auth.v1.AuthService/GetCacheKeySeed",
    "auth.v1.AuthService/RotateCacheKeySeed",
})

async def logging_interceptor(request, handler):
    method = request.scope.get("path", "")
    response = await handler(request)
    if method not in SENSITIVE_RPCS:
        logger.info("RPC response", method=method, ...)  # normal logging
    else:
        logger.info("RPC response", method=method, body="[REDACTED]")
    return response
```

```python
# In the User model or Sentry integration:

# Fields to strip from User objects before sending to error tracking
SENSITIVE_USER_FIELDS = {"cache_key_seed", "hashed_password"}
```

---

## 8. Cache Kill Switch and Key Rotation

### 8.1 Overview

Users and admins need explicit controls to wipe all client-side cached data and rotate the encryption key. This serves three purposes:
- **Security response**: User suspects device compromise, wants to ensure no cached data is readable on any device
- **Troubleshooting**: Corrupted cache causing app issues, user wants a clean slate
- **Compliance**: Admin needs to revoke a user's local data access immediately (termination, security incident)

### 8.2 User-Facing: "Clear All Local Data"

**Location:** Settings > Security > "Client-Side Data"

**UI:**

```
+---------------------------------------------------------------+
| Client-Side Data                                               |
+---------------------------------------------------------------+
| Uniffy caches content locally on your devices for faster       |
| access. All cached data is encrypted at rest.                  |
|                                                                |
| Cached data on this device:                                    |
|   Chat messages:  ~2,400 messages across 12 channels           |
|   Storage used:   ~4.2 MB (encrypted)                          |
|                                                                |
| [Clear This Device]     [Clear All Devices]                    |
|                                                                |
| "Clear This Device" removes cached data from this browser.     |
| "Clear All Devices" also rotates your encryption key, making   |
| cached data on all other devices unreadable on next login.     |
+---------------------------------------------------------------+
```

**"Clear This Device" button:**
- Frontend-only action, no backend call
- Deletes all IndexedDB object stores
- Removes `wrapped_dek` from localStorage
- Generates a new DEK and re-wraps with existing KEK
- Toast: "Local cache cleared. Data will reload from the server."
- The cache repopulates naturally as the user navigates

**"Clear All Devices" button:**
- Confirmation dialog: "This will clear cached data on all your devices and cannot be undone. Continue?"
- Calls backend RPC: `RotateCacheKeySeed` (see Section 8.4)
- Backend rotates `cache_key_seed`
- On this device: clears IndexedDB + localStorage, generates new DEK, wraps with new KEK
- On other devices: next login attempt fails to unwrap DEK (seed changed), triggers automatic cache clear
- Toast: "Encryption key rotated. All device caches have been invalidated."

### 8.3 Admin-Facing: "Invalidate User Caches"

**Location:** Admin > Members > User row > Actions dropdown > "Invalidate Local Caches"

Org admins and system admins can rotate any user's `cache_key_seed` remotely. Use cases:
- Employee termination (ensure no cached data is readable on personal devices)
- Security incident response (force cache invalidation across all of a user's devices)
- Account compromise (combined with password reset and token revocation)

**UI:**

In the admin member management table, the user actions dropdown gets a new item:

```
Actions v
  +------------------------+
  | Change Role            |
  | Reset Password         |
  | Invalidate Local Caches|  <- new
  | Deactivate Account     |
  +------------------------+
```

**Confirmation dialog:** "This will invalidate all locally cached data for {user name} across all their devices. Their data will reload from the server on next login. Continue?"

**Backend:** Calls the same `RotateCacheKeySeed` RPC but with a `target_user_id` parameter (admin-only).

### 8.4 Backend RPC

Add to `auth.v1.AuthService` (or `users.v1.UsersService` for the admin variant):

```protobuf
// User rotates their own cache key seed
rpc RotateCacheKeySeed(RotateCacheKeySeedRequest) returns (RotateCacheKeySeedResponse);

message RotateCacheKeySeedRequest {
  // Empty for self-rotation.
  // Admin can set target_user_id to rotate another user's seed.
  optional string target_user_id = 1;
}

message RotateCacheKeySeedResponse {
  bytes new_cache_key_seed = 1;  // Returned so the caller can re-initialize encryption immediately
}
```

**Backend logic:**

```python
async def rotate_cache_key_seed(
    self, user_id: UUID, target_user_id: UUID | None, org_id: UUID,
) -> bytes:
    """Rotate cache_key_seed for a user. Admin can target another user."""
    effective_user_id = target_user_id or user_id

    if target_user_id and target_user_id != user_id:
        # Admin action: verify caller is org admin or system admin
        await self._require_org_admin(user_id, org_id)

    new_seed = os.urandom(32)
    await self.session.execute(
        update(User)
        .where(User.id == effective_user_id)
        .values(cache_key_seed=new_seed)
    )
    await self.session.commit()
    return new_seed
```

### 8.5 Automatic Rotation Triggers

Beyond the explicit UI controls, `cache_key_seed` is also rotated automatically when:

| Trigger | Where | User action required |
|---------|-------|---------------------|
| Password change (admin) | `UserOperations.admin_update()` (when `hashed_password` is set) | None - happens silently |
| "Sign out other sessions" | `AuthOperations.revoke_other_sessions()` | None - happens alongside session revocation |
| Account deactivation | `UserOperations.admin_update()` (when `is_active` set to False) | None - cache becomes permanently unreadable |

### 8.6 Frontend Module API

The `storageEncryption.ts` module exports these functions for the kill switch UI:

```typescript
// Clear this device only (no backend call)
export async function clearLocalEncryptedStorage(): Promise<void> {
    await clearAllIndexedDBStores();
    localStorage.removeItem(WRAPPED_DEK_KEY);
    // Re-initialize with existing seed (DEK is regenerated)
    if (cachedSeed && cachedUserId) {
        await initStorageEncryption(cachedSeed, cachedUserId);
    }
    // Notify other tabs to pick up the new wrapped DEK
    encryptionChannel?.postMessage({ type: 'ENCRYPTION_DEK_CHANGED' });
}

// Clear all devices (calls backend, re-initializes with new seed)
export async function rotateAndClearAll(
    newCacheKeySeed: Uint8Array, userId: string,
): Promise<void> {
    await clearAllIndexedDBStores();
    localStorage.removeItem(WRAPPED_DEK_KEY);
    await initStorageEncryption(newCacheKeySeed, userId);
    // Notify other tabs to re-init with the new seed
    encryptionChannel?.postMessage({
        type: 'ENCRYPTION_REKEY',
        seed: uint8ArrayToBase64(newCacheKeySeed),
        userId,
    });
}
```

---

## 9. File Structure

**Frontend (encryption module):**
```
src/ui/src/shared/crypto/
|-- storageEncryption.ts       # DEK lifecycle, encrypt/decrypt, init/teardown, multi-tab coordination
```

**Frontend (auth integration):**
```
src/ui/src/config/api.ts                          # initStorageEncryptionFromApi() - calls GetCacheKeySeed, inits encryption after rehydration/login
src/ui/src/config/index.ts                        # Re-exports initStorageEncryptionFromApi
src/ui/src/features/auth/components/AuthForms.tsx  # Calls initStorageEncryptionFromApi after login/register
src/ui/src/components/layout/UserMenu.tsx          # Calls teardownStorageEncryption on logout
```

**Frontend (kill switch UI):**
```
src/ui/src/features/settings/components/SecuritySection.tsx   # "Clear This Device" + "Clear All Devices" + Active Sessions
src/ui/src/features/settings/components/SettingsLayout.tsx    # "Security" nav section
src/ui/src/features/admin/components/members/MembersSection.tsx  # "Invalidate Local Caches" per-member action
```

**Frontend (consumers - encrypted IndexedDB stores):**
```
src/ui/src/features/notes/utils/notesCache.ts     # Notes cache (uniffy-notes-cache) - encrypted
src/ui/src/features/files/utils/thumbnails.ts     # Thumbnails cache (uniffy-thumbnails) - encrypted
```

**Backend:**
```
src/uniffy/core/models/login/user.py              # cache_key_seed field (LargeBinary(32))
src/proto/auth/v1/auth.proto                      # GetCacheKeySeed + RotateCacheKeySeed RPCs
src/uniffy/domains/auth/operations.py             # get_cache_key_seed(), rotate_cache_key_seed(), seed rotation in revoke_other_sessions()
src/uniffy/domains/auth/handlers.py               # RPC handlers for both new endpoints
src/uniffy/domains/users/operations.py            # Seed rotation in admin_update() on password change + deactivation
src/uniffy/db/migrations/versions/036_add_cache_key_seed.py  # Migration
```

---

## 10. Implementation Status

### Implemented

- `cache_key_seed` on User model (32-byte `LargeBinary`, auto-generated on creation)
- Dedicated `GetCacheKeySeed` RPC in `auth.v1.AuthService` (seed is NOT in `GetCurrentUserResponse`)
- `RotateCacheKeySeed` RPC with `target_user_id` for admin use
- Frontend encryption module (`storageEncryption.ts`) with full key hierarchy, encrypt/decrypt, multi-tab BroadcastChannel coordination
- Encryption init on login/rehydration via `initStorageEncryptionFromApi()`
- Encryption teardown on logout
- Graceful fallback when `crypto.subtle` is unavailable or encryption not yet initialized
- Notes cache encrypted in IndexedDB (`uniffy-notes-cache`) - first consumer
- Thumbnails cache encrypted in IndexedDB (`uniffy-thumbnails`) - second consumer
- Seed rotation on password change (admin), account deactivation, and "sign out other sessions"
- User kill switch: "Clear This Device" + "Clear All Devices" in Settings > Security
- Admin kill switch: "Invalidate Local Caches" per-member action in admin member management
- Logging restrictions documented (Section 7.4)

### Next

- Chat messages encrypted in IndexedDB (split-store pattern, Section 6.5) - when chat feature is implemented
- Calendar event cache encryption - when calendar caching is added

### Future

- Admin UI showing "last cache invalidation" timestamp per user
- Optional: per-org policy to disable client-side caching entirely (compliance)
- Audit log entries for cache key rotations (who, when, target user)
