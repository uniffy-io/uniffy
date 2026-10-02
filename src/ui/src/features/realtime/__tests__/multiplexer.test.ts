import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import {
  realtimeMultiplexer,
  type DocSubscription,
  type MultiplexerAttachOptions,
} from "@/features/realtime/multiplexer";
import { encodeDocFrame, peekVarString } from "@/features/realtime/multiplex";

vi.mock("@/config/api", () => ({
  getAccessToken: () => "test-token",
}));

const MESSAGE_SYNC = 0;
const MESSAGE_AUTH = 2;
const MESSAGE_FRAGMENT_SEEDER = 4;
const AUTH_PERMISSION_DENIED = 0;
const SYNC_STEP1 = 0;
const SYNC_STEP2 = 1;
const SYNC_UPDATE = 2;

class FakeWebSocket {
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
    for (const doc of attached) this.receive(serverGenerationFrame(doc.docName, ""));
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

function currentWs(): FakeWebSocket {
  const ws = FakeWebSocket.instances.at(-1);
  if (!ws) throw new Error("no websocket opened");
  return ws;
}

function sentSyncSubtypes(ws: FakeWebSocket, docName: string): number[] {
  const subtypes: number[] = [];
  for (const bytes of ws.sent) {
    const { docName: name, payloadOffset } = peekVarString(bytes);
    if (name !== docName) continue;
    const payload = bytes.subarray(payloadOffset);
    if (payload[0] !== MESSAGE_SYNC) continue;
    subtypes.push(payload[1]);
  }
  return subtypes;
}

function serverGenerationFrame(docName: string, generation: string): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 5);
  encoding.writeVarString(encoder, generation);
  return encodeDocFrame(docName, encoding.toUint8Array(encoder));
}

function serverSyncStep1Frame(docName: string, serverDoc: Y.Doc): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(enc, serverDoc);
  return encodeDocFrame(docName, encoding.toUint8Array(enc));
}

function serverSyncStep2Frame(
  docName: string,
  serverDoc: Y.Doc,
  clientStateVector?: Uint8Array,
): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeSyncStep2(enc, serverDoc, clientStateVector);
  return encodeDocFrame(docName, encoding.toUint8Array(enc));
}

function serverAuthDeniedFrame(
  docName: string,
  reason: string,
  scope = AUTH_PERMISSION_DENIED,
): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_AUTH);
  encoding.writeVarUint(enc, scope);
  encoding.writeVarString(enc, reason);
  return encodeDocFrame(docName, encoding.toUint8Array(enc));
}

function serverSeederFrame(docName: string, granted: boolean): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_FRAGMENT_SEEDER);
  encoding.writeVarUint(encoder, Number(granted));
  return encodeDocFrame(docName, encoding.toUint8Array(encoder));
}

function applyClientFramesToServer(ws: FakeWebSocket, docName: string, serverDoc: Y.Doc): void {
  for (const bytes of ws.sent) {
    const { docName: name, payloadOffset } = peekVarString(bytes);
    if (name !== docName) continue;
    const payload = bytes.subarray(payloadOffset);
    if (payload[0] !== 6) continue;
    const decoder = decoding.createDecoder(payload);
    decoding.readVarUint(decoder);
    decoding.readVarString(decoder);
    const id = decoding.readVarString(decoder);
    Y.applyUpdate(serverDoc, decoding.readVarUint8Array(decoder));
    const ack = encoding.createEncoder();
    encoding.writeVarUint(ack, 7);
    encoding.writeVarString(ack, id);
    ws.receive(encodeDocFrame(docName, encoding.toUint8Array(ack)));
  }
}

interface AttachedDoc {
  docName: string;
  ydoc: Y.Doc;
  awareness: Awareness;
  subscription: DocSubscription;
  onSync: ReturnType<typeof vi.fn>;
}

let attached: AttachedDoc[] = [];

function attachDoc(
  contentId: string,
  options: Partial<Pick<MultiplexerAttachOptions, "onWriteDenied" | "onStatus">> = {},
): AttachedDoc {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const onSync = vi.fn();
  const subscription = realtimeMultiplexer.attach({
    contentType: "NOTE",
    contentId,
    ydoc,
    awareness,
    onSync,
    ...options,
  });
  const doc: AttachedDoc = {
    docName: `NOTE:${contentId}`,
    ydoc,
    awareness,
    subscription,
    onSync,
  };
  attached.push(doc);
  return doc;
}

beforeAll(() => {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      location: { protocol: "http:", host: "test.local" },
    }),
  );
  vi.stubGlobal("document", {
    addEventListener: () => {},
    removeEventListener: () => {},
    visibilityState: "visible",
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) =>
      key === "persist:root"
        ? JSON.stringify({ auth: JSON.stringify({ currentOrganizationId: "org-1" }) })
        : null,
  });
});

