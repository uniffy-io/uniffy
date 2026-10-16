// One WebSocket per browser tab multiplexes every attached doc.
// Frame = [VarString docName][y-protocols bytes].
// Public entrypoint: `realtimeMultiplexer.attach()`.

import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import {
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { getStoreRef } from "@/app/storeRef";
import { readStoredAuth } from "@/features/auth/store/credentialStorage";
import { getAccessToken, refreshAccessToken } from "@/config/api";
import { encodeDocFrame, peekVarString } from "@/features/realtime/multiplex";
import {
  REMOTE_ORIGIN,
  linkRecovery,
} from "@/features/realtime/persistence/encryptedYjsPersistence";
import {
  AUTH_REFRESHED_EVENT,
  AUTH_REVOKED_EVENT,
  CANONICAL_SUBPROTOCOL,
  MESSAGE_ACCEPTED_RECEIPT,
  MESSAGE_COMMITTED,
  MESSAGE_CHECKPOINT_PROGRESS,
  MESSAGE_DURABLE_UPDATE,
  MESSAGE_GENERATION,
  MESSAGE_SESSION_STATE,
  UNAVAILABLE_REASON,
  UPDATE_CONFLICT_REASON,
  WS_CLOSE_FORBIDDEN,
  WS_CLOSE_NORMAL,
  WS_CLOSE_REAUTH_REQUIRED,
  WS_CLOSE_UNAUTHENTICATED,
  WS_CLOSE_TOKEN_REVOKED,
  WS_CLOSE_UPGRADE_REQUIRED,
  decodeAcceptedReceipt,
  decodeCommitted,
  decodeCheckpointProgress,
  decodeGeneration,
  decodeSessionState,
  type RealtimeStatus,
} from "@/features/realtime/protocol";
import { docNameFor } from "@/features/realtime/docNames";
import { docGeneration } from "@/features/realtime/docGeneration";
import {
  UpdateCoverage,
  type CoverageTransition,
  type ReceiptIdentity,
} from "@/features/realtime/updateCoverage";

// y-protocols message-type constants - upstream exposes them only as numeric literals.
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_AUTH = 2;
const MESSAGE_QUERY_AWARENESS = 3;
const MESSAGE_FRAGMENT_SEEDER = 4;
const AUTH_PERMISSION_DENIED = 0;

const RECONNECT_INITIAL_MS = 500;
const AUTH_RETRY_LIMIT = 5;
const RECONNECT_MAX_MS = 15_000;
const RECONNECT_MULTIPLIER = 1.5;
// First resend after the server refuses a write it may take later; later ones back off.
const UNAVAILABLE_RETRY_MS = 5_000;
const RESYNC_INTERVAL_MS = 30_000;
const IDLE_CLOSE_MS = 30_000;
const UPDATE_BATCH_MS = 50;
const UPDATE_BATCH_BYTES = 64 * 1024;
const MAX_UPDATE_BYTES = 1024 * 1024 - 4096;
// Bounds what a reconnect would retransmit. Accepted bytes wait for a checkpoint, not the socket.
const MAX_LOCAL_BYTES = 8 * 1024 * 1024;
// y-protocols/awareness GCs peer entries after `outdatedTimeout` (30s);
// without periodic keep-alive, peer cursors vanish on typing pauses.
const AWARENESS_KEEPALIVE_MS = 15_000;

// Empty updates carry no content or deletions and need no acknowledgment.
function isNoopSyncStep2(reply: Uint8Array): boolean {
  const dec = decoding.createDecoder(reply);
  if (decoding.readVarUint(dec) !== MESSAGE_SYNC) return false;
  if (decoding.readVarUint(dec) !== syncProtocol.messageYjsSyncStep2) return false;
  const update = decoding.readVarUint8Array(dec);
  return update.length === 2 && update[0] === 0 && update[1] === 0;
}

export interface MultiplexerAttachOptions {
  contentType: string;
  contentId: string;
  ydoc: Y.Doc;
  awareness: Awareness;
  onStatus?: (status: RealtimeStatus) => void;
  onSync?: () => void;
  onGenerationMismatch?: () => void;
  onCloseCode?: (code: number) => void;
  /** The server downgraded this doc to read-only while the client still believed it could edit. */
  onWriteDenied?: (reason: string, noView: boolean) => void;
}

export interface DocSubscription {
  setSeedCapability?: (capable: boolean) => void;
  readonly docName: string;
  readonly isFragmentSeeder: boolean;
  submitSeed(update: Uint8Array, base: string, signal?: AbortSignal): Promise<boolean>;
  subscribeFragmentSeeder(listener: () => void): () => void;
  destroy(): void;
}

export type FragmentSeeder = Pick<
  DocSubscription,
  "isFragmentSeeder" | "subscribeFragmentSeeder" | "submitSeed" | "setSeedCapability"
>;

/** Save progress of one attached document's own edits. Replaced, never mutated, on change. */
export interface RealtimeDocState {
  /** Some own edit is buffered, unsent or lacks a server receipt. */
  transportPending: boolean;
  /** Some own edit is not yet in a PostgreSQL checkpoint. Implies nothing about the socket. */
  checkpointPending: boolean;
  /** Epoch milliseconds of the oldest own edit not yet checkpointed. */
  oldestUncheckpointedAt: number | null;
  /** The server refused an own edit it may take later; edits stay local and resend on their own. */
  savingUnavailable: boolean;
}

/** One own update changed coverage. `local` carries the bytes a retry or recovery replays. */
export type UpdateCoverageEvent =
  | { updateId: string; coverage: "local"; editedAt: number; update: Uint8Array }
  | { updateId: string; coverage: "accepted"; editedAt: number; receipt: ReceiptIdentity }
  | { updateId: string; coverage: "checkpointed"; editedAt: number };

/** An uncheckpointed update kept by local recovery, handed back after a restart. */
export interface RetainedUpdate {
  updateId: string;
  update: Uint8Array;
  editedAt: number;
  receipt: ReceiptIdentity | null;
}

const DETACHED_DOC_STATE: RealtimeDocState = Object.freeze({
  transportPending: false,
  checkpointPending: false,
  oldestUncheckpointedAt: null,
  savingUnavailable: false,
});

interface DocEntry {
  localBatch: Uint8Array[];
  localBatchBytes: number;
  batchBoundary: number;
  batchTimer: ReturnType<typeof setTimeout> | null;
  scheduleBatch: () => void;
  flushBatch: () => void;
  rejected: boolean;
  syncDeadline: ReturnType<typeof setTimeout> | null;
  docName: string;
  ydoc: Y.Doc;
  awareness: Awareness;
  resolvedSyncOnce: boolean;
  fragmentSeeder: boolean;
  canSeed: boolean;
  seedToken: string;
  seedRequests: Map<string, (accepted: boolean) => void>;
  seederListeners: Set<() => void>;
  // Read-only documents retain local drafts but suppress write frames.
  readOnly: boolean;
  denied: boolean;
  // Null until this socket hears message 5; gates every write.
  generation: string | null;
  updateCounter: number;
  // Raw bytes per own update id until a checkpoint covers it, delete-only updates included.
  retained: Map<string, Uint8Array>;
  coverage: UpdateCoverage;
  // Write and seed ids sent on this socket, oldest first. The server answers them in order, so a
  // denial without an id belongs to the head.
  awaiting: string[];
  // Ids the server holds different bytes for. They stay local and are never sent again.
  conflicted: Set<string>;
  savingUnavailable: boolean;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryDelayMs: number;
  // First buffered edit that has no update id yet.
  unsentSince: number | null;
  state: RealtimeDocState;
  unlinkRecovery: () => void;
  updateHandler: (update: Uint8Array, origin: unknown) => void;
  awarenessHandler: (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => void;
  options: MultiplexerAttachOptions;
}

function addListener<T>(
  registry: Map<string, Set<(value: T) => void>>,
  docName: string,
  listener: (value: T) => void,
): () => void {
  let set = registry.get(docName);
  if (!set) {
    set = new Set();
    registry.set(docName, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) registry.delete(docName);
  };
}

// A malformed frame changes nothing; the socket stays up for the other documents.
function decodeFrame<T>(payload: Uint8Array, decode: (frame: Uint8Array) => T): T | null {
  try {
    return decode(payload);
  } catch (err) {
    console.warn("[realtime] malformed frame", err);
    return null;
  }
}

class RealtimeMultiplexer {
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private wsConnecting = false;
  private docs = new Map<string, DocEntry>();
  private reconnectDelayMs = RECONNECT_INITIAL_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private resyncTimer: ReturnType<typeof setInterval> | null = null;
  private idleCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private awarenessKeepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private stateListeners = new Map<string, Set<(state: RealtimeDocState) => void>>();
  private coverageListeners = new Map<string, Set<(event: UpdateCoverageEvent) => void>>();
  private refreshRequired = false;
  private refreshing = false;
  private authAttempts = 0;
  private destroyed = false;
  // Set by close 4426 and kept until the page reloads with a bundle that speaks the server's protocol.
  private upgradeRequired = false;
  private listenersAttached = false;

  attach(opts: MultiplexerAttachOptions): DocSubscription {
    const docName = docNameFor(opts.contentType, opts.contentId);
    if (this.docs.has(docName)) {
      // The original subscription owns the Y.Doc lifecycle; aliasing breaks teardown.
      throw new Error(`realtime: ${docName} already attached on this tab`);
    }

    this.ensureListeners();

    const entry: DocEntry = {
      rejected: false,
      syncDeadline: null,
      localBatch: [],
      localBatchBytes: 0,
      batchBoundary: 0,
      batchTimer: null,
      scheduleBatch: () => {
        if (!entry.localBatch.length || entry.rejected || entry.denied) return;
        if (entry.localBatchBytes > MAX_UPDATE_BYTES && entry.batchBoundary > 0) {
          // Separate prior edits without splitting this transaction's mirror updates.
          const transaction = entry.localBatch.splice(entry.batchBoundary);
          entry.flushBatch();
          entry.localBatch = transaction;
          entry.localBatchBytes = transaction.reduce((sum, update) => sum + update.length, 0);
          entry.unsentSince = Date.now();
        }
        if (entry.localBatchBytes >= UPDATE_BATCH_BYTES || document.visibilityState === "hidden") {
          entry.flushBatch();
        } else if (entry.batchTimer === null) {
          // Keep the first deadline so continuous typing cannot postpone a save.
          entry.batchTimer = setTimeout(entry.flushBatch, UPDATE_BATCH_MS);
        }
        entry.batchBoundary = entry.localBatch.length;
      },
      flushBatch: () => {
        if (entry.batchTimer !== null) clearTimeout(entry.batchTimer);
        entry.batchTimer = null;
        if (!entry.localBatch.length) return;
        this.queueUpdate(entry, Y.mergeUpdates(this.takeBatch(entry)), this.takeUnsentSince(entry));
      },
      docName,
      ydoc: opts.ydoc,
      awareness: opts.awareness,
      resolvedSyncOnce: false,
      fragmentSeeder: false,
      canSeed: false,
      seedToken: "",
      seedRequests: new Map(),
      seederListeners: new Set(),
      readOnly: false,
      denied: false,
      generation: null,
      updateCounter: 0,
      retained: new Map(),
      coverage: new UpdateCoverage(),
      awaiting: [],
      conflicted: new Set(),
      savingUnavailable: false,
      retryTimer: null,
      retryDelayMs: UNAVAILABLE_RETRY_MS,
      unsentSince: null,
      state: DETACHED_DOC_STATE,
      unlinkRecovery: () => {},
      updateHandler: (update, origin) => {
        // Skip echoes of frames we just applied from the wire.
        if (origin === REMOTE_ORIGIN) return;
        if (entry.rejected || entry.denied) {
          this.queueUpdate(entry, update, Date.now());
          return;
        }
        // Read-only docs never push state. IDB hydration replays of
        // server-known content would otherwise leave as write frames.
        entry.localBatch.push(update);
        entry.localBatchBytes += update.length;
        entry.unsentSince ??= Date.now();
        if (!entry.state.transportPending) this.publishState(entry);
      },
      awarenessHandler: (changes, origin) => {
        if (origin === "remote") return;
        const changed = changes.added.concat(changes.updated, changes.removed);
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(opts.awareness, changed));
        this.sendForDoc(docName, encoding.toUint8Array(enc));
      },
      options: opts,
    };

    opts.ydoc.on("update", entry.updateHandler);
    opts.ydoc.on("afterAllTransactions", entry.scheduleBatch);
    opts.awareness.on("change", entry.awarenessHandler);
    this.docs.set(docName, entry);
    // Local recovery keeps every update until a checkpoint covers it and hands back what an
    // earlier session of this doc left unconfirmed.
    entry.unlinkRecovery = linkRecovery(docName, {
      subscribeCoverage: (listener) => this.subscribeCoverage(docName, listener),
      restorePending: (updates) => this.restorePending(entry, updates),
      isCheckpointPending: () => entry.state.checkpointPending,
    });
    this.cancelIdleClose();
    this.openIfNeeded(opts.contentType, opts.contentId);

    if (this.wsConnected) {
      // WS was already open before this attach; push status + SyncStep1
      // synchronously so the new subscription does not stall on `'idle'`.
      opts.onStatus?.("connected");
      this.bootstrapDoc(entry);
    } else if (this.wsConnecting) {
      // Late attach mid-handshake; surface the in-flight state immediately.
      opts.onStatus?.("connecting");
    } else if (this.upgradeRequired) {
      opts.onStatus?.("upgrade_required");
    }

    return {
      docName,
      get isFragmentSeeder() {
        return entry.fragmentSeeder;
      },
      submitSeed: (update, base, signal) => this.submitSeed(entry, update, base, signal),
      setSeedCapability: (capable) => {
        entry.canSeed = capable;
        this.sendForDoc(docName, new Uint8Array([10, Number(capable)]));
      },
      subscribeFragmentSeeder: (listener) => {
        entry.seederListeners.add(listener);
        return () => entry.seederListeners.delete(listener);
      },
      destroy: () => this.detach(docName),
    };
  }

  private detach(docName: string): void {
    const entry = this.docs.get(docName);
    if (!entry) return;
    entry.flushBatch();
    if (entry.canSeed) this.sendForDoc(docName, new Uint8Array([10, 0]));
    if (entry.syncDeadline) clearTimeout(entry.syncDeadline);
    if (entry.retryTimer !== null) clearTimeout(entry.retryTimer);
    entry.ydoc.off("update", entry.updateHandler);
    entry.ydoc.off("afterAllTransactions", entry.scheduleBatch);
    entry.awareness.off("change", entry.awarenessHandler);
    // Announce departure so peers drop our cursor now, rather than waiting for
    // y-protocols' 30s outdatedTimeout GC. The change handler is already
    // detached, so this manual frame is the only removal that goes out.
    if (this.ws?.readyState === WebSocket.OPEN && entry.awareness.getLocalState() !== null) {
      removeAwarenessStates(entry.awareness, [entry.awareness.clientID], "local-detach");
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(
        enc,
        encodeAwarenessUpdate(entry.awareness, [entry.awareness.clientID]),
      );
      this.sendForDoc(docName, encoding.toUint8Array(enc));
    }
    for (const settle of entry.seedRequests.values()) settle(false);
    entry.unlinkRecovery();
    this.docs.delete(docName);
    entry.seederListeners.clear();
    if (this.docs.size === 0) this.scheduleIdleClose();
  }

  private openIfNeeded(contentTypeHint: string, contentIdHint: string): void {
    if (this.ws || this.wsConnecting) return;
    if (this.destroyed || this.upgradeRequired) return;
    void contentTypeHint;
    void contentIdHint;
    this.wsConnecting = true;
    this.connectNow();
  }

  private connectNow(): void {
    if (this.destroyed || this.ws || this.refreshing || this.upgradeRequired) return;
    if (this.refreshRequired || !getAccessToken()) {
      this.reconnectAfterRefresh();
      return;
    }
    const orgId = this.resolveOrgId();
    if (!orgId) {
      // No org context yet (rehydration in flight); retry shortly.
      this.scheduleReconnect();
      return;
    }
    const url = this.buildUrl(orgId);
    const token = getAccessToken() ?? "";
    const protocols = [CANONICAL_SUBPROTOCOL, `bearer.${encodeURIComponent(token)}`];

    let ws: WebSocket;
    try {
      ws = new WebSocket(url, protocols);
    } catch (err) {
      console.warn("[realtime] WebSocket constructor failed", err);
      this.wsConnecting = false;
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    this.emitStatusAll("connecting");

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.wsConnecting = false;
      this.wsConnected = true;
      this.reconnectDelayMs = RECONNECT_INITIAL_MS;
      for (const entry of this.docs.values()) {
        entry.resolvedSyncOnce = false;
        entry.generation = null;
        this.bootstrapDoc(entry);
      }
      this.emitStatusAll("connected");
      this.startResyncTimer();
      this.startAwarenessKeepaliveTimer();
    };

    ws.onmessage = (event: MessageEvent<ArrayBuffer | Blob | string>) => {
      if (this.ws !== ws) return;
      const data = event.data;
      if (data instanceof ArrayBuffer) {
        this.onFrame(new Uint8Array(data));
        return;
      }
      if (typeof data !== "string" && "arrayBuffer" in data) {
        void data.arrayBuffer().then((buf) => {
          if (this.ws === ws) this.onFrame(new Uint8Array(buf));
        });
      }
    };

    ws.onclose = (event: CloseEvent) => {
      if (this.ws !== ws) return;
      const closingForGood = this.destroyed || event.code === WS_CLOSE_NORMAL;
      this.cleanupSocket();
      for (const entry of this.docs.values()) {
        entry.options.onCloseCode?.(event.code);
      }
      if (closingForGood) return;
      if (event.code === WS_CLOSE_TOKEN_REVOKED) {
        // Server-side logout-all-devices; let the app shell redirect.
        return;
      }
      if (event.code === WS_CLOSE_UPGRADE_REQUIRED) {
        // Every reconnect would be refused the same way; edits stay local until a reload.
        this.upgradeRequired = true;
        this.emitStatusAll("upgrade_required");
        return;
      }
      if (event.code === WS_CLOSE_REAUTH_REQUIRED || event.code === WS_CLOSE_UNAUTHENTICATED) {
        // The socket hit its token's lifetime. Reconnecting with the same
        // memory token would be refused, so refresh first.
        this.refreshRequired = true;
        this.scheduleReconnect();
        return;
      }
      if (event.code === WS_CLOSE_FORBIDDEN) {
        // Auth/permission lost; surface as disconnected but still try to
        // reconnect (the user may regain access via an org switch).
        this.emitStatusAll("disconnected");
      } else {
        this.emitStatusAll("disconnected");
      }
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose always follows; let it own the cleanup.
    };
  }

  private cleanupSocket(): void {
    for (const entry of this.docs.values()) {
      if (entry.syncDeadline) clearTimeout(entry.syncDeadline);
      entry.syncDeadline = null;
      // Answers to writes sent on the old socket never arrive.
      entry.awaiting = [];
    }
    this.ws = null;
    this.wsConnected = false;
    this.wsConnecting = false;
    this.stopResyncTimer();
    this.stopAwarenessKeepaliveTimer();
    for (const entry of this.docs.values()) {
      for (const settle of entry.seedRequests.values()) settle(false);
      this.setFragmentSeeder(entry, false);
      // Disconnected peers cannot maintain presence or coordinate local mirror writes.
      removeAwarenessStates(
        entry.awareness,
        [...entry.awareness.getStates().keys()].filter((id) => id !== entry.awareness.clientID),
        "remote",
      );
    }
  }

  private reconnectAfterRefresh(): void {
    if (this.destroyed || this.docs.size === 0 || this.refreshing) return;
    if (this.authAttempts >= AUTH_RETRY_LIMIT) {
      this.emitStatusAll("disconnected");
      return;
    }
    this.authAttempts += 1;
    this.refreshing = true;
    this.refreshRequired = true;
    this.emitStatusAll("connecting");
    void refreshAccessToken()
      .catch(() => null)
      .then((token) => {
        this.refreshing = false;
        if (this.destroyed || this.docs.size === 0) return;
        if (token) {
          this.refreshRequired = false;
          this.connectNow();
        } else {
          this.emitStatusAll("disconnected");
          this.scheduleReconnect();
        }
      });
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectTimer) return;
    if (this.docs.size === 0) return;
    const delay = this.reconnectDelayMs * (0.75 + Math.random() * 0.5);
    this.reconnectDelayMs = Math.min(
      this.reconnectDelayMs * RECONNECT_MULTIPLIER,
      RECONNECT_MAX_MS,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectNow();
    }, delay);
  }

  retryConnection(): void {
    if (!this.destroyed) {
      this.authAttempts = 0;
      this.forceReconnect();
    }
  }

  private forceReconnect(): void {
    // Drop the current socket and reopen immediately, bypassing backoff.
    // Used by online/visibilitychange/auth-refresh triggers.
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignored
      }
      this.cleanupSocket();
    }
    this.reconnectDelayMs = RECONNECT_INITIAL_MS;
    if (this.docs.size > 0) this.connectNow();
  }

  private startResyncTimer(): void {
    this.stopResyncTimer();
    this.resyncTimer = setInterval(() => {
      // Periodic SyncStep1 catches docs that silently fell out of sync.
      for (const entry of this.docs.values()) {
        this.sendInitialSync(entry);
      }
    }, RESYNC_INTERVAL_MS);
  }

  private stopResyncTimer(): void {
    if (this.resyncTimer) {
      clearInterval(this.resyncTimer);
      this.resyncTimer = null;
    }
  }

  private startAwarenessKeepaliveTimer(): void {
    this.stopAwarenessKeepaliveTimer();
    this.awarenessKeepaliveTimer = setInterval(() => {
      // Rebroadcast local awareness so peers' `outdatedTimeout` resets
      // and our cursor/label stays on their screen.
      for (const entry of this.docs.values()) {
        this.sendLocalAwareness(entry);
      }
    }, AWARENESS_KEEPALIVE_MS);
  }

  private sendLocalAwareness(entry: DocEntry): void {
    if (entry.awareness.getLocalState() === null) return;
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(
      enc,
      encodeAwarenessUpdate(entry.awareness, [entry.awareness.clientID]),
    );
    this.sendForDoc(entry.docName, encoding.toUint8Array(enc));
  }

  private stopAwarenessKeepaliveTimer(): void {
    if (this.awarenessKeepaliveTimer) {
      clearInterval(this.awarenessKeepaliveTimer);
      this.awarenessKeepaliveTimer = null;
    }
  }

  private scheduleIdleClose(): void {
    this.cancelIdleClose();
    if (!this.ws) return;
    this.idleCloseTimer = setTimeout(() => {
      this.idleCloseTimer = null;
      if (this.docs.size === 0 && this.ws) {
        try {
          this.ws.close(WS_CLOSE_NORMAL, "idle");
        } catch {
          // ignored
        }
        this.cleanupSocket();
      }
    }, IDLE_CLOSE_MS);
  }

  private cancelIdleClose(): void {
    if (this.idleCloseTimer) {
      clearTimeout(this.idleCloseTimer);
      this.idleCloseTimer = null;
    }
  }

  private onFrame(frame: Uint8Array): void {
    let docName: string;
    let payloadOffset: number;
    try {
      ({ docName, payloadOffset } = peekVarString(frame));
    } catch (err) {
      console.warn("[realtime] malformed multiplex prefix", err);
      return;
    }
    const entry = this.docs.get(docName);
    if (!entry || entry.denied) return;
    this.authAttempts = 0;
    const payload = frame.subarray(payloadOffset);
    if (payload.length === 0) return;

    const decoder = decoding.createDecoder(payload);
    const messageType = decoding.readVarUint(decoder);
    if (messageType === MESSAGE_GENERATION) {
      const generation = decodeFrame(payload, decodeGeneration);
      if (generation === null) return;
      const local = docGeneration(entry.ydoc);
      if (local !== null && local !== generation) {
        entry.denied = true;
        entry.options.onGenerationMismatch?.();
        return;
      }
      const reconnecting = entry.generation === null;
      entry.generation = generation;
      // Accepted updates wait for session state to prove or refute their presence.
      if (reconnecting) for (const id of entry.coverage.localIds()) this.sendRetained(entry, id);
      this.publishState(entry);
    } else if (messageType === MESSAGE_COMMITTED) {
      const id = decodeFrame(payload, decodeCommitted);
      if (id === null) return;
      this.resumeSaving(entry, id);
      entry.seedRequests.get(id)?.(true);
      this.applyCoverage(entry, entry.coverage.applyCommitted(id));
    } else if (messageType === MESSAGE_ACCEPTED_RECEIPT) {
      const receipt = decodeFrame(payload, decodeAcceptedReceipt);
      if (!receipt) return;
      this.resumeSaving(entry, receipt.updateId);
      this.applyCoverage(entry, entry.coverage.applyReceipt(receipt));
    } else if (messageType === MESSAGE_CHECKPOINT_PROGRESS) {
      const progress = decodeFrame(payload, decodeCheckpointProgress);
      if (progress) this.applyCoverage(entry, entry.coverage.applyProgress(progress));
    } else if (messageType === MESSAGE_SESSION_STATE) {
      const state = decodeFrame(payload, decodeSessionState);
      // Message 5 owns generation changes; state for another generation proves nothing here.
      if (!state || state.generation !== entry.generation) return;
      const previousEpoch = entry.coverage.epoch;
      const inFlight = entry.coverage.localIds();
      this.applyCoverage(entry, entry.coverage.applySessionState(state));
      // A receipt for a write sent before the reset would carry the retired epoch and be ignored,
      // so writes still in flight go out again; the server deduplicates by id.
      if (previousEpoch !== null && previousEpoch !== state.epoch)
        for (const id of inFlight) this.sendRetained(entry, id);
    } else if (messageType === 9) {
      const id = decoding.readVarString(decoder);
      this.answered(entry, id);
      entry.seedRequests.get(id)?.(false);
    } else if (messageType === MESSAGE_SYNC) {
      if (entry.syncDeadline) clearTimeout(entry.syncDeadline);
      entry.syncDeadline = null;
      if (entry.generation === null) return;
      const replyEncoder = encoding.createEncoder();
      encoding.writeVarUint(replyEncoder, MESSAGE_SYNC);
      const syncMessageType = syncProtocol.readSyncMessage(
        decoder,
        replyEncoder,
        entry.ydoc,
        // Marks server-applied updates so the update handler skips re-sending
        // them and IDB persistence skips storing them.
        REMOTE_ORIGIN,
      );
      const replyBytes = encoding.toUint8Array(replyEncoder);
      if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
        this.replySyncStep2(entry, replyBytes);
      } else if (replyBytes.length > 1) {
        // `readSyncMessage` always writes the SYNC type byte; a body-less
        // reply leaves just that byte - skip the echo.
        this.sendForDoc(docName, replyBytes);
      }
      if (syncMessageType === syncProtocol.messageYjsSyncStep2 && !entry.resolvedSyncOnce) {
        entry.resolvedSyncOnce = true;
        entry.options.onSync?.();
      }
    } else if (messageType === MESSAGE_AWARENESS) {
      applyAwarenessUpdate(entry.awareness, decoding.readVarUint8Array(decoder), "remote");
    } else if (messageType === MESSAGE_QUERY_AWARENESS) {
      this.sendLocalAwareness(entry);
    } else if (messageType === MESSAGE_AUTH) {
      const scope = decoding.readVarUint(decoder);
      if (scope !== AUTH_PERMISSION_DENIED && scope !== 1) return;
      const reason = decoding.readVarString(decoder);
      if (reason === UNAVAILABLE_REASON) {
        this.refuseUnavailable(entry);
        return;
      }
      if (reason === UPDATE_CONFLICT_REASON) {
        this.rejectConflict(entry);
        return;
      }
      if (reason.includes("too large")) {
        this.rejectOversized(entry);
        return;
      }
      if (entry.readOnly && scope === AUTH_PERMISSION_DENIED) return;
      entry.denied = scope === 1;
      this.setDocReadOnly(docName, true);
      entry.options.onWriteDenied?.(reason, scope === 1);
    } else if (messageType === MESSAGE_FRAGMENT_SEEDER) {
      const granted = decoding.readVarUint(decoder) === 1;
      const token = decoding.hasContent(decoder) ? decoding.readVarString(decoder) : "";
      this.setFragmentSeeder(entry, granted, token);
    }
  }

  private setFragmentSeeder(entry: DocEntry, granted: boolean, token = ""): void {
    if (entry.fragmentSeeder === granted && entry.seedToken === token) return;
    for (const settle of entry.seedRequests.values()) settle(false);
    entry.fragmentSeeder = granted;
    entry.seedToken = token;
    for (const listener of entry.seederListeners) listener();
  }

  private submitSeed(
    entry: DocEntry,
    update: Uint8Array,
    base: string,
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (
      !entry.fragmentSeeder ||
      !entry.seedToken ||
      entry.generation === null ||
      entry.readOnly ||
      signal?.aborted ||
      !this.wsConnected
    )
      return Promise.resolve(false);
    return new Promise((resolve) => {
      const id = `${entry.ydoc.guid}:seed:${++entry.updateCounter}`;
      const settle = (accepted: boolean) => {
        clearTimeout(timer);
        entry.seedRequests.delete(id);
        signal?.removeEventListener("abort", abort);
        resolve(accepted);
      };
      const abort = () => settle(false);
      const timer = setTimeout(abort, 10_000);
      entry.seedRequests.set(id, settle);
      signal?.addEventListener("abort", abort, { once: true });
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 8);
      encoding.writeVarString(encoder, entry.generation!);
      encoding.writeVarString(encoder, id);
      encoding.writeVarString(encoder, entry.seedToken);
      encoding.writeVarString(encoder, base);
      encoding.writeVarUint8Array(encoder, update);
      if (this.sendForDoc(entry.docName, encoding.toUint8Array(encoder))) entry.awaiting.push(id);
    });
  }

  private answered(entry: DocEntry, id: string): void {
    const index = entry.awaiting.indexOf(id);
    if (index >= 0) entry.awaiting.splice(index, 1);
  }

  // A receipt or commit answers its write and shows the server takes writes again.
  private resumeSaving(entry: DocEntry, id: string): void {
    this.answered(entry, id);
    entry.savingUnavailable = false;
    entry.retryDelayMs = UNAVAILABLE_RETRY_MS;
  }

  // Every local update stays local. A timer resends them, and every reconnect does too.
  private refuseUnavailable(entry: DocEntry): void {
    const id = entry.awaiting.shift();
    const seed = id === undefined ? undefined : entry.seedRequests.get(id);
    if (seed) {
      seed(false);
      return;
    }
    entry.savingUnavailable = true;
    this.publishState(entry);
    if (entry.retryTimer !== null) return;
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = null;
      for (const localId of entry.coverage.localIds())
        if (!entry.awaiting.includes(localId)) this.sendRetained(entry, localId);
    }, entry.retryDelayMs);
    entry.retryDelayMs = Math.min(entry.retryDelayMs * RECONNECT_MULTIPLIER, RECONNECT_MAX_MS);
  }

  // Only the refused update stops. It stays local and in recovery while the others keep syncing.
  private rejectConflict(entry: DocEntry): void {
    const id = entry.awaiting.shift();
    if (id === undefined) return;
    const seed = entry.seedRequests.get(id);
    if (seed) {
      seed(false);
      return;
    }
    entry.conflicted.add(id);
    if (entry.conflicted.size === 1) entry.options.onStatus?.("update_rejected");
  }

  // Our reply to a server SyncStep1 carries every local update the server
  // lacks, including edits dropped while disconnected.
  private replySyncStep2(entry: DocEntry, replyBytes: Uint8Array): void {
    if (entry.readOnly || isNoopSyncStep2(replyBytes)) return;
    const decoder = decoding.createDecoder(replyBytes);
    decoding.readVarUint(decoder);
    decoding.readVarUint(decoder);
    // The handshake includes buffered local edits. Cancel their separate send.
    const update = decoding.readVarUint8Array(decoder);
    if (entry.batchTimer !== null) clearTimeout(entry.batchTimer);
    entry.batchTimer = null;
    const updates = this.takeBatch(entry);
    this.queueUpdate(entry, Y.mergeUpdates([...updates, update]), this.takeUnsentSince(entry));
  }

  private takeBatch(entry: DocEntry): Uint8Array[] {
    const updates = entry.localBatch;
    entry.localBatch = [];
    entry.localBatchBytes = 0;
    entry.batchBoundary = 0;
    return updates;
  }

  private takeUnsentSince(entry: DocEntry): number {
    const since = entry.unsentSince ?? Date.now();
    entry.unsentSince = null;
    return since;
  }

  private rejectOversized(entry: DocEntry): void {
    if (!entry.rejected) {
      entry.rejected = true;
      this.setFragmentSeeder(entry, false);
      entry.readOnly = true;
      entry.options.onWriteDenied?.("update too large", false);
      entry.options.onStatus?.("update_rejected");
    }
    this.publishState(entry);
  }

  private queueUpdate(entry: DocEntry, update: Uint8Array, editedAt: number): void {
    let localBytes = update.length;
    for (const id of entry.coverage.localIds()) localBytes += entry.retained.get(id)?.length ?? 0;
    if (entry.rejected || update.length > MAX_UPDATE_BYTES || localBytes > MAX_LOCAL_BYTES) {
      // The edit stays in the Y.Doc and local recovery; transport drops it.
      entry.unsentSince = Math.min(entry.unsentSince ?? editedAt, editedAt);
      this.rejectOversized(entry);
      return;
    }
    const id = entry.ydoc.guid + ":" + ++entry.updateCounter;
    entry.retained.set(id, update);
    this.applyCoverage(entry, entry.coverage.add(id, editedAt));
  }

  private restorePending(entry: DocEntry, updates: readonly RetainedUpdate[]): void {
    for (const { updateId, update, editedAt, receipt } of updates) {
      if (entry.retained.has(updateId)) continue;
      entry.retained.set(updateId, update);
      this.applyCoverage(entry, entry.coverage.add(updateId, editedAt, receipt));
    }
  }

  // Every update that becomes local is sent: new edits, restored ones, and accepted ones whose
  // presence the server can no longer prove. Replays keep the original id.
  private applyCoverage(entry: DocEntry, transitions: CoverageTransition[]): void {
    const listeners = this.coverageListeners.get(entry.docName) ?? [];
    for (const transition of transitions) {
      const update = entry.retained.get(transition.updateId);
      if (transition.coverage === "checkpointed") entry.retained.delete(transition.updateId);
      if (transition.coverage !== "local") {
        for (const listener of listeners) listener(transition);
      } else if (update) {
        for (const listener of listeners) listener({ ...transition, update });
        this.sendDurableUpdate(entry, transition.updateId, update);
      }
    }
    this.publishState(entry);
  }

  private sendRetained(entry: DocEntry, id: string): void {
    const update = entry.retained.get(id);
    if (update) this.sendDurableUpdate(entry, id, update);
  }

  private sendDurableUpdate(entry: DocEntry, id: string, update: Uint8Array): void {
    if (entry.generation === null || entry.readOnly || entry.rejected || entry.conflicted.has(id))
      return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_DURABLE_UPDATE);
    encoding.writeVarString(encoder, entry.generation);
    encoding.writeVarString(encoder, id);
    encoding.writeVarUint8Array(encoder, update);
    if (this.sendForDoc(entry.docName, encoding.toUint8Array(encoder))) entry.awaiting.push(id);
  }

  private publishState(entry: DocEntry): void {
    const coverage = entry.coverage.summary();
    const unsent = entry.rejected || entry.localBatch.length > 0;
    const transportPending = unsent || coverage.transportPending;
    const oldest = [entry.unsentSince, coverage.oldestUncheckpointedAt].filter(
      (time): time is number => time !== null,
    );
    const next: RealtimeDocState = {
      transportPending,
      checkpointPending: transportPending || coverage.checkpointPending,
      oldestUncheckpointedAt: oldest.length ? Math.min(...oldest) : null,
      savingUnavailable: entry.savingUnavailable,
    };
    const previous = entry.state;
    if (
      previous.transportPending === next.transportPending &&
      previous.checkpointPending === next.checkpointPending &&
      previous.oldestUncheckpointedAt === next.oldestUncheckpointedAt &&
      previous.savingUnavailable === next.savingUnavailable
    )
      return;
    entry.state = Object.freeze(next);
    for (const listener of this.stateListeners.get(entry.docName) ?? []) listener(entry.state);
  }

  /** VIEWER handles are flagged after attach so no SYNC write frame ever leaves. */
  setDocReadOnly(docName: string, readOnly: boolean): void {
    const entry = this.docs.get(docName);
    if (!entry) return;
    entry.readOnly = readOnly;
  }

  /** Stable snapshot for `useSyncExternalStore`; a detached doc reports nothing pending. */
  getDocState(docName: string): RealtimeDocState {
    return this.docs.get(docName)?.state ?? DETACHED_DOC_STATE;
  }

  /** Any editable attached doc with an own edit no checkpoint covers yet. */
  hasCheckpointPending(): boolean {
    for (const entry of this.docs.values()) {
      if (entry.state.checkpointPending && !entry.readOnly) return true;
    }
    return false;
  }

  isDocReadOnly(docName: string): boolean {
    return this.docs.get(docName)?.readOnly ?? false;
  }

  isAttached(docName: string): boolean {
    return this.docs.has(docName);
  }

  subscribeDocState(docName: string, listener: (state: RealtimeDocState) => void): () => void {
    return addListener(this.stateListeners, docName, listener);
  }

  /** Fires on every coverage transition of an own update, before the doc state changes. */
  subscribeCoverage(docName: string, listener: (event: UpdateCoverageEvent) => void): () => void {
    return addListener(this.coverageListeners, docName, listener);
  }

  /** True once the frame is handed to an open socket. */
  private sendForDoc(docName: string, payload: Uint8Array): boolean {
    if (this.docs.get(docName)?.denied) return false;
    const frame = encodeDocFrame(docName, payload);
    if (frame.length > 1024 * 1024) {
      const entry = this.docs.get(docName);
      if (entry) this.rejectOversized(entry);
      return false;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(frame);
      return true;
    } catch (err) {
      console.warn("[realtime] send failed; reconnecting", err);
      this.forceReconnect();
      return false;
    }
  }

  private bootstrapDoc(entry: DocEntry): void {
    if (entry.canSeed) this.sendForDoc(entry.docName, new Uint8Array([10, 1]));
    this.sendInitialSync(entry);
    // Push our awareness so peers see us immediately...
    this.sendLocalAwareness(entry);
    // ...and ask peers to re-announce theirs. The backend keeps no awareness
    // map, so without this an idle peer's cursor stays hidden until their next
    // keep-alive. Peers reply via their MESSAGE_QUERY_AWARENESS handler.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_QUERY_AWARENESS);
    this.sendForDoc(entry.docName, encoding.toUint8Array(enc));
  }

  private sendInitialSync(entry: DocEntry): void {
    if (entry.rejected || entry.denied) return;
    if (!entry.syncDeadline)
      entry.syncDeadline = setTimeout(() => {
        entry.syncDeadline = null;
        this.forceReconnect();
      }, 10_000);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, entry.ydoc);
    this.sendForDoc(entry.docName, encoding.toUint8Array(enc));
  }

  private emitStatusAll(status: RealtimeStatus): void {
    for (const entry of this.docs.values()) {
      entry.options.onStatus?.(
        entry.rejected || entry.conflicted.size > 0
          ? "update_rejected"
          : entry.denied
            ? "access_lost"
            : this.upgradeRequired
              ? "upgrade_required"
              : status,
      );
    }
  }

  private buildUrl(orgId: string): string {
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${window.location.host}/api/realtime?org_id=${encodeURIComponent(orgId)}`;
  }

  private resolveOrgId(): string | null {
    return (
      getStoreRef()?.getState().auth.currentOrganizationId ??
      readStoredAuth()?.currentOrganizationId ??
      null
    );
  }

  private ensureListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;
    window.addEventListener("online", this.handleOnline);
    window.addEventListener("offline", this.handleOffline);
    window.addEventListener("pagehide", this.flushBatches);
    document.addEventListener("visibilitychange", this.handleVisibility);
    window.addEventListener(AUTH_REFRESHED_EVENT, this.handleAuthRefreshed);
    window.addEventListener(AUTH_REVOKED_EVENT, this.handleAuthRevoked);
  }

  private handleOnline = (): void => {
    this.authAttempts = 0;
    if (this.docs.size > 0) this.forceReconnect();
  };

  private handleOffline = (): void => {
    this.emitStatusAll("offline");
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignored
      }
      this.cleanupSocket();
    }
  };

  private handleVisibility = (): void => {
    if (document.visibilityState !== "visible") {
      this.flushBatches();
      return;
    }
    if (this.docs.size === 0) return;
    if (!this.wsConnected && !this.wsConnecting) this.forceReconnect();
  };

  private handleAuthRefreshed = (): void => {
    this.destroyed = false;
    this.refreshRequired = false;
    if (this.refreshing) return;
    this.authAttempts = 0;
    // Close idle sockets too, so a later attachment cannot reuse another org's connection.
    this.forceReconnect();
  };

  private flushBatches = (): void => {
    for (const entry of this.docs.values()) entry.flushBatch();
  };

  private handleAuthRevoked = (): void => {
    this.destroyed = true;
    if (this.ws) {
      try {
        this.ws.close(WS_CLOSE_NORMAL, "auth revoked");
      } catch {
        // ignored
      }
      this.cleanupSocket();
    }
    for (const entry of this.docs.values()) {
      // Sessions must not read a dropped doc as a clean, connected close.
      entry.options.onStatus?.("token_revoked");
      if (entry.syncDeadline) clearTimeout(entry.syncDeadline);
      if (entry.batchTimer !== null) clearTimeout(entry.batchTimer);
      if (entry.retryTimer !== null) clearTimeout(entry.retryTimer);
      entry.ydoc.off("update", entry.updateHandler);
      entry.ydoc.off("afterAllTransactions", entry.scheduleBatch);
      entry.awareness.off("change", entry.awarenessHandler);
      entry.unlinkRecovery();
    }
    this.docs.clear();
  };
}

export const realtimeMultiplexer = new RealtimeMultiplexer();
