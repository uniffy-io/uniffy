// One WebSocket per browser tab multiplexes every attached doc.
// Frame = [VarString docName][y-protocols bytes].
// Public entrypoint: `realtimeMultiplexer.attach()`.

import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import {
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { getAccessToken } from '@/config/api';
import { encodeDocFrame, peekVarString } from '@/features/realtime/multiplex';
import { REMOTE_ORIGIN } from '@/features/realtime/persistence/encryptedYjsPersistence';
import {
  CANONICAL_SUBPROTOCOL,
  WS_CLOSE_FORBIDDEN,
  WS_CLOSE_NORMAL,
  WS_CLOSE_TOKEN_REVOKED,
  type RealtimeStatus,
} from '@/features/realtime/protocol';

// y-protocols message-type constants - upstream exposes them only as numeric literals.
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_QUERY_AWARENESS = 3;

const AUTH_REFRESHED_EVENT = 'uniffy:auth:refreshed';
const AUTH_REVOKED_EVENT = 'uniffy:auth:revoked';

const RECONNECT_INITIAL_MS = 500;
const RECONNECT_MAX_MS = 15_000;
const RECONNECT_MULTIPLIER = 1.5;
const RESYNC_INTERVAL_MS = 30_000;
const IDLE_CLOSE_MS = 30_000;
// y-protocols/awareness GCs peer entries after `outdatedTimeout` (30s);
// without periodic keep-alive, peer cursors vanish on typing pauses.
const AWARENESS_KEEPALIVE_MS = 15_000;
// `WebSocket.bufferedAmount` has no drain event, so flushed state is polled.
const OUTBOUND_DRAIN_POLL_MS = 250;

// The empty Yjs update (no structs, no deletions) encodes to exactly [0, 0].
// The server ignores such updates, and a read-only handle sending ANY
// SyncStep2 frame gets the whole socket closed with 4403, so a no-op reply
// must never leave the tab.
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
  // Local edits exist that have not been handed to the socket yet.
  pendingLocalFrames: boolean;
  // Pending edits were dropped while disconnected; only the reconnect
  // handshake (our SyncStep2 reply to the server's SyncStep1) replays them.
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
  private reconnectDelayMs = RECONNECT_INITIAL_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private resyncTimer: ReturnType<typeof setInterval> | null = null;
  private idleCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private awarenessKeepaliveTimer: ReturnType<typeof setInterval> | null = null;
  private outboundDrainTimer: ReturnType<typeof setInterval> | null = null;
  private outboundListeners = new Map<string, Set<(pending: boolean) => void>>();
  private destroyed = false;
  private listenersAttached = false;

  attach(opts: MultiplexerAttachOptions): DocSubscription {
    const docName = `${opts.contentType}:${opts.contentId}`;
    if (this.docs.has(docName)) {
      // The original subscription owns the Y.Doc lifecycle; aliasing breaks teardown.
      throw new Error(`realtime: ${docName} already attached on this tab`);
    }

    this.ensureListeners();

    const entry: DocEntry = {
      docName,
      ydoc: opts.ydoc,
      awareness: opts.awareness,
      resolvedSyncOnce: false,
      readOnly: false,
      pendingLocalFrames: false,
      droppedWhileDisconnected: false,
      updateHandler: (update, origin) => {
        // Skip echoes of frames we just applied from the wire.
        if (origin === REMOTE_ORIGIN) return;
        // Read-only docs never push state. IDB hydration replays of
        // server-known content would otherwise leave as write frames.
        if (entry.readOnly) return;
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          this.markOutboundDropped(entry);
          return;
        }
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.writeUpdate(enc, update);
        this.sendForDoc(docName, encoding.toUint8Array(enc));
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
          this.markOutboundDropped(entry);
          return;
        }
        if (!entry.droppedWhileDisconnected) this.noteLocalFramesHandedToSocket(entry);
      },
      awarenessHandler: (changes, origin) => {
        if (origin === 'remote') return;
        const changed = changes.added.concat(changes.updated, changes.removed);
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(enc, encodeAwarenessUpdate(opts.awareness, changed));
        this.sendForDoc(docName, encoding.toUint8Array(enc));
      },
      options: opts,
    };

    opts.ydoc.on('update', entry.updateHandler);
    opts.awareness.on('change', entry.awarenessHandler);
    this.docs.set(docName, entry);
    this.cancelIdleClose();
    this.openIfNeeded(opts.contentType, opts.contentId);

    if (this.wsConnected) {
      // WS was already open before this attach; push status + SyncStep1
      // synchronously so the new subscription does not stall on `'idle'`.
      opts.onStatus?.('connected');
      this.bootstrapDoc(entry);
    } else if (this.wsConnecting) {
      // Late attach mid-handshake; surface the in-flight state immediately.
      opts.onStatus?.('connecting');
    }

    return {
      docName,
      destroy: () => this.detach(docName),
    };
  }

  private detach(docName: string): void {
    const entry = this.docs.get(docName);
    if (!entry) return;
    entry.ydoc.off('update', entry.updateHandler);
    entry.awareness.off('change', entry.awarenessHandler);
    // Announce departure so peers drop our cursor now, rather than waiting for
    // y-protocols' 30s outdatedTimeout GC. The change handler is already
    // detached, so this manual frame is the only removal that goes out.
    if (
      this.ws?.readyState === WebSocket.OPEN
      && entry.awareness.getLocalState() !== null
    ) {
      removeAwarenessStates(entry.awareness, [entry.awareness.clientID], 'local-detach');
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

  private openIfNeeded(contentTypeHint: string, contentIdHint: string): void {
    if (this.ws || this.wsConnecting) return;
    if (this.destroyed) return;
    void contentTypeHint;
    void contentIdHint;
    this.wsConnecting = true;
    this.connectNow();
  }

  private connectNow(): void {
    if (this.destroyed) return;
    const orgId = this.resolveOrgId();
    if (!orgId) {
      // No org context yet (rehydration in flight); retry shortly.
      this.scheduleReconnect();
      return;
    }
    const url = this.buildUrl(orgId);
    const token = getAccessToken() ?? '';
    const protocols = [CANONICAL_SUBPROTOCOL, `bearer.${encodeURIComponent(token)}`];

    let ws: WebSocket;
    try {
      ws = new WebSocket(url, protocols);
    } catch (err) {
      console.warn('[realtime] WebSocket constructor failed', err);
      this.wsConnecting = false;
      this.scheduleReconnect();
      return;
    }
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    this.emitStatusAll('connecting');

    ws.onopen = () => {
      this.wsConnecting = false;
      this.wsConnected = true;
      this.reconnectDelayMs = RECONNECT_INITIAL_MS;
      for (const entry of this.docs.values()) {
        entry.resolvedSyncOnce = false;
        this.bootstrapDoc(entry);
      }
      this.emitStatusAll('connected');
      this.startResyncTimer();
      this.startAwarenessKeepaliveTimer();
    };

    ws.onmessage = (event: MessageEvent<ArrayBuffer | Blob | string>) => {
      const data = event.data;
      if (data instanceof ArrayBuffer) {
        this.onFrame(new Uint8Array(data));
        return;
      }
      if (typeof data !== 'string' && 'arrayBuffer' in data) {
        void data.arrayBuffer().then((buf) => this.onFrame(new Uint8Array(buf)));
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
        // Server-side logout-all-devices; let the app shell redirect.
        return;
      }
      if (event.code === WS_CLOSE_FORBIDDEN) {
        // Auth/permission lost; surface as disconnected but still try to
        // reconnect (the user may regain access via an org switch).
        this.emitStatusAll('disconnected');
      } else {
        this.emitStatusAll('disconnected');
      }
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
    this.stopOutboundDrainPoll();
    for (const entry of this.docs.values()) {
      // Teardown loses socket-buffered bytes; the reconnect handshake
      // re-derives whatever the server is actually missing.
      if (entry.pendingLocalFrames) entry.droppedWhileDisconnected = true;
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectTimer) return;
    if (this.docs.size === 0) return;
    const delay = this.reconnectDelayMs;
    this.reconnectDelayMs = Math.min(this.reconnectDelayMs * RECONNECT_MULTIPLIER, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectNow();
    }, delay);
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
          this.ws.close(WS_CLOSE_NORMAL, 'idle');
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
      console.warn('[realtime] malformed multiplex prefix', err);
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
      applyAwarenessUpdate(entry.awareness, decoding.readVarUint8Array(decoder), 'remote');
    } else if (messageType === MESSAGE_QUERY_AWARENESS) {
      this.sendLocalAwareness(entry);
    }
  }

  // Our reply to a server SyncStep1 carries every local update the server
  // lacks, including edits dropped while disconnected.
  private replySyncStep2(entry: DocEntry, replyBytes: Uint8Array): void {
    if (entry.readOnly || isNoopSyncStep2(replyBytes)) {
      entry.droppedWhileDisconnected = false;
      this.setOutboundPending(entry, false);
      return;
    }
    this.sendForDoc(entry.docName, replyBytes);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.markOutboundDropped(entry);
      return;
    }
    entry.droppedWhileDisconnected = false;
    this.noteLocalFramesHandedToSocket(entry);
  }

  private markOutboundDropped(entry: DocEntry): void {
    entry.droppedWhileDisconnected = true;
    this.setOutboundPending(entry, true);
  }

  private noteLocalFramesHandedToSocket(entry: DocEntry): void {
    if (!this.ws || this.ws.bufferedAmount === 0) {
      this.setOutboundPending(entry, false);
      return;
    }
    this.setOutboundPending(entry, true);
    this.startOutboundDrainPoll();
  }

  private setOutboundPending(entry: DocEntry, pending: boolean): void {
    if (entry.pendingLocalFrames === pending) return;
    entry.pendingLocalFrames = pending;
    const listeners = this.outboundListeners.get(entry.docName);
    if (!listeners) return;
    for (const listener of listeners) listener(pending);
  }

  private startOutboundDrainPoll(): void {
    if (this.outboundDrainTimer) return;
    this.outboundDrainTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.stopOutboundDrainPoll();
        return;
      }
      if (this.ws.bufferedAmount > 0) return;
      for (const entry of this.docs.values()) {
        if (entry.pendingLocalFrames && !entry.droppedWhileDisconnected) {
          this.setOutboundPending(entry, false);
        }
      }
      // Docs still pending are dropped ones; the handshake clears those.
      this.stopOutboundDrainPoll();
    }, OUTBOUND_DRAIN_POLL_MS);
  }

  private stopOutboundDrainPoll(): void {
    if (this.outboundDrainTimer) {
      clearInterval(this.outboundDrainTimer);
      this.outboundDrainTimer = null;
    }
  }

  /** VIEWER handles are flagged after attach so no SYNC write frame ever leaves. */
  setDocReadOnly(docName: string, readOnly: boolean): void {
    const entry = this.docs.get(docName);
    if (!entry) return;
    entry.readOnly = readOnly;
    if (readOnly) {
      entry.droppedWhileDisconnected = false;
      this.setOutboundPending(entry, false);
    }
  }

  isOutboundPending(docName: string): boolean {
    return this.docs.get(docName)?.pendingLocalFrames ?? false;
  }

  subscribeOutboundPending(docName: string, listener: (pending: boolean) => void): () => void {
    let set = this.outboundListeners.get(docName);
    if (!set) {
      set = new Set();
      this.outboundListeners.set(docName, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.outboundListeners.delete(docName);
    };
  }

  private sendForDoc(docName: string, payload: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(encodeDocFrame(docName, payload));
    } catch (err) {
      console.warn('[realtime] send failed; reconnecting', err);
      this.forceReconnect();
    }
  }

  private bootstrapDoc(entry: DocEntry): void {
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

  private buildUrl(orgId: string): string {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/api/realtime?org_id=${encodeURIComponent(orgId)}`;
  }

  private resolveOrgId(): string | null {
    try {
      const persisted = localStorage.getItem('persist:root');
      if (!persisted) return null;
      const root = JSON.parse(persisted);
      const auth = JSON.parse(root.auth || '{}');
      return (auth.currentOrganizationId as string | null) ?? null;
    } catch {
      return null;
    }
  }

  private ensureListeners(): void {
    if (this.listenersAttached) return;
    this.listenersAttached = true;
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
    document.addEventListener('visibilitychange', this.handleVisibility);
    window.addEventListener(AUTH_REFRESHED_EVENT, this.handleAuthRefreshed);
    window.addEventListener(AUTH_REVOKED_EVENT, this.handleAuthRevoked);
  }

  private handleOnline = (): void => {
    if (this.docs.size > 0) this.forceReconnect();
  };

  private handleOffline = (): void => {
    this.emitStatusAll('offline');
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
    if (document.visibilityState !== 'visible') return;
    if (this.docs.size === 0) return;
    if (!this.wsConnected && !this.wsConnecting) this.forceReconnect();
  };

  private handleAuthRefreshed = (): void => {
    if (this.docs.size === 0) return;
    // Reconnect so the subprotocol carries the fresh bearer.
    this.forceReconnect();
  };

  private handleAuthRevoked = (): void => {
    this.destroyed = true;
    if (this.ws) {
      try {
        this.ws.close(WS_CLOSE_NORMAL, 'auth revoked');
      } catch {
        // ignored
      }
      this.cleanupSocket();
    }
    for (const entry of this.docs.values()) {
      entry.ydoc.off('update', entry.updateHandler);
      entry.awareness.off('change', entry.awarenessHandler);
    }
    this.docs.clear();
  };
}

export const realtimeMultiplexer = new RealtimeMultiplexer();
