import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
import { resolveCloseDisposal } from "@/features/realtime/hooks/useDocSession";

const auth = vi.hoisted(() => ({ refresh: vi.fn(), org: "org-1" }));
vi.mock("@/config/api", () => ({
  getAccessToken: () => "test-token",
  refreshAccessToken: auth.refresh,
}));
vi.mock("@/features/auth/store/credentialStorage", () => ({
  readStoredAuth: () => ({ currentOrganizationId: auth.org }),
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
  vi.advanceTimersByTime(250);
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

beforeEach(() => vi.useFakeTimers());

function attachDoc(
  contentId: string,
  options: Partial<
    Pick<
      MultiplexerAttachOptions,
      "onWriteDenied" | "onStatus" | "onGenerationMismatch" | "onCloseCode"
    >
  > = {},
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
  vi.spyOn(Math, "random").mockReturnValue(0.5);
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
    expect(onWriteDenied).toHaveBeenCalledWith("edit access removed", false);

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
    vi.advanceTimersByTime(250);
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

describe("generation change", () => {
  it("after acknowledged edits reports a mismatch that the session must not read as a clean close", () => {
    const statuses: string[] = [];
    const onGenerationMismatch = vi.fn();
    const doc = attachDoc("replaced", { onStatus: (s) => statuses.push(s), onGenerationMismatch });
    const ws = currentWs();
    ws.open();
    const server = new Y.Doc();
    server.getMap("doc_meta").set("generation", "G");
    server.getText("markdown").insert(0, "server text");
    ws.receive(serverSyncStep2Frame(doc.docName, server, Y.encodeStateVector(doc.ydoc)));
    doc.ydoc.getText("markdown").insert(11, " my paragraph");
    applyClientFramesToServer(ws, doc.docName, server);
    expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(false);

    ws.receive(serverGenerationFrame(doc.docName, "H"));
    expect(onGenerationMismatch).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe("connected");
    // Further local edits never leave on the replaced generation.
    const framesBefore = ws.sent.length;
    doc.ydoc.getText("markdown").insert(0, "x");
    expect(ws.sent.length).toBe(framesBefore);

    const disposal = resolveCloseDisposal({
      discardLocalOnCleanClose: true,
      serverSynced: true,
      hydrationComplete: true,
      transportStatus: "connected",
      outboundPending: realtimeMultiplexer.isOutboundPending(doc.docName),
      readOnly: false,
      generationChanged: onGenerationMismatch.mock.calls.length > 0,
      denied: false,
    });
    expect(disposal.discard).toBe(false);
    server.destroy();
  });
});

describe("close codes", () => {
  it("delivers 4410 to the session and stops reconnecting", () => {
    vi.useFakeTimers();
    const closeCodes: number[] = [];
    const doc = attachDoc("revoked", { onCloseCode: (code) => closeCodes.push(code) });
    const ws = currentWs();
    ws.open();
    doc.ydoc.getText("markdown").insert(0, "in flight");
    ws.serverClose(4410);
    expect(closeCodes).toEqual([4410]);
    expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(
      resolveCloseDisposal({
        discardLocalOnCleanClose: true,
        serverSynced: true,
        hydrationComplete: true,
        transportStatus: "token_revoked",
        outboundPending: false,
        readOnly: false,
        generationChanged: false,
        denied: false,
      }).discard,
    ).toBe(false);
  });
});

it("retries a blocked connection immediately without dropping attached content", () => {
  const doc = attachDoc("retry");
  const first = FakeWebSocket.instances.at(-1)!;
  doc.ydoc.getText("markdown").insert(0, "local draft");
  const count = FakeWebSocket.instances.length;
  realtimeMultiplexer.retryConnection();
  expect(first.readyState).toBe(FakeWebSocket.CLOSED);
  expect(FakeWebSocket.instances).toHaveLength(count + 1);
  expect(doc.ydoc.getText("markdown").toString()).toBe("local draft");
  expect(doc.onSync).not.toHaveBeenCalled();
});

it("retries token refresh without opening unauthenticated sockets or dropping edits", async () => {
  vi.useFakeTimers();
  auth.refresh.mockReset().mockResolvedValueOnce(null).mockResolvedValueOnce("fresh");
  const doc = attachDoc("refresh-retry");
  const first = currentWs();
  first.open();
  doc.ydoc.getText("markdown").insert(0, "pending during expiry");
  first.serverClose(4409);
  await vi.advanceTimersByTimeAsync(500);
  expect(auth.refresh).toHaveBeenCalledTimes(1);
  expect(FakeWebSocket.instances).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(750);
  expect(auth.refresh).toHaveBeenCalledTimes(2);
  const second = currentWs();
  expect(second).not.toBe(first);
  second.open();
  const server = new Y.Doc();
  applyClientFramesToServer(second, doc.docName, server);
  expect(server.getText("markdown").toString()).toBe("pending during expiry");
  server.destroy();
});

it("bounds invalid-token retries and explicit Retry restarts refresh", async () => {
  vi.useFakeTimers();
  auth.refresh.mockReset().mockResolvedValue(null);
  const doc = attachDoc("invalid-token");
  const first = currentWs();
  first.open();
  doc.ydoc.getText("markdown").insert(0, "retained");
  first.serverClose(4401);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(auth.refresh).toHaveBeenCalledTimes(5);
  expect(FakeWebSocket.instances).toHaveLength(1);
  expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(true);
  auth.refresh.mockResolvedValue("valid");
  realtimeMultiplexer.retryConnection();
  await vi.advanceTimersByTimeAsync(0);
  expect(FakeWebSocket.instances).toHaveLength(2);
  currentWs().open();
});

it("closes an idle old-org socket before attaching in another workspace", () => {
  const firstDoc = attachDoc("old-org");
  const first = currentWs();
  first.open();
  firstDoc.subscription.destroy();
  attached = attached.filter((item) => item !== firstDoc);
  firstDoc.awareness.destroy();
  firstDoc.ydoc.destroy();
  auth.org = "org-2";
  window.dispatchEvent(new Event("uniffy:auth:refreshed"));
  attachDoc("new-org");
  expect(first.readyState).toBe(FakeWebSocket.CLOSED);
  expect(currentWs().url).toContain("org_id=org-2");
  auth.org = "org-1";
});

it("keeps seed proposals separate from pending user updates and settles rejection", async () => {
  const doc = attachDoc("seed-proposal");
  const ws = currentWs();
  ws.open();
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 4);
  encoding.writeVarUint(encoder, 1);
  encoding.writeVarString(encoder, "lease-token");
  ws.receive(encodeDocFrame(doc.docName, encoding.toUint8Array(encoder)));
  const result = doc.subscription.submitSeed(new Uint8Array([0, 0]), "base");
  const frame = ws.sent.at(-1)!;
  const decoder = decoding.createDecoder(frame.subarray(peekVarString(frame).payloadOffset));
  expect(decoding.readVarUint(decoder)).toBe(8);
  decoding.readVarString(decoder);
  const id = decoding.readVarString(decoder);
  expect(decoding.readVarString(decoder)).toBe("lease-token");
  expect(decoding.readVarString(decoder)).toBe("base");
  expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(false);
  const rejection = encoding.createEncoder();
  encoding.writeVarUint(rejection, 9);
  encoding.writeVarString(rejection, id);
  ws.receive(encodeDocFrame(doc.docName, encoding.toUint8Array(rejection)));
  expect(await result).toBe(false);
});

it("rejects an oversized local update without disconnecting another document", () => {
  const denied = vi.fn();
  const large = attachDoc("large", { onWriteDenied: denied });
  const other = attachDoc("small");
  const ws = currentWs();
  ws.open();
  large.ydoc.getText("markdown").insert(0, "x".repeat(1024 * 1024));
  expect(denied).toHaveBeenCalledWith("update too large", false);
  for (let i = 0; i < 3; i++) ws.receive(serverSyncStep1Frame(large.docName, new Y.Doc()));
  other.ydoc.getText("markdown").insert(0, "still live");
  expect(ws.readyState).toBe(FakeWebSocket.OPEN);
  expect(ws.sent.every((frame) => frame.length <= 1024 * 1024)).toBe(true);
  const server = new Y.Doc();
  applyClientFramesToServer(ws, other.docName, server);
  expect(server.getText("markdown").toString()).toBe("still live");
  server.destroy();
});

it("sends observer-generated projection in the same durable frame", () => {
  const doc = attachDoc("atomic");
  const ws = currentWs();
  ws.open();
  const source = doc.ydoc.getText("source");
  source.observe(() => doc.ydoc.getText("markdown").insert(0, "projected"));
  source.insert(0, "rich");
  vi.advanceTimersByTime(250);
  const updates = ws.sent.filter((frame) => frame[peekVarString(frame).payloadOffset] === 6);
  expect(updates).toHaveLength(1);
  const server = new Y.Doc();
  applyClientFramesToServer(ws, doc.docName, server);
  expect(server.getText("source").toString()).toBe("rich");
  expect(server.getText("markdown").toString()).toBe("projected");
  server.destroy();
});

it("reconnects a socket whose initial sync never receives a reply", async () => {
  vi.useFakeTimers();
  attachDoc("half-open");
  currentWs().open();
  await vi.advanceTimersByTimeAsync(10_001);
  expect(FakeWebSocket.instances).toHaveLength(2);
});

function durableFrames(ws: FakeWebSocket, docName: string): Uint8Array[] {
  return ws.sent.filter((frame) => {
    const prefix = peekVarString(frame);
    return prefix.docName === docName && frame[prefix.payloadOffset] === 6;
  });
}

function acknowledgeFrame(ws: FakeWebSocket, frame: Uint8Array): Uint8Array {
  const { docName, payloadOffset } = peekVarString(frame);
  const decoder = decoding.createDecoder(frame.subarray(payloadOffset));
  decoding.readVarUint(decoder);
  decoding.readVarString(decoder);
  const id = decoding.readVarString(decoder);
  const update = decoding.readVarUint8Array(decoder);
  const ack = encoding.createEncoder();
  encoding.writeVarUint(ack, 7);
  encoding.writeVarString(ack, id);
  ws.receive(encodeDocFrame(docName, encoding.toUint8Array(ack)));
  return update;
}

it("batches sustained typing without postponing the first deadline", () => {
  const doc = attachDoc("typing-batches");
  const ws = currentWs();
  ws.open();
  const server = new Y.Doc();
  for (let i = 0; i < 20; i++) {
    doc.ydoc.getText("markdown").insert(i, "x");
    expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(true);
    vi.advanceTimersByTime(50);
    expect(durableFrames(ws, doc.docName)).toHaveLength(Math.floor((i + 1) / 5));
  }
  for (const frame of durableFrames(ws, doc.docName)) {
    Y.applyUpdate(server, acknowledgeFrame(ws, frame));
  }
  expect(server.getText("markdown").toString()).toBe("x".repeat(20));
  expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(false);
  server.destroy();
});

it("keeps a buffered deletion pending when the preceding insertion is acknowledged", () => {
  const doc = attachDoc("buffered-delete");
  const ws = currentWs();
  ws.open();
  const text = doc.ydoc.getText("markdown");
  text.insert(0, "delete me");
  vi.advanceTimersByTime(250);
  text.delete(0, text.length);
  const server = new Y.Doc();
  Y.applyUpdate(server, acknowledgeFrame(ws, durableFrames(ws, doc.docName)[0]));
  expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(true);
  vi.advanceTimersByTime(249);
  expect(durableFrames(ws, doc.docName)).toHaveLength(1);
  vi.advanceTimersByTime(1);
  Y.applyUpdate(server, acknowledgeFrame(ws, durableFrames(ws, doc.docName)[1]));
  expect(server.getText("markdown").toString()).toBe("");
  expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(false);
  server.destroy();
});

it.each(["detach", "pagehide"])("flushes buffered typing on %s and cancels its timer", (event) => {
  const doc = attachDoc(`flush-${event}`);
  const ws = currentWs();
  ws.open();
  doc.ydoc.getText("markdown").insert(0, "last edit");
  expect(durableFrames(ws, doc.docName)).toHaveLength(0);
  if (event === "detach") doc.subscription.destroy();
  else window.dispatchEvent(new Event("pagehide"));
  expect(durableFrames(ws, doc.docName)).toHaveLength(1);
  vi.advanceTimersByTime(500);
  expect(durableFrames(ws, doc.docName)).toHaveLength(1);
});

it.each(["permission", "generation"])("does not send a buffered batch after %s loss", (reason) => {
  const doc = attachDoc(`denied-batch-${reason}`);
  const ws = currentWs();
  ws.open();
  doc.ydoc.getMap("doc_meta").set("generation", "old");
  doc.ydoc.getText("markdown").insert(0, "recover me");
  if (reason === "permission") ws.receive(serverAuthDeniedFrame(doc.docName, "revoked"));
  else ws.receive(serverGenerationFrame(doc.docName, "new"));
  vi.advanceTimersByTime(500);
  expect(durableFrames(ws, doc.docName)).toHaveLength(0);
  expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(true);
  expect(doc.ydoc.getText("markdown").toString()).toBe("recover me");
});

it("combines buffered edits with sync recovery without a later duplicate send", () => {
  const doc = attachDoc("sync-buffer");
  const ws = currentWs();
  ws.open();
  doc.ydoc.getText("markdown").insert(0, "recover");
  const server = new Y.Doc();
  ws.receive(serverSyncStep1Frame(doc.docName, server));
  expect(durableFrames(ws, doc.docName)).toHaveLength(1);
  Y.applyUpdate(server, acknowledgeFrame(ws, durableFrames(ws, doc.docName)[0]));
  vi.advanceTimersByTime(500);
  expect(durableFrames(ws, doc.docName)).toHaveLength(1);
  expect(server.getText("markdown").toString()).toBe("recover");
  expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(false);
  server.destroy();
});

it("sends a large transaction separately instead of rejecting a combined oversized batch", () => {
  const denied = vi.fn();
  const doc = attachDoc("large-batch", { onWriteDenied: denied });
  const ws = currentWs();
  ws.open();
  doc.ydoc.getText("first").insert(0, "x".repeat(32 * 1024));
  doc.ydoc.getText("second").insert(0, "y".repeat(1024 * 1024 - 8192));
  expect(denied).not.toHaveBeenCalled();
  expect(durableFrames(ws, doc.docName)).toHaveLength(2);
  const server = new Y.Doc();
  applyClientFramesToServer(ws, doc.docName, server);
  expect(server.getText("first").length).toBe(32 * 1024);
  expect(server.getText("second").length).toBe(1024 * 1024 - 8192);
  expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(false);
  server.destroy();
});

it("keeps a second document on its own batching deadline", () => {
  const first = attachDoc("batch-first");
  const second = attachDoc("batch-second");
  const ws = currentWs();
  ws.open();
  first.ydoc.getText("markdown").insert(0, "first");
  vi.advanceTimersByTime(150);
  second.ydoc.getText("markdown").insert(0, "second");
  vi.advanceTimersByTime(100);
  expect(durableFrames(ws, first.docName)).toHaveLength(1);
  expect(durableFrames(ws, second.docName)).toHaveLength(0);
  vi.advanceTimersByTime(150);
  expect(durableFrames(ws, second.docName)).toHaveLength(1);
});

// Auth revocation retires the shared multiplexer used by the preceding tests.
it("emits token_revoked to every session before dropping docs on auth revocation", () => {
  const statuses: string[] = [];
  const doc = attachDoc("logout", { onStatus: (s) => statuses.push(s) });
  const ws = currentWs();
  ws.open();
  doc.ydoc.getText("markdown").insert(0, "typed, never committed");
  window.dispatchEvent(new Event("uniffy:auth:revoked"));
  expect(statuses.at(-1)).toBe("token_revoked");
  expect(realtimeMultiplexer.isAttached(doc.docName)).toBe(false);
});