it("delivers and revokes fragment seed roles per doc and resets them on disconnect", () => {
  const first = attachDoc("first");
  const second = attachDoc("second");
  const firstRoleChanged = vi.fn();
  const secondRoleChanged = vi.fn();
  first.subscription.subscribeFragmentSeeder(firstRoleChanged);
  second.subscription.subscribeFragmentSeeder(secondRoleChanged);
  const ws = currentWs();
  ws.open();
  ws.receive(serverSeederFrame(first.docName, true));
  expect(first.subscription.isFragmentSeeder).toBe(true);
  expect(second.subscription.isFragmentSeeder).toBe(false);
  expect(firstRoleChanged).toHaveBeenCalledOnce();
  expect(secondRoleChanged).not.toHaveBeenCalled();
  ws.receive(serverSeederFrame(first.docName, false));
  expect(first.subscription.isFragmentSeeder).toBe(false);
  ws.receive(serverSeederFrame(second.docName, true));
  expect(second.subscription.isFragmentSeeder).toBe(true);
  ws.serverClose(1000);
  expect(second.subscription.isFragmentSeeder).toBe(false);
  expect(secondRoleChanged).toHaveBeenCalledTimes(2);
});

afterEach(() => {
  for (const doc of attached) {
    doc.subscription.destroy();
    doc.awareness.destroy();
    doc.ydoc.destroy();
  }
  attached = [];
  const ws = FakeWebSocket.instances.at(-1);
  if (ws && ws.readyState !== FakeWebSocket.CLOSED) {
    ws.serverClose(1000);
  }
  FakeWebSocket.instances = [];
  vi.useRealTimers();
});

describe("read-only docs", () => {
  it("drops stale peer presence on disconnect while retaining local editor identity", () => {
    const doc = attachDoc("disconnect-presence");
    const ws = currentWs();
    ws.open();
    doc.awareness.setLocalState({ markdownEditor: "local" });
    doc.awareness.getStates().set(1, { markdownEditor: "peer" });
    ws.serverClose(1000);
    expect([...doc.awareness.getStates().keys()]).toEqual([doc.awareness.clientID]);
    expect(doc.awareness.getLocalState()).toEqual({ markdownEditor: "local" });
  });

  it("sends no SYNC write frames for local or hydration updates", () => {
    const doc = attachDoc("viewer-updates");
    currentWs().open();
    realtimeMultiplexer.setDocReadOnly(doc.docName, true);

    doc.ydoc.getText("markdown").insert(0, "replayed from idb", undefined);

    const subtypes = sentSyncSubtypes(currentWs(), doc.docName);
    expect(subtypes).toContain(SYNC_STEP1);
    expect(subtypes).not.toContain(SYNC_STEP2);
    expect(subtypes).not.toContain(SYNC_UPDATE);
    expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(true);
  });

  it("suppresses the SyncStep2 reply even when the local doc has extra state", () => {
    const doc = attachDoc("viewer-handshake");
    currentWs().open();
    realtimeMultiplexer.setDocReadOnly(doc.docName, true);
    doc.ydoc.getText("markdown").insert(0, "stale local state");

    const serverDoc = new Y.Doc();
    currentWs().receive(serverSyncStep1Frame(doc.docName, serverDoc));

    const subtypes = sentSyncSubtypes(currentWs(), doc.docName);
    expect(subtypes).not.toContain(SYNC_STEP2);
    expect(subtypes).not.toContain(SYNC_UPDATE);
  });
});

describe("auth frames", () => {
  it("isolates a no-view denial while other documents keep syncing", () => {
    const denied = attachDoc("denied");
    const allowed = attachDoc("allowed");
    const ws = currentWs();
    ws.open();
    ws.receive(serverAuthDeniedFrame(denied.docName, "access removed", 1));
    denied.ydoc.getText("markdown").insert(0, "recoverable");
    allowed.ydoc.getText("markdown").insert(0, "live peer");
    const server = new Y.Doc();
    applyClientFramesToServer(ws, allowed.docName, server);
    expect(server.getText("markdown").toString()).toBe("live peer");
    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
    expect(realtimeMultiplexer.isOutboundPending(denied.docName)).toBe(true);
    ws.serverClose(1006);
    window.dispatchEvent(new Event("online"));
    const replacement = currentWs();
    replacement.open();
    expect(replacement.sent.every((bytes) => peekVarString(bytes).docName !== denied.docName)).toBe(
      true,
    );
    server.destroy();
  });

  it("marks a stale editable doc read-only and reports the denial once", () => {
    const onWriteDenied = vi.fn();
    const doc = attachDoc("downgraded", { onWriteDenied });
    currentWs().open();

    currentWs().receive(serverAuthDeniedFrame(doc.docName, "edit access removed"));
    expect(onWriteDenied).toHaveBeenCalledWith("edit access removed");

    doc.ydoc.getText("markdown").insert(0, "typed after the downgrade");
    expect(sentSyncSubtypes(currentWs(), doc.docName)).not.toContain(SYNC_UPDATE);
    expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(true);

    currentWs().receive(serverAuthDeniedFrame(doc.docName, "read only"));
    expect(onWriteDenied).toHaveBeenCalledTimes(1);
  });

  it("stays silent for a doc the client already treats as read-only", () => {
    const onWriteDenied = vi.fn();
    const doc = attachDoc("viewer-attach", { onWriteDenied });
    currentWs().open();
    realtimeMultiplexer.setDocReadOnly(doc.docName, true);

    currentWs().receive(serverAuthDeniedFrame(doc.docName, "read only"));
    expect(onWriteDenied).not.toHaveBeenCalled();
  });
});

