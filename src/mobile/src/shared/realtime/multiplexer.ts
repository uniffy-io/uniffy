// One WebSocket per app multiplexes every attached doc.
// Frame = [VarString docName][y-protocols bytes].
// Public entrypoint: `realtimeMultiplexer.attach()`.

import { AppState } from "react-native";
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
import { getAccessToken } from "@core/auth/auth";
import { refreshSession } from "@core/auth/refresh";
import { onSessionExpired } from "@core/auth/sessionEvents";
import { addOnlineListener } from "@core/api/connectivity";
import { getServerUrl } from "@core/config/serverUrl";
import { encodeDocFrame, peekVarString } from "@shared/realtime/multiplex";
import {
  CANONICAL_SUBPROTOCOL,
  MESSAGE_ACCEPTED_RECEIPT,
  MESSAGE_CHECKPOINT_PROGRESS,
  MESSAGE_COMMITTED,
  MESSAGE_GENERATION,
  MESSAGE_SESSION_STATE,
  MESSAGE_UPDATE,
  UNAVAILABLE_REASON,
  UPDATE_CONFLICT_REASON,
  WS_CLOSE_FORBIDDEN,
  WS_CLOSE_NORMAL,
  WS_CLOSE_REAUTH_REQUIRED,
  WS_CLOSE_UNAUTHENTICATED,
  WS_CLOSE_TOKEN_REVOKED,
  WS_CLOSE_UPGRADE_REQUIRED,
  decodeAcceptedReceipt,
  decodeCheckpointProgress,
  decodeCommitted,
  decodeGeneration,
  decodeSessionState,
  type RealtimeStatus,
} from "@shared/realtime/protocol";
import { UpdateCoverage, type CoverageTransition } from "@shared/realtime/updateCoverage";

// Marks transactions applied from the wire so the update handler does not echo
// them back to the server.
export const REMOTE_ORIGIN = Symbol("realtime-remote");

// y-protocols message-type constants - upstream exposes them only as numeric literals.
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;

const RECONNECT_INITIAL_MS = 500;
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
// without periodic keep-alive, peer presence vanishes on typing pauses.
const AWARENESS_KEEPALIVE_MS = 15_000;

// iOS passes through inactive on the way to the app switcher, which can kill the app without a
// background event, so both states flush.
function isLeaving(state: string | null): boolean {
  return state === "inactive" || state === "background";
}

// React Native's WebSocket takes an options object with custom headers; the
// DOM-typed global constructor hides that third argument.
const RNWebSocket = WebSocket as unknown as new (
  url: string,
  protocols?: string | string[] | null,
  options?: { headers?: Record<string, string> },
) => WebSocket;

// Empty updates carry no content or deletions and need no acknowledgment.
function isNoopSyncStep2(reply: Uint8Array): boolean {
  const dec = decoding.createDecoder(reply);
  if (decoding.readVarUint(dec) !== MESSAGE_SYNC) return false;
  if (decoding.readVarUint(dec) !== syncProtocol.messageYjsSyncStep2) return false;
  const update = decoding.readVarUint8Array(dec);
  return update.length === 2 && update[0] === 0 && update[1] === 0;
}

/** Save progress of one document's own edits. Replaced, never mutated, on change. */
export interface RealtimeDocState {
  /** Some own edit is buffered, unsent or lacks a server receipt. */
  readonly transportPending: boolean;
  /** Some own edit is not in a PostgreSQL checkpoint, so local drafts stay dirty. */
  readonly checkpointPending: boolean;
  /** Epoch milliseconds of the oldest own edit no checkpoint covers. */
  readonly oldestUncheckpointedAt: number | null;
  /** Last generation the server announced for this document. */
  readonly generation: string | null;
  /** The server refused an own edit it may take later; edits stay local and resend on their own. */
  readonly savingUnavailable: boolean;
  /** This socket's session state has arrived and local recovery has handed back every own edit
   * the device holds. Until then nothing proves the document synced or saved, because a
   * checkpoint can land while no socket is open. */
  readonly coverageKnown: boolean;
}

const DETACHED_DOC_STATE: RealtimeDocState = Object.freeze({
  transportPending: false,
  checkpointPending: false,
  oldestUncheckpointedAt: null,
  generation: null,
  savingUnavailable: false,
  coverageKnown: false,
});

function sameState(a: RealtimeDocState, b: RealtimeDocState): boolean {
  return (Object.keys(a) as (keyof RealtimeDocState)[]).every((key) => a[key] === b[key]);
}

