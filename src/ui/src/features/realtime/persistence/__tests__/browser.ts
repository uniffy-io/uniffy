import "fake-indexeddb/auto";
import { openDB } from "idb";
import { vi } from "vitest";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import type { Store } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import { setStoreRef } from "@/app/storeRef";
import { Awareness } from "y-protocols/awareness";
import { setMemoryAccessToken } from "@/config/api";
import { docGeneration } from "@/features/realtime/docGeneration";
import { docNameFor } from "@/features/realtime/docNames";
import { denialRetainsDraft, hydrationRetainsDraft } from "@/features/realtime/hooks/useDocSession";
import { encodeDocFrame, peekVarString } from "@/features/realtime/multiplex";
import { realtimeMultiplexer, type DocSubscription } from "@/features/realtime/multiplexer";
import { clearPendingDoc } from "@/features/realtime/pendingDocs";
import {
  attachEncryptedPersistence,
  type EncryptedPersistence,
} from "@/features/realtime/persistence/encryptedYjsPersistence";
import {
  encodeAcceptedReceipt,
  encodeCheckpointProgress,
  encodeCommitted,
  encodeGeneration,
  encodeSessionState,
  MESSAGE_UPDATE,
} from "@/features/realtime/protocol";
import {
  initStorageEncryption,
  teardownStorageEncryption,
} from "@/shared/crypto/storageEncryption";

/** The socket the multiplexer opens; tests answer it as the server. */
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  bufferedAmount = 0;
  binaryType = "";
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<ArrayBuffer | Blob | string>) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(
    public url: string,
    public protocols: string[],
  ) {
    FakeWebSocket.instances.push(this);
  }
  send(data: Uint8Array): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
  }
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  receive(frame: Uint8Array): void {
    const copy = frame.slice();
    this.onmessage?.({ data: copy.buffer } as MessageEvent<ArrayBuffer>);
  }
  serverClose(code: number): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code } as CloseEvent);
  }
}

export function currentSocket(): FakeWebSocket {
  const ws = FakeWebSocket.instances.at(-1);
  if (!ws) throw new Error("no websocket opened");
  return ws;
}

/** The socket the browser's online event opens after a drop. */
export function reopenSocket(): FakeWebSocket {
  window.dispatchEvent(new Event("online"));
  const ws = currentSocket();
  ws.open();
  return ws;
}

export function closeSockets(): void {
  for (const ws of FakeWebSocket.instances) {
    if (ws.readyState !== FakeWebSocket.CLOSED) ws.serverClose(1000);
  }
  FakeWebSocket.instances = [];
}

let signedInUser = "alice";
let currentOrganization = "org-1";

/** The signed-in account and workspace the multiplexer and local recovery read. */
export function switchAccount(userId: string, organizationId = "org-1"): void {
  signedInUser = userId;
  currentOrganization = organizationId;
}

/** Browser globals the realtime client needs, backed by in-memory storage. */
export function installBrowser(): void {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), { location: { protocol: "https:", host: "test.local" } }),
  );
  vi.stubGlobal("document", {
    addEventListener: () => {},
    removeEventListener: () => {},
    visibilityState: "visible",
  });
  const local = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => local.get(key) ?? null,
    setItem: (key: string, value: string) => void local.set(key, String(value)),
    removeItem: (key: string) => void local.delete(key),
  });
  setStoreRef({
    getState: () => ({
      auth: { user: { id: signedInUser }, currentOrganizationId: currentOrganization },
    }),
  } as unknown as Store<RootState>);
  setMemoryAccessToken("test-token");
}

const DEVICE_SEED = new Uint8Array(32).fill(7);

/** Writes a row straight into the device database, bypassing local recovery. */
export async function storeRawRow(key: string[], payload: unknown, version = 4): Promise<void> {
  const db = await openDB("uniffy-realtime-yjs", version, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("updates")) database.createObjectStore("updates");
    },
  });
  await db.put("updates", payload, key);
  db.close();
}

/** A fresh device key for the account. Like a new login it wipes every encrypted row. */
export async function signInDevice(userId = "alice"): Promise<void> {
  switchAccount(userId);
  teardownStorageEncryption();
  await initStorageEncryption(DEVICE_SEED, userId);
}

// Node's Event keeps `returnValue` read-only; a browser's BeforeUnloadEvent lets handlers set it.
class UnloadEvent extends Event {
  returnValue = true;
}

