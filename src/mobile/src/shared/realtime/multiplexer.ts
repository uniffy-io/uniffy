// One WebSocket per app multiplexes every attached doc.
// Frame = [VarString docName][y-protocols bytes].
// Public entrypoint: `realtimeMultiplexer.attach()`.

import { AppState } from "react-native";
import type * as Y from "yjs";
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
  WS_CLOSE_NORMAL,
  WS_CLOSE_REAUTH_REQUIRED,
  WS_CLOSE_TOKEN_REVOKED,
  type RealtimeStatus,
} from "@shared/realtime/protocol";

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
const RESYNC_INTERVAL_MS = 30_000;
const IDLE_CLOSE_MS = 30_000;
// y-protocols/awareness GCs peer entries after `outdatedTimeout` (30s);
// without periodic keep-alive, peer presence vanishes on typing pauses.
const AWARENESS_KEEPALIVE_MS = 15_000;

// React Native's WebSocket takes an options object with custom headers; the
// DOM-typed global constructor hides that third argument.
const RNWebSocket = WebSocket as unknown as new (
  url: string,
  protocols?: string | string[] | null,
  options?: { headers?: Record<string, string> },
) => WebSocket;

// The empty Yjs update (no structs, no deletions) encodes to exactly [0, 0].
// The server ignores such updates, and a read-only handle sending ANY
// SyncStep2 frame gets the whole socket closed with 4403, so a no-op reply
// must never leave the device.
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
  organizationId: string;
  ydoc: Y.Doc;
  awareness: Awareness;
  onStatus?: (status: RealtimeStatus) => void;
  onSync?: () => void;
  onCloseCode?: (code: number) => void;
}

export interface DocSubscription {
  readonly docName: string;
  destroy(): void;
}

interface DocEntry {
  docName: string;
  ydoc: Y.Doc;
  awareness: Awareness;
  resolvedSyncOnce: boolean;
  // Read-only handles may not emit SYNC write frames; the server closes the
  // whole socket with 4403 on the first one. SyncStep1 and awareness stay allowed.
  readOnly: boolean;
  // Local edits were dropped while disconnected; only the reconnect handshake
  // (our SyncStep2 reply to the server's SyncStep1) replays them.
  droppedWhileDisconnected: boolean;
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
  private destroyed = false;
  private listenersAttached = false;

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
      docName,
      ydoc: opts.ydoc,
      awareness: opts.awareness,
      resolvedSyncOnce: false,
      readOnly: false,
      droppedWhileDisconnected: false,
      updateHandler: (update, origin) => {
        // Skip echoes of frames we just applied from the wire.
        if (origin === REMOTE_ORIGIN) return;
        // Read-only docs never push state.
        if (entry.readOnly) return;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          entry.droppedWhileDisconnected = true;
          return;
        }
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.writeUpdate(enc, update);
        this.sendForDoc(docName, encoding.toUint8Array(enc));
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          entry.droppedWhileDisconnected = true;
        }
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
    }

    return {
      docName,
      destroy: () => this.detach(docName),
    };
  }

  private detach(docName: string): void {
    const entry = this.docs.get(docName);
    if (!entry) return;
    entry.ydoc.off("update", entry.updateHandler);
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
    if (this.docs.size === 0) this.scheduleIdleClose();
  }

  private openIfNeeded(): void {
    if (this.ws || this.wsConnecting) return;
    if (this.destroyed) return;
    this.wsConnecting = true;
    this.connectNow();
  }

  private connectNow(): void {
    if (this.destroyed) return;
    const orgId = this.organizationId;
    const token = getAccessToken();
    if (!orgId || !token) {
      // No auth context yet (rehydration in flight); retry shortly.
      this.scheduleReconnect();
      return;
    }
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
      this.wsConnecting = false;
      this.wsConnected = true;
      this.reconnectDelayMs = RECONNECT_INITIAL_MS;
      for (const entry of this.docs.values()) {
        entry.resolvedSyncOnce = false;
        this.bootstrapDoc(entry);
      }
      this.emitStatusAll("connected");
      this.startResyncTimer();
      this.startAwarenessKeepaliveTimer();
    };

    ws.onmessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      if (data instanceof ArrayBuffer) {
        this.onFrame(new Uint8Array(data));
      }
    };

    ws.onclose = (event: CloseEvent) => {
      const closingForGood = this.destroyed || event.code === WS_CLOSE_NORMAL;
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
      if (event.code === WS_CLOSE_REAUTH_REQUIRED) {
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
    this.ws = null;
    this.wsConnected = false;
    this.wsConnecting = false;
    this.stopResyncTimer();
    this.stopAwarenessKeepaliveTimer();
    for (const entry of this.docs.values()) {
      // Teardown loses socket-buffered bytes; the reconnect handshake
      // re-derives whatever the server is actually missing.
      entry.droppedWhileDisconnected = true;
    }
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
    const delay = this.reconnectDelayMs;
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
    if (!entry) return;
    const payload = frame.subarray(payloadOffset);
    if (payload.length === 0) return;

    const decoder = decoding.createDecoder(payload);
    const messageType = decoding.readVarUint(decoder);
    if (messageType === MESSAGE_SYNC) {
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
    }
  }

  // Our reply to a server SyncStep1 carries every local update the server
  // lacks, including edits dropped while disconnected.
  private replySyncStep2(entry: DocEntry, replyBytes: Uint8Array): void {
    if (entry.readOnly || isNoopSyncStep2(replyBytes)) {
      entry.droppedWhileDisconnected = false;
      return;
    }
    this.sendForDoc(entry.docName, replyBytes);
    if (this.ws?.readyState === WebSocket.OPEN) {
      entry.droppedWhileDisconnected = false;
    }
  }

  /** VIEWER handles are flagged after attach so no SYNC write frame ever leaves. */
  setDocReadOnly(docName: string, readOnly: boolean): void {
    const entry = this.docs.get(docName);
    if (!entry) return;
    entry.readOnly = readOnly;
    if (readOnly) entry.droppedWhileDisconnected = false;
  }

  private sendForDoc(docName: string, payload: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(encodeDocFrame(docName, payload));
    } catch (err) {
      console.warn("[realtime] send failed; reconnecting", err);
      this.forceReconnect();
    }
  }

  private bootstrapDoc(entry: DocEntry): void {
    this.sendInitialSync(entry);
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
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, entry.ydoc);
    this.sendForDoc(entry.docName, encoding.toUint8Array(enc));
  }

  private emitStatusAll(status: RealtimeStatus): void {
    for (const entry of this.docs.values()) {
      entry.options.onStatus?.(status);
    }
  }

  private ensureListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;
    AppState.addEventListener("change", (state) => {
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
        entry.ydoc.off("update", entry.updateHandler);
        entry.awareness.off("change", entry.awarenessHandler);
      }
      this.docs.clear();
    });
  }
}

export const realtimeMultiplexer = new RealtimeMultiplexer();