/** One own update changed coverage, with the raw bytes retained until it is checkpointed. */
export type UpdateCoverageEvent = CoverageTransition & { readonly update: Uint8Array };

/** An uncheckpointed update kept by local recovery, handed back after a restart. */
export interface RetainedUpdate {
  readonly updateId: string;
  readonly update: Uint8Array;
  readonly editedAt: number;
}

export interface MultiplexerAttachOptions {
  contentType: string;
  contentId: string;
  organizationId: string;
  ydoc: Y.Doc;
  awareness: Awareness;
  onStatus?: (status: RealtimeStatus) => void;
  onSync?: () => void;
  onGenerationMismatch?: () => void;
  onCloseCode?: (code: number) => void;
  onWriteDenied?: (reason: string, noView?: boolean) => void;
  /** Fires with every batch of coverage transitions, before the doc state changes. */
  onCoverage?: (events: readonly UpdateCoverageEvent[]) => void;
}

export interface DocSubscription {
  readonly docName: string;
  destroy(): void;
}

interface DocEntry {
  localBatch: Uint8Array[];
  localBatchBytes: number;
  batchBoundary: number;
  batchStartedAt: number;
  batchTimer: ReturnType<typeof setTimeout> | null;
  scheduleBatch: () => void;
  flushBatch: () => void;
  rejected: boolean;
  syncDeadline: ReturnType<typeof setTimeout> | null;
  docName: string;
  ydoc: Y.Doc;
  awareness: Awareness;
  resolvedSyncOnce: boolean;
  // Read-only documents retain local drafts but suppress write frames.
  readOnly: boolean;
  requestedReadOnly: boolean;
  denied: boolean;
  generation: string | null;
  // Epoch of the latest session state on this socket, null until the first.
  socketEpoch: string | null;
  // The epoch changed under remote updates this doc may hold, so the server's next SyncStep1 is
  // answered with full state.
  owesState: boolean;
  updateCounter: number;
  // Survives reconnects, unlike `generation`, which gates writes until message 5 repeats.
  serverGeneration: string | null;
  coverage: UpdateCoverage;
  // Raw bytes of every own update until a checkpoint covers it, delete-only updates included.
  retained: Map<string, Uint8Array>;
  // Local recovery has handed back what the device holds for the server's generation.
  recoveryRead: boolean;
  // Write ids sent on this socket, oldest first. The server answers them in order, so a denial
  // without an id belongs to the head.
  awaiting: string[];
  // Ids the server holds different bytes for. They stay local and are never sent again.
  conflicted: Set<string>;
  savingUnavailable: boolean;
  retryTimer: ReturnType<typeof setTimeout> | null;
  retryDelayMs: number;
  state: RealtimeDocState;
  updateHandler: (update: Uint8Array, origin: unknown) => void;
  awarenessHandler: (
    changes: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => void;
  options: MultiplexerAttachOptions;
}

class RealtimeMultiplexer {
  private ws: WebSocket | null = null;
  private wsConnected = false;
  private wsConnecting = false;
  private docs = new Map<string, DocEntry>();
  private organizationId: string | null = null;
  private reconnectDelayMs = RECONNECT_INITIAL_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private resyncTimer: ReturnType<typeof setInterval> | null = null;
  private idleCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private awarenessKeepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private stateListeners = new Map<string, Set<(state: RealtimeDocState) => void>>();
  private destroyed = false;
  // Set by close 4426 and kept until the app runs a build that speaks the server's protocol.
  private upgradeRequired = false;
  // The access token close 4403 refused. The server refuses it the same way on every reconnect,
  // so the transport waits for a refresh, a sign-in or a workspace switch to replace it.
  private forbiddenToken: string | null = null;
  private listenersAttached = false;
  private backgrounded = isLeaving(AppState.currentState);