/** Retries an assertion across real event-loop turns; fake timers never advance here. */
export async function eventually(assertion: () => void | Promise<void>): Promise<void> {
  for (let round = 0; ; round++) {
    try {
      await assertion();
      return;
    } catch (error) {
      if (round >= 500) throw error;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Dispatches `beforeunload` and reports whether any handler asked the browser to confirm. */
export function beforeUnloadPrevented(): boolean {
  const event = new UnloadEvent("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

export interface UpdateWrite {
  id: string;
  update: Uint8Array;
}

/** Update frames the client sent for one document, oldest first. */
export function updateWrites(ws: FakeWebSocket, docName: string): UpdateWrite[] {
  const writes: UpdateWrite[] = [];
  for (const frame of ws.sent) {
    const { docName: name, payloadOffset } = peekVarString(frame);
    if (name !== docName || frame[payloadOffset] !== MESSAGE_UPDATE) continue;
    const decoder = decoding.createDecoder(frame.subarray(payloadOffset));
    decoding.readVarUint(decoder);
    decoding.readVarString(decoder);
    const id = decoding.readVarString(decoder);
    writes.push({ id, update: decoding.readVarUint8Array(decoder) });
  }
  return writes;
}

/**
 * One document on a buffered realtime server: accepted updates get receipts in the current
 * epoch, a checkpoint covers a prefix of them, and losing the buffer rolls the document back
 * to its checkpoint under a new epoch.
 */
export class FakeRealtimeServer {
  doc = new Y.Doc();
  epoch = "E1";
  private checkpointState: Uint8Array;
  private accepted: { id: string; update: Uint8Array }[] = [];
  private covered = 0;
  private revision = 1;
  private consumed = new WeakMap<FakeWebSocket, number>();

  constructor(
    readonly docName: string,
    readonly generation: string,
    text = "",
  ) {
    this.doc.getMap("doc_meta").set("generation", generation);
    if (text) this.doc.getText("markdown").insert(0, text);
    this.checkpointState = Y.encodeStateAsUpdate(this.doc);
  }

  get text(): string {
    return this.doc.getText("markdown").toString();
  }

  private send(ws: FakeWebSocket, payload: Uint8Array): void {
    ws.receive(encodeDocFrame(this.docName, payload));
  }

  /** What an attach hears, in the server's order: the client's first SyncStep1 draws generation,
   * session state and the server's SyncStep1 once, then the SyncStep2 that answers it. */
  attach(ws: FakeWebSocket): void {
    this.handshake(ws);
    this.sync(ws, (encoder) => syncProtocol.writeSyncStep1(encoder, this.doc));
    this.sync(ws, (encoder) => syncProtocol.writeSyncStep2(encoder, this.doc));
  }

  /** The answer to the client's periodic SyncStep1. */
  resync(ws: FakeWebSocket): void {
    this.handshake(ws);
    this.sync(ws, (encoder) => syncProtocol.writeSyncStep2(encoder, this.doc));
  }

  private handshake(ws: FakeWebSocket): void {
    this.send(ws, encodeGeneration(this.generation));
    this.send(
      ws,
      encodeSessionState({
        generation: this.generation,
        epoch: this.epoch,
        headSequence: this.accepted.length,
        checkpointSequence: this.covered,
        checkpointRevision: this.revision,
      }),
    );
  }

  private sync(ws: FakeWebSocket, write: (encoder: encoding.Encoder) => void): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    write(encoder);
    this.send(ws, encoding.toUint8Array(encoder));
  }

  private unread(ws: FakeWebSocket): UpdateWrite[] {
    const writes = updateWrites(ws, this.docName);
    const fresh = writes.slice(this.consumed.get(ws) ?? 0);
    this.consumed.set(ws, writes.length);
    return fresh;
  }

  /** Buffers every new write and answers it with a receipt; a repeated id keeps its sequence. */
  accept(ws: FakeWebSocket): UpdateWrite[] {
    const writes = this.unread(ws);
    for (const write of writes) {
      let sequence = this.accepted.findIndex((entry) => entry.id === write.id) + 1;
      if (sequence === 0) {
        Y.applyUpdate(this.doc, write.update);
        this.accepted.push(write);
        sequence = this.accepted.length;
      }
      this.send(
        ws,
        encodeAcceptedReceipt({
          updateId: write.id,
          generation: this.generation,
          epoch: this.epoch,
          acceptedSequence: sequence,
        }),
      );
    }
    return writes;
  }

  /** Commits every new write at once with message 7, the way synchronous writes are answered. */
  commit(ws: FakeWebSocket): UpdateWrite[] {
    const writes = this.unread(ws);
    for (const write of writes) {
      Y.applyUpdate(this.doc, write.update);
      this.send(ws, encodeCommitted(write.id));
    }
    this.checkpointState = Y.encodeStateAsUpdate(this.doc);
    return writes;
  }

  /** The user keeps view access but may no longer edit this document. */
  removeEditAccess(ws: FakeWebSocket, reason = "edit access removed"): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 2);
    encoding.writeVarUint(encoder, 0);
    encoding.writeVarString(encoder, reason);
    this.send(ws, encoding.toUint8Array(encoder));
  }

  /** Checkpoints the buffer through `covered` and reports progress to each socket. */
  checkpoint(sockets: FakeWebSocket[], covered = this.accepted.length): void {
    const state = new Y.Doc();
    Y.applyUpdate(state, this.checkpointState);
    for (const write of this.accepted.slice(this.covered, covered))
      Y.applyUpdate(state, write.update);
    this.checkpointState = Y.encodeStateAsUpdate(state);
    state.destroy();
    this.covered = covered;
    this.revision += 1;
    for (const ws of sockets) {
      this.send(
        ws,
        encodeCheckpointProgress({
          generation: this.generation,
          epoch: this.epoch,
          coveredSequence: covered,
          checkpointRevision: this.revision,
        }),
      );
    }
  }

  /** The buffer is gone: the document falls back to its checkpoint under a fresh epoch. */
  loseBuffer(epoch: string): void {
    this.rollBack();
    this.epoch = epoch;
    this.accepted = [];
    this.covered = 0;
  }

  /** Entries past the checkpoint vanish in place; the epoch stays and their sequences are reused. */
  loseTail(): void {
    this.rollBack();
    this.accepted = this.accepted.slice(0, this.covered);
  }

  private rollBack(): void {
    this.doc.destroy();
    this.doc = new Y.Doc();
    Y.applyUpdate(this.doc, this.checkpointState);
  }
}

export interface Editor {
  docName: string;
  ydoc: Y.Doc;
  persistence: EncryptedPersistence;
  subscription: DocSubscription;
  /** Local recovery has replayed stored rows after the first server sync. */
  hydrated: Promise<void>;
  type: (text: string) => void;
  /** Closes like the session hook unless `flags` overrides what the close claims. */
  close: (flags?: { checkpointed: boolean; discard: boolean }) => Promise<void>;
}

/** A NOTE editor wired the way the session hook wires local recovery and transport. */
export function openEditor(contentId: string, options: { discardOnClean?: boolean } = {}): Editor {
  const contentType = "NOTE";
  const docName = docNameFor(contentType, contentId);
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  awareness.setLocalState(null);
  const discardOnClean = options.discardOnClean ?? false;
  const persistence = attachEncryptedPersistence({
    contentType,
    contentId,
    ydoc,
    scope: {
      contentType,
      contentId,
      organizationId: currentOrganization,
      userId: signedInUser,
      discardOnClean,
    },
    isCheckpointed: () => !realtimeMultiplexer.getDocState(docName).checkpointPending,
  });
  let markHydrated!: () => void;
  const hydrated = new Promise<void>((resolve) => {
    markHydrated = resolve;
  });
  let draftRetained = false;
  const retainDraft = () => {
    if (draftRetained) return;
    draftRetained = true;
    void persistence.quarantine();
  };
  const subscription = realtimeMultiplexer.attach({
    contentType,
    contentId,
    ydoc,
    awareness,
    onSync: () => {
      void persistence.hydrate({ serverGeneration: docGeneration(ydoc) }).then(() => {
        if (hydrationRetainsDraft(docName)) retainDraft();
        markHydrated();
      });
    },
    onWriteDenied: (reason) => {
      if (denialRetainsDraft(reason, realtimeMultiplexer.getDocState(docName))) retainDraft();
    },
  });
  return {
    docName,
    ydoc,
    persistence,
    subscription,
    hydrated,
    type: (text) => {
      const markdown = ydoc.getText("markdown");
      ydoc.transact(() => markdown.insert(markdown.length, text), "session");
    },
    close: async (flags) => {
      const checkpointed = !realtimeMultiplexer.getDocState(docName).checkpointPending;
      const close = flags ?? { checkpointed, discard: checkpointed && discardOnClean };
      if (close.checkpointed) clearPendingDoc(contentType, contentId);
      subscription.destroy();
      awareness.destroy();
      await persistence.destroy(close);
      ydoc.destroy();
    },
  };
}