describe("handshake replies", () => {
  it("suppresses the no-op empty SyncStep2 reply when the docs are in sync", () => {
    const doc = attachDoc("in-sync");
    currentWs().open();

    const serverDoc = new Y.Doc();
    currentWs().receive(serverSyncStep1Frame(doc.docName, serverDoc));

    expect(sentSyncSubtypes(currentWs(), doc.docName)).not.toContain(SYNC_STEP2);
  });

  it("resolves sync when the server SyncStep2 arrives", () => {
    const doc = attachDoc("sync-resolution");
    currentWs().open();

    const serverDoc = new Y.Doc();
    currentWs().receive(
      serverSyncStep2Frame(doc.docName, serverDoc, Y.encodeStateVector(doc.ydoc)),
    );

    expect(doc.onSync).toHaveBeenCalledTimes(1);
  });
});

describe("outbound pending tracking", () => {
  it("retains pending edits until committed acknowledgment after reconnect", () => {
    const doc = attachDoc("offline-edit");
    const pendingStates: boolean[] = [];
    const unsubscribe = realtimeMultiplexer.subscribeOutboundPending(doc.docName, (pending) =>
      pendingStates.push(pending),
    );

    doc.ydoc.getText("markdown").insert(0, "offline edit");
    expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(true);
    expect(pendingStates).toEqual([true]);

    currentWs().open();
    const serverDoc = new Y.Doc();
    currentWs().receive(serverSyncStep1Frame(doc.docName, serverDoc));

    expect(currentWs().sent.some((frame) => frame[peekVarString(frame).payloadOffset] === 6)).toBe(
      true,
    );
    expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(true);
    expect(pendingStates).toEqual([true]);

    applyClientFramesToServer(currentWs(), doc.docName, serverDoc);
    expect(serverDoc.getText("markdown").toString()).toBe("offline edit");
    expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(false);
    unsubscribe();
  });

  it("stays pending after socket drain until a durable acknowledgment", () => {
    vi.useFakeTimers();
    const doc = attachDoc("buffered-edit");
    const ws = currentWs();
    ws.open();

    ws.bufferedAmount = 64;
    doc.ydoc.getText("markdown").insert(0, "buffered");
    expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(true);
    expect(ws.sent.some((frame) => frame[peekVarString(frame).payloadOffset] === 6)).toBe(true);

    ws.bufferedAmount = 0;
    vi.advanceTimersByTime(300);
    expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(true);
  });
});

it("ignores delayed callbacks from a replaced socket", () => {
  vi.useFakeTimers();
  const doc = attachDoc("replacement-socket");
  const first = currentWs();
  first.open();
  window.dispatchEvent(new Event("uniffy:auth:refreshed"));
  const second = currentWs();
  expect(second).not.toBe(first);
  second.open();
  first.serverClose(1000);
  first.receive(serverAuthDeniedFrame(doc.docName, "stale denial"));
  doc.ydoc.getText("markdown").insert(0, "new socket work");
  const server = new Y.Doc();
  applyClientFramesToServer(second, doc.docName, server);
  expect(server.getText("markdown").toString()).toBe("new socket work");
  expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(false);
  server.destroy();
});

it("requires a matching acknowledgment for deletion-only updates", () => {
  const doc = attachDoc("delete-ack");
  const ws = currentWs();
  ws.open();
  const server = new Y.Doc();
  doc.ydoc.getText("markdown").insert(0, "delete me");
  applyClientFramesToServer(ws, doc.docName, server);
  const vector = Y.encodeStateVector(doc.ydoc);
  doc.ydoc.getText("markdown").delete(0, 9);
  expect(Y.encodeStateVector(doc.ydoc)).toEqual(vector);
  const ack = encoding.createEncoder();
  encoding.writeVarUint(ack, 7);
  encoding.writeVarString(ack, "unrelated");
  ws.receive(encodeDocFrame(doc.docName, encoding.toUint8Array(ack)));
  expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(true);
  applyClientFramesToServer(ws, doc.docName, server);
  expect(server.getText("markdown").toString()).toBe("");
  expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(false);
  server.destroy();
});
