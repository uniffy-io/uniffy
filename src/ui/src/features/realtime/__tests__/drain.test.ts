import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { encodeDocFrame, peekVarString } from "@/features/realtime/multiplex";

vi.mock("@/config/api", () => ({
  getAccessToken: () => "test-token",
  refreshAccessToken: async () => "test-token",
}));

const storage = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  local: new Map<string, string>(),
}));
vi.mock("@/shared/crypto/storageEncryption", () => ({
  registerEncryptedDatabase: vi.fn(),
  isStorageEncryptionReady: () => true,
  encryptForStorage: async (value: unknown) => value,
  decryptFromStorage: async (value: unknown) => value,
  ENCRYPTION_REKEY_EVENT: "rekey",
  ENCRYPTION_TEARDOWN_EVENT: "teardown",
  ENCRYPTION_READY_EVENT: "ready",
}));
vi.mock("idb", () => ({
  openDB: async () => {
    const matching = (range: { lower: string[] }) =>
      [...storage.rows.keys()]
        .map((key) => JSON.parse(key) as string[])
        .filter((key) => key[0] === range.lower[0] && key[1] === range.lower[1]);
    const put = async (_name: string, value: unknown, key: unknown) =>
      storage.rows.set(JSON.stringify(key), value);
    return {
      put,
      transaction: () => ({
        done: Promise.resolve(),
        objectStore: () => ({
          getAllKeys: async (range: { lower: string[] }) => matching(range),
          getAll: async (range: { lower: string[] }) =>
            matching(range).map((key) => storage.rows.get(JSON.stringify(key))),
          delete: async (key: unknown) => storage.rows.delete(JSON.stringify(key)),
          put: (value: unknown, key: unknown) => put("updates", value, key),
        }),
      }),
    };
  },
}));

import { realtimeMultiplexer } from "@/features/realtime/multiplexer";
import { attachEncryptedPersistence } from "@/features/realtime/persistence/encryptedYjsPersistence";
import {
  hasPendingDoc,
  listPendingDocs,
  recordPendingDoc,
  type PendingDoc,
} from "@/features/realtime/pendingDocs";
import { abortDrain, runRealtimeDrain } from "@/features/realtime/drain";
import { Awareness } from "y-protocols/awareness";

const MESSAGE_SYNC = 0;
const MESSAGE_AUTH = 2;

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

function generationFrame(docName: string, generation: string): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, 5);
  encoding.writeVarString(enc, generation);
  return encodeDocFrame(docName, encoding.toUint8Array(enc));
}

function syncStep2Frame(docName: string, serverDoc: Y.Doc): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeSyncStep2(enc, serverDoc);
  return encodeDocFrame(docName, encoding.toUint8Array(enc));
}

function authDeniedFrame(docName: string, reason: string): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_AUTH);
  encoding.writeVarUint(enc, 0);
  encoding.writeVarString(enc, reason);
  return encodeDocFrame(docName, encoding.toUint8Array(enc));
}

function applyClientFramesToServer(ws: FakeWebSocket, docName: string, serverDoc: Y.Doc): number {
  let acked = 0;
  for (const bytes of ws.sent.splice(0)) {
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
    acked++;
  }
  return acked;
}

async function flush(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function rowKeys(): string[][] {
  return [...storage.rows.keys()].map((key) => JSON.parse(key) as string[]);
}

const scope = { userId: "user-1", organizationId: "org-1" };

function entryFor(contentId: string, discardOnClean = true): PendingDoc {
  return { contentType: "TASK", contentId, ...scope, discardOnClean };
}

// A session that typed offline and closed: the rows the drain must replay.
async function strandRows(contentId: string, text: string, generation = "G"): Promise<void> {
  const doc = new Y.Doc();
  doc.getMap("doc_meta").set("generation", generation);
  const persistence = attachEncryptedPersistence({ contentType: "TASK", contentId, ydoc: doc });
  await persistence.hydrate({ serverGeneration: generation });
  doc.transact(() => doc.getText("markdown").insert(0, text), "session-id");
  await persistence.destroy();
  doc.destroy();
}

beforeAll(() => {
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
  vi.stubGlobal("IDBKeyRange", { bound: (lower: unknown) => ({ lower }) });
  storage.local.set(
    "persist:root",
    JSON.stringify({ auth: JSON.stringify({ currentOrganizationId: "org-1" }) }),
  );
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.local.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.local.set(key, value),
    removeItem: (key: string) => void storage.local.delete(key),
  });
});

beforeEach(() => {
  storage.rows.clear();
  storage.local.delete("uniffy:realtime:pending-docs");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  await flush();
  const ws = FakeWebSocket.instances.at(-1);
  if (ws && ws.readyState !== FakeWebSocket.CLOSED) ws.serverClose(1000);
  FakeWebSocket.instances = [];
  vi.restoreAllMocks();
});