  attach(opts: MultiplexerAttachOptions): DocSubscription {
    const docName = `${opts.contentType}:${opts.contentId}`;
    if (this.docs.has(docName)) {
      // The original subscription owns the Y.Doc lifecycle; aliasing breaks teardown.
      throw new Error(`realtime: ${docName} already attached`);
    }

    this.ensureListeners();
    // A session that ended with a token revoke stays torn down only until the
    // next login attaches with a live org context.
    this.destroyed = false;
    this.organizationId = opts.organizationId;

    const entry: DocEntry = {
      localBatch: [],
      localBatchBytes: 0,
      batchBoundary: 0,
      batchStartedAt: 0,
      batchTimer: null,
      scheduleBatch: () => {
        if (!entry.localBatch.length || entry.rejected || entry.denied) return;
        if (entry.localBatchBytes > MAX_UPDATE_BYTES && entry.batchBoundary > 0) {
          // Separate prior edits without splitting this transaction's mirror updates.
          const transaction = entry.localBatch.splice(entry.batchBoundary);
          entry.flushBatch();
          entry.localBatch = transaction;
          entry.localBatchBytes = transaction.reduce((sum, update) => sum + update.length, 0);
          entry.batchStartedAt = Date.now();
        }
        if (entry.localBatchBytes >= UPDATE_BATCH_BYTES || this.backgrounded) {
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
        const updates = entry.localBatch;
        entry.localBatch = [];
        entry.localBatchBytes = 0;
        entry.batchBoundary = 0;
        this.queueUpdate(entry, Y.mergeUpdates(updates), entry.batchStartedAt);
        this.publishState(entry);
      },
      rejected: false,
      syncDeadline: null,
      docName,
      ydoc: opts.ydoc,
      awareness: opts.awareness,
      resolvedSyncOnce: false,
      readOnly: false,
      requestedReadOnly: false,
      denied: false,
      generation: null,
      socketEpoch: null,
      owesState: false,
      updateCounter: 0,
      serverGeneration: null,
      coverage: new UpdateCoverage(),
      retained: new Map(),
      recoveryRead: false,
      awaiting: [],
      conflicted: new Set(),
      savingUnavailable: false,
      retryTimer: null,
      retryDelayMs: UNAVAILABLE_RETRY_MS,
      state: DETACHED_DOC_STATE,
      updateHandler: (update, origin) => {
        // Skip echoes of frames we just applied from the wire.
        if (origin === REMOTE_ORIGIN) return;
        if (entry.rejected || entry.denied) {
          this.queueUpdate(entry, update, Date.now());
          this.publishState(entry);
          return;
        }
        // Read-only docs never push state.
        if (!entry.localBatch.length) entry.batchStartedAt = Date.now();
        entry.localBatch.push(update);
        entry.localBatchBytes += update.length;
        this.publishState(entry);
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
    this.cancelIdleClose();
    this.openIfNeeded();

    if (this.wsConnected) {
      // WS was already open before this attach; push status + SyncStep1
      // synchronously so the new subscription does not stall on `'idle'`.
      opts.onStatus?.("connected");
      this.bootstrapDoc(entry);
    } else if (this.wsConnecting) {
      // Late attach mid-handshake; surface the in-flight state immediately.
      opts.onStatus?.("connecting");
    } else if (this.connectionForbidden()) {
      opts.onStatus?.("access_lost");
    } else if (this.upgradeRequired) {
      opts.onStatus?.("upgrade_required");
    }

    return {
      docName,
      destroy: () => this.detach(docName),
    };
  }

  private detach(docName: string): void {
    const entry = this.docs.get(docName);
    if (!entry) return;
    entry.flushBatch();
    if (entry.syncDeadline) clearTimeout(entry.syncDeadline);
    if (entry.retryTimer !== null) clearTimeout(entry.retryTimer);
    entry.ydoc.off("update", entry.updateHandler);
    entry.ydoc.off("afterAllTransactions", entry.scheduleBatch);
    entry.awareness.off("change", entry.awarenessHandler);
    // Announce departure so peers drop our presence now, rather than waiting
    // for y-protocols' 30s outdatedTimeout GC. The change handler is already
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
    this.docs.delete(docName);
    this.notifyState(docName, DETACHED_DOC_STATE);
    if (this.docs.size === 0) this.scheduleIdleClose();
  }

  private openIfNeeded(): void {
    if (this.ws || this.wsConnecting) return;
    if (this.destroyed || this.upgradeRequired || this.connectionForbidden()) return;
    this.wsConnecting = true;
    this.connectNow();
  }

  private connectionForbidden(): boolean {
    return this.forbiddenToken !== null && this.forbiddenToken === getAccessToken();
  }

  private connectNow(): void {
    if (this.destroyed || this.upgradeRequired || this.connectionForbidden()) return;
    const orgId = this.organizationId;
    const token = getAccessToken();
    if (!orgId || !token) {
      // No auth context yet (rehydration in flight); retry shortly.
      this.scheduleReconnect();
      return;
    }
    this.wsConnecting = true;
    const url = `${getServerUrl().replace(/^http/, "ws")}/api/realtime?org_id=${encodeURIComponent(orgId)}`;

    let ws: WebSocket;
    try {
      // The bearer rides the Authorization header (server: extract_bearer_from_auth_header);
      // the subprotocol carries only the canonical protocol name.
      ws = new RNWebSocket(url, [CANONICAL_SUBPROTOCOL], {
        headers: { Authorization: `Bearer ${token}` },
      });
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
        entry.readOnly = entry.requestedReadOnly;
        this.bootstrapDoc(entry);
      }
      this.emitStatusAll("connected");
      this.startResyncTimer();
      this.startAwarenessKeepaliveTimer();
    };

    ws.onmessage = (event: MessageEvent) => {
      if (this.ws !== ws) return;
      const data: unknown = event.data;
      if (!(data instanceof ArrayBuffer)) return;
      try {
        this.onFrame(new Uint8Array(data));
      } catch (err) {
        // A malformed frame changes nothing; the next resync repairs any missed state.
        console.warn("[realtime] dropped malformed frame", err);
      }
    };

    ws.onclose = (event: CloseEvent) => {
      if (this.ws !== ws) return;
      const closingForGood = this.destroyed;
      this.cleanupSocket();
      for (const entry of this.docs.values()) {
        entry.options.onCloseCode?.(event.code);
      }
      if (closingForGood) return;
      if (event.code === WS_CLOSE_TOKEN_REVOKED) {
        // Server-side logout-all-devices; the next RPC's auth rejection drops
        // the app back to login. Do not reconnect.
        return;
      }
      if (event.code === WS_CLOSE_UPGRADE_REQUIRED) {
        // Every reconnect would be refused the same way; edits stay local until an update.
        this.upgradeRequired = true;
        this.emitStatusAll("upgrade_required");
        return;
      }
      if (event.code === WS_CLOSE_FORBIDDEN) {
        this.forbiddenToken = token;
        this.emitStatusAll("access_lost");
        return;
      }
      if (event.code === WS_CLOSE_REAUTH_REQUIRED || event.code === WS_CLOSE_UNAUTHENTICATED) {
        // The socket hit its token's lifetime. Reconnecting with the same
        // memory token would be refused, so refresh first.
        this.reconnectAfterRefresh();
        return;
      }
      this.emitStatusAll("disconnected");
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
      entry.socketEpoch = null;
      this.publishState(entry);
    }
    this.ws = null;
    this.wsConnected = false;
    this.wsConnecting = false;
    this.stopResyncTimer();
    this.stopAwarenessKeepaliveTimer();
  }

  private reconnectAfterRefresh(): void {
    if (this.destroyed || this.docs.size === 0) return;
    this.emitStatusAll("connecting");
    refreshSession()
      .catch(() => null)
      .finally(() => {
        if (this.destroyed || this.docs.size === 0) return;
        // A failed refresh falls through to normal backoff: the auth
        // interceptor retries on the next RPC and a later reconnect picks up
        // the fresh memory token.
        this.reconnectDelayMs = RECONNECT_INITIAL_MS;
        this.connectNow();
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

  private forceReconnect(): void {
    // Drop the current socket and reopen immediately, bypassing backoff.
    // Used by connectivity-regained / app-foreground triggers.
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
      // Rebroadcast local awareness so peers' `outdatedTimeout` resets and our
      // presence stays on their screen.
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
    const payload = frame.subarray(payloadOffset);
    if (payload.length === 0) return;

    const decoder = decoding.createDecoder(payload);
    const messageType = decoding.readVarUint(decoder);
    if (messageType === MESSAGE_GENERATION) {
      const generation = decodeGeneration(payload);
      const local = entry.ydoc.getMap("doc_meta").get("generation");
      if (typeof local === "string" && local !== generation) {
        entry.denied = true;
        entry.options.onGenerationMismatch?.();
        return;
      }
      const reconnecting = entry.generation === null;
      entry.generation = generation;
      entry.serverGeneration = generation;
      // Accepted updates wait for session state to prove or refute their presence.
      if (reconnecting)
        for (const id of entry.coverage.localIds())
          this.sendUpdate(entry, id, entry.retained.get(id)!);
      this.publishState(entry);
    } else if (messageType === MESSAGE_COMMITTED) {
      const id = decodeCommitted(payload);
      this.resumeSaving(entry, id);
      this.applyCoverage(entry, entry.coverage.applyCommitted(id));
    } else if (messageType === MESSAGE_ACCEPTED_RECEIPT) {
      const receipt = decodeAcceptedReceipt(payload);
      this.resumeSaving(entry, receipt.updateId);
      this.applyCoverage(entry, entry.coverage.applyReceipt(receipt));
    } else if (messageType === MESSAGE_CHECKPOINT_PROGRESS) {
      this.applyCoverage(entry, entry.coverage.applyProgress(decodeCheckpointProgress(payload)));
    } else if (messageType === MESSAGE_SESSION_STATE) {
      const state = decodeSessionState(payload);
      // Message 5 owns generation changes; state for another generation proves nothing here.
      if (state.generation !== entry.generation) return;
      // The server reads a write sent on this socket only after the socket's first session state.
      // A later epoch change can still answer earlier writes with receipts of the retired epoch,
      // which coverage ignores, so those go out again; the server deduplicates by id.
      const inFlight =
        entry.socketEpoch !== null && entry.socketEpoch !== state.epoch
          ? entry.coverage.localIds()
          : [];
      if (entry.coverage.epoch !== null && entry.coverage.epoch !== state.epoch)
        entry.owesState = true;
      entry.socketEpoch = state.epoch;
      this.applyCoverage(entry, entry.coverage.applySessionState(state));
      for (const id of inFlight) this.sendUpdate(entry, id, entry.retained.get(id)!);
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
        // Marks server-applied updates so the update handler skips re-sending them.
        REMOTE_ORIGIN,
      );
      const replyBytes = encoding.toUint8Array(replyEncoder);
      if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
        this.answerSyncStep1(entry, replyBytes);
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
    } else if (messageType === 2) {
      const scope = decoding.readVarUint(decoder);
      if (scope !== 0 && scope !== 1) return;
      const reason = decoding.readVarString(decoder);
      if (reason === UNAVAILABLE_REASON) {
        this.refuseUnavailable(entry);
        return;
      }
      if (reason === UPDATE_CONFLICT_REASON) {
        this.rejectConflict(entry);
        return;
      }
      entry.denied = scope === 1;
      entry.readOnly = true;
      if (reason.includes("too large")) {
        this.rejectOversized(entry);
        return;
      }
      entry.options.onWriteDenied?.(reason, scope === 1);
    }
  }

  // The server asks for state on attach and after a buffer reset. Own updates reach it under their
  // ids through coverage, and a Yjs reply always repeats the whole delete set, so only a reset,
  // which can lose remote updates this doc holds, gets the full reply. Otherwise the answer is
  // the unsent local batch.
  private answerSyncStep1(entry: DocEntry, replyBytes: Uint8Array): void {
    const owed = entry.owesState;
    entry.owesState = false;
    if (!owed || entry.readOnly || isNoopSyncStep2(replyBytes)) {
      entry.flushBatch();
      return;
    }
    const decoder = decoding.createDecoder(replyBytes);
    decoding.readVarUint(decoder);
    decoding.readVarUint(decoder);
    // The handshake includes buffered local edits. Cancel their separate send.
    const update = decoding.readVarUint8Array(decoder);
    if (entry.batchTimer !== null) clearTimeout(entry.batchTimer);
    entry.batchTimer = null;
    const updates = entry.localBatch;
    const editedAt = updates.length ? entry.batchStartedAt : Date.now();
    entry.localBatch = [];
    entry.localBatchBytes = 0;
    entry.batchBoundary = 0;
    this.queueUpdate(entry, Y.mergeUpdates([...updates, update]), editedAt);
    this.publishState(entry);
  }

  // A receipt or commit answers its write and shows the server takes writes again.
  private resumeSaving(entry: DocEntry, id: string): void {
    const index = entry.awaiting.indexOf(id);
    if (index >= 0) entry.awaiting.splice(index, 1);
    entry.savingUnavailable = false;
    entry.retryDelayMs = UNAVAILABLE_RETRY_MS;
  }

  // Every local update stays local. A timer resends them, and every reconnect does too.
  private refuseUnavailable(entry: DocEntry): void {
    entry.awaiting.shift();
    entry.savingUnavailable = true;
    this.publishState(entry);
    if (entry.retryTimer !== null) return;
    entry.retryTimer = setTimeout(() => {
      entry.retryTimer = null;
      for (const id of entry.coverage.localIds())
        if (!entry.awaiting.includes(id)) this.sendUpdate(entry, id, entry.retained.get(id)!);
    }, entry.retryDelayMs);
    entry.retryDelayMs = Math.min(entry.retryDelayMs * RECONNECT_MULTIPLIER, RECONNECT_MAX_MS);
  }

  // Only the refused update stops. It stays local and in recovery while the others keep syncing.
  private rejectConflict(entry: DocEntry): void {
    const id = entry.awaiting.shift();
    if (id === undefined) return;
    entry.conflicted.add(id);
    if (entry.conflicted.size === 1) entry.options.onStatus?.("update_rejected");
  }

  isAttached(docName: string): boolean {
    return this.docs.has(docName);
  }

  /** Sends every buffered edit now. Returns the editable docs with an own edit no checkpoint
   * covers yet. */
  flushPending(): string[] {
    const waiting: string[] = [];
    for (const entry of this.docs.values()) {
      entry.flushBatch();
      if (entry.state.checkpointPending && !entry.readOnly && !entry.denied && !entry.rejected)
        waiting.push(entry.docName);
    }
    return waiting;
  }

  /** Stable snapshot for `useSyncExternalStore`; a detached doc reports nothing pending. */
  getDocState(docName: string): RealtimeDocState {
    return this.docs.get(docName)?.state ?? DETACHED_DOC_STATE;
  }

  /** Listens by name, so a subscription made before attach sees the attached session. */
  subscribeDocState(docName: string, listener: (state: RealtimeDocState) => void): () => void {
    let listeners = this.stateListeners.get(docName);
    if (!listeners) {
      listeners = new Set();
      this.stateListeners.set(docName, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.stateListeners.delete(docName);
    };
  }

  /**
   * Re-sends updates an earlier session left uncheckpointed, under their original ids so the
   * server can deduplicate them. Only the generation the server confirmed for this connection
   * replays; other lineages stay explicit recovery. An empty restore still reports that local
   * recovery has read this device.
   */
  restorePending(docName: string, generation: string, updates: readonly RetainedUpdate[]): boolean {
    const entry = this.docs.get(docName);
    if (!entry || entry.readOnly || entry.denied || entry.generation !== generation) return false;
    entry.recoveryRead = true;
    for (const { updateId, update, editedAt } of updates) {
      if (entry.retained.has(updateId)) continue;
      Y.applyUpdate(entry.ydoc, update, REMOTE_ORIGIN);
      this.queueUpdate(entry, update, editedAt, updateId);
    }
    this.publishState(entry);
    return true;
  }

  private publishState(entry: DocEntry): void {
    const coverage = entry.coverage.summary();
    const buffered = entry.localBatch.length > 0;
    const transportPending = entry.rejected || buffered || coverage.transportPending;
    const tracked = coverage.oldestUncheckpointedAt;
    const state: RealtimeDocState = Object.freeze({
      transportPending,
      checkpointPending: transportPending || coverage.checkpointPending,
      oldestUncheckpointedAt:
        buffered && (tracked === null || entry.batchStartedAt < tracked)
          ? entry.batchStartedAt
          : tracked,
      generation: entry.serverGeneration,
      savingUnavailable: entry.savingUnavailable,
      coverageKnown: entry.socketEpoch !== null && entry.recoveryRead,
    });
    if (sameState(entry.state, state)) return;
    entry.state = state;
    this.notifyState(entry.docName, state);
  }

  private notifyState(docName: string, state: RealtimeDocState): void {
    for (const listener of this.stateListeners.get(docName) ?? []) listener(state);
  }

  // Every update that becomes local is sent: new edits, replays and accepted updates whose
  // presence the server can no longer prove. Replays keep the original id.
  private applyCoverage(entry: DocEntry, transitions: CoverageTransition[]): void {
    const events = transitions.map((transition) => {
      const update = entry.retained.get(transition.updateId)!;
      if (transition.coverage === "checkpointed") entry.retained.delete(transition.updateId);
      return { ...transition, update };
    });
    if (events.length) entry.options.onCoverage?.(events);
    for (const event of events)
      if (event.coverage === "local") this.sendUpdate(entry, event.updateId, event.update);
    this.publishState(entry);
  }

  private rejectOversized(entry: DocEntry): void {
    if (entry.rejected) return;
    entry.rejected = true;
    entry.readOnly = true;
    entry.options.onWriteDenied?.("update too large", false);
    entry.options.onStatus?.("update_rejected");
    this.publishState(entry);
  }

  private queueUpdate(
    entry: DocEntry,
    update: Uint8Array,
    editedAt: number,
    updateId?: string,
  ): void {
    if (entry.rejected) return;
    let localBytes = update.length;
    for (const id of entry.coverage.localIds()) localBytes += entry.retained.get(id)!.length;
    if (update.length > MAX_UPDATE_BYTES || localBytes > MAX_LOCAL_BYTES) {
      this.rejectOversized(entry);
      return;
    }
    const id = updateId ?? entry.ydoc.guid + ":" + ++entry.updateCounter;
    entry.retained.set(id, update);
    this.applyCoverage(entry, entry.coverage.add(id, editedAt));
  }

  private sendUpdate(entry: DocEntry, id: string, update: Uint8Array): void {
    if (entry.generation === null || entry.readOnly || entry.rejected || entry.conflicted.has(id))
      return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_UPDATE);
    encoding.writeVarString(encoder, entry.generation);
    encoding.writeVarString(encoder, id);
    encoding.writeVarUint8Array(encoder, update);
    if (this.sendForDoc(entry.docName, encoding.toUint8Array(encoder))) entry.awaiting.push(id);
  }

  setDocReadOnly(docName: string, readOnly: boolean): void {
    const entry = this.docs.get(docName);
    if (!entry) return;
    entry.readOnly = readOnly;
    entry.requestedReadOnly = readOnly;
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
    this.sendInitialSync(entry);
    // A headless session, such as a drain, has no presence to show or to watch.
    if (entry.awareness.getLocalState() === null) return;
    // Push our awareness so peers see us immediately...
    this.sendLocalAwareness(entry);
    // ...and ask peers to re-announce theirs. The backend keeps no awareness
    // map, so without this an idle peer's presence stays hidden until their
    // next keep-alive. Peers reply via their MESSAGE_QUERY_AWARENESS handler.
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
          : entry.denied || this.connectionForbidden()
            ? "access_lost"
            : this.upgradeRequired
              ? "upgrade_required"
              : status,
      );
    }
  }

  private ensureListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;
    AppState.addEventListener("change", (state) => {
      this.backgrounded = isLeaving(state);
      // Transport only: buffered edits go out now, and nothing asks the server to save sooner.
      if (this.backgrounded) this.flushPending();
      if (state === "background") {
        // A pocketed device must not keep the radio busy with resync probes
        // and awareness keep-alives; the socket may stay open, but periodic
        // traffic stops until the app is foregrounded again.
        this.stopResyncTimer();
        this.stopAwarenessKeepaliveTimer();
        return;
      }
      if (state !== "active") return;
      if (this.docs.size === 0) return;
      if (!this.wsConnected && !this.wsConnecting) {
        this.forceReconnect();
      } else if (this.wsConnected) {
        this.startResyncTimer();
        this.startAwarenessKeepaliveTimer();
        // Catch up in one round: peers GC'd our awareness while suspended,
        // and the doc may have moved without us.
        for (const entry of this.docs.values()) {
          this.sendInitialSync(entry);
          this.sendLocalAwareness(entry);
        }
      }
    });
    addOnlineListener((online) => {
      if (online) {
        if (this.docs.size > 0 && !this.wsConnected && !this.wsConnecting) {
          this.forceReconnect();
        }
        return;
      }
      this.emitStatusAll("offline");
      if (this.ws) {
        try {
          this.ws.close();
        } catch {
          // ignored
        }
        this.cleanupSocket();
      }
    });
    onSessionExpired(() => {
      this.destroyed = true;
      if (this.ws) {
        try {
          this.ws.close(WS_CLOSE_NORMAL, "session expired");
        } catch {
          // ignored
        }
        this.cleanupSocket();
      }
      for (const entry of this.docs.values()) {
        if (entry.syncDeadline) clearTimeout(entry.syncDeadline);
        if (entry.batchTimer !== null) clearTimeout(entry.batchTimer);
        if (entry.retryTimer !== null) clearTimeout(entry.retryTimer);
        entry.ydoc.off("update", entry.updateHandler);
        entry.ydoc.off("afterAllTransactions", entry.scheduleBatch);
        entry.awareness.off("change", entry.awarenessHandler);
      }
      this.docs.clear();
    });
  }
}

export const realtimeMultiplexer = new RealtimeMultiplexer();