describe("pending doc registry", () => {
  it("records a doc once per name and exposes a stable snapshot", () => {
    recordPendingDoc(entryFor("a"));
    recordPendingDoc(entryFor("a"));
    const snapshot = listPendingDocs();
    expect(snapshot).toHaveLength(1);
    expect(listPendingDocs()).toBe(snapshot);
    expect(hasPendingDoc("TASK", "a")).toBe(true);
    expect(JSON.parse(storage.local.get("uniffy:realtime:pending-docs") ?? "[]")).toHaveLength(1);
  });
});

describe("realtime drain", () => {
  it("yields to an editor without dropping its stored pending update", async () => {
    await strandRows("handoff", "pending during reopen");
    recordPendingDoc(entryFor("handoff"));
    runRealtimeDrain(scope);
    abortDrain("TASK:handoff");
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const persistence = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "handoff",
      ydoc: doc,
    });
    const subscription = realtimeMultiplexer.attach({
      contentType: "TASK",
      contentId: "handoff",
      ydoc: doc,
      awareness,
    });
    await persistence.hydrate({ serverGeneration: "G" });
    expect(doc.getText("markdown").toString()).toBe("pending during reopen");
    expect(hasPendingDoc("TASK", "handoff")).toBe(true);
    subscription.destroy();
    await persistence.destroy();
    awareness.destroy();
    doc.destroy();
  });
  it("replays stranded rows on the next connection, waits for acks, then clears entry and rows", async () => {
    await strandRows("drained", "typed offline");
    recordPendingDoc(entryFor("drained"));
    const docName = "TASK:drained";

    runRealtimeDrain(scope);
    expect(realtimeMultiplexer.isAttached(docName)).toBe(true);
    const ws = currentWs();
    ws.open();
    ws.receive(generationFrame(docName, "G"));
    const server = new Y.Doc();
    server.getMap("doc_meta").set("generation", "G");
    ws.receive(syncStep2Frame(docName, server));
    await flush();

    expect(realtimeMultiplexer.isOutboundPending(docName)).toBe(true);
    expect(hasPendingDoc("TASK", "drained")).toBe(true);
    await vi.waitFor(() => {
      expect(ws.sent.some((frame) => frame[peekVarString(frame).payloadOffset] === 6)).toBe(true);
    });
    expect(applyClientFramesToServer(ws, docName, server)).toBeGreaterThan(0);
    await flush();

    expect(server.getText("markdown").toString()).toBe("typed offline");
    expect(hasPendingDoc("TASK", "drained")).toBe(false);
    expect(realtimeMultiplexer.isAttached(docName)).toBe(false);
    expect(rowKeys().filter((key) => key[1] === "drained")).toHaveLength(0);
    server.destroy();
  });

  it("leaves the rows as a draft and drops the entry when the server denies writes", async () => {
    await strandRows("denied", "typed offline");
    recordPendingDoc(entryFor("denied"));
    const docName = "TASK:denied";
    const rowsBefore = rowKeys().filter((key) => key[1] === "denied").length;

    runRealtimeDrain(scope);
    const ws = currentWs();
    ws.open();
    ws.receive(generationFrame(docName, "G"));
    ws.receive(authDeniedFrame(docName, "read only"));
    await flush();

    expect(hasPendingDoc("TASK", "denied")).toBe(false);
    expect(realtimeMultiplexer.isAttached(docName)).toBe(false);
    expect(rowKeys().filter((key) => key[1] === "denied")).toHaveLength(rowsBefore);
  });

  it("keeps the rows and the entry when the server generation moved on", async () => {
    await strandRows("moved", "typed offline", "G");
    recordPendingDoc(entryFor("moved"));
    const docName = "TASK:moved";

    runRealtimeDrain(scope);
    const ws = currentWs();
    ws.open();
    ws.receive(generationFrame(docName, "H"));
    const server = new Y.Doc();
    server.getMap("doc_meta").set("generation", "H");
    ws.receive(syncStep2Frame(docName, server));
    await flush();

    expect(realtimeMultiplexer.isAttached(docName)).toBe(false);
    expect(hasPendingDoc("TASK", "moved")).toBe(false);
    expect(rowKeys().filter((key) => key[1] === "moved" && key[2] === "G").length).toBeGreaterThan(
      0,
    );
    server.destroy();
  });

  it("skips a doc an open editor already holds and ignores other users", async () => {
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);
    const held = realtimeMultiplexer.attach({
      contentType: "TASK",
      contentId: "held",
      ydoc,
      awareness,
    });
    recordPendingDoc(entryFor("held"));
    recordPendingDoc({ ...entryFor("other"), userId: "user-2" });
    runRealtimeDrain(scope);
    await flush();
    expect(hasPendingDoc("TASK", "held")).toBe(true);
    expect(hasPendingDoc("TASK", "other")).toBe(true);
    expect(realtimeMultiplexer.isAttached("TASK:other")).toBe(false);
    held.destroy();
    awareness.destroy();
    ydoc.destroy();
  });
});
