import { nativeStorage } from "@shared/realtime/__tests__/storageHarness";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import { encodeDocFrame, peekVarString } from "@shared/realtime/multiplex";
import type { RealtimeDocState, UpdateCoverageEvent } from "@shared/realtime/multiplexer";
import {
  MESSAGE_UPDATE,
  encodeAcceptedReceipt,
  encodeCheckpointProgress,
  encodeCommitted,
  encodeSessionState,
  type RealtimeStatus,
} from "@shared/realtime/protocol";

const lifecycle = vi.hoisted(() => ({
  onChange: undefined as ((state: string) => void) | undefined,
}));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_: string, callback: (state: string) => void) => {
      lifecycle.onChange = callback;
      return { remove: () => {} };
    },
  },
  Platform: { OS: "ios", Version: "18" },
}));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "0" } } }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

/** A fresh app process signed in with an access token, as the multiplexer reads it. */
async function loadTransport() {
  (await import("@core/auth/auth")).setAccessToken("token");
  return import("@shared/realtime/multiplexer");
}

class Socket {
  static instances: Socket[] = [];
  static OPEN = 1;
  readyState = 0;
  onopen?: () => void;
  onclose?: (event: { code: number }) => void;
  onmessage?: (event: { data: ArrayBuffer }) => void;
  sent: Uint8Array[] = [];
  constructor(
    public url: string,
    public protocols: string[],
    public options: { headers?: Record<string, string> },
  ) {
    Socket.instances.push(this);
  }
  send(bytes: Uint8Array) {
    this.sent.push(bytes);
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  deliver(name: string, payload: Uint8Array) {
    const frame = encodeDocFrame(name, payload);
    this.onmessage?.({ data: frame.buffer as ArrayBuffer });
  }
  receive(name: string, type: number, text: string, scope?: number) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, type);
    if (scope !== undefined) encoding.writeVarUint(enc, scope);
    encoding.writeVarString(enc, text);
    this.deliver(name, encoding.toUint8Array(enc));
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  nativeStorage.secure.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "reconnects after proxy normal close and preserves explicit read-only=%s",
  async (readOnly) => {
    const { realtimeMultiplexer } = await loadTransport();
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    const sub = realtimeMultiplexer.attach({
      contentType: "NOTE",
      contentId: "note",
      organizationId: "org",
      ydoc: doc,
      awareness,
    });
    if (readOnly) realtimeMultiplexer.setDocReadOnly(sub.docName, true);
    const first = Socket.instances[0];
    first.open();
    first.receive(sub.docName, 5, "generation");
    first.receive(sub.docName, 2, "read only", 0);
    doc.getText("markdown").insert(0, "retained");
    first.close(1000);
    await vi.advanceTimersByTimeAsync(500);
    expect(Socket.instances).toHaveLength(2);
    const second = Socket.instances[1];
    second.open();
    second.receive(sub.docName, 5, "generation");
    doc.getText("markdown").insert(8, " typing");
    vi.advanceTimersByTime(50);
    expect(writes(second).length > 0).toBe(!readOnly);
    sub.destroy();
    awareness.destroy();
    doc.destroy();
  },
);

async function openDocument(id: string) {
  const { realtimeMultiplexer } = await loadTransport();
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const statuses: RealtimeStatus[] = [];
  const events: UpdateCoverageEvent[] = [];
  const sub = realtimeMultiplexer.attach({
    contentType: "NOTE",
    contentId: id,
    organizationId: "org",
    ydoc: doc,
    awareness,
    onStatus: (status) => statuses.push(status),
    onCoverage: (batch) => events.push(...batch),
  });
  const socket = Socket.instances.at(-1)!;
  socket.open();
  socket.receive(sub.docName, 5, "g");
  return {
    realtimeMultiplexer,
    doc,
    sub,
    socket,
    statuses,
    events,
    state: () => realtimeMultiplexer.getDocState(sub.docName),
    destroy() {
      sub.destroy();
      awareness.destroy();
      doc.destroy();
    },
  };
}

async function reconnect(h: Awaited<ReturnType<typeof openDocument>>): Promise<Socket> {
  Socket.instances.at(-1)!.close(1006);
  await vi.advanceTimersByTimeAsync(500);
  const socket = Socket.instances.at(-1)!;
  socket.open();
  socket.receive(h.sub.docName, 5, "g");
  return socket;
}

function writes(socket: Socket): Uint8Array[] {
  return socket.sent.filter(
    (frame) => frame[peekVarString(frame).payloadOffset] === MESSAGE_UPDATE,
  );
}

function readWrite(frame: Uint8Array) {
  const { docName, payloadOffset } = peekVarString(frame);
  const decoder = decoding.createDecoder(frame.subarray(payloadOffset));
  decoding.readVarUint(decoder);
  const generation = decoding.readVarString(decoder);
  const id = decoding.readVarString(decoder);
  return { docName, generation, id, update: decoding.readVarUint8Array(decoder) };
}

function acknowledge(socket: Socket, frame: Uint8Array): Uint8Array {
  const { docName, id, update } = readWrite(frame);
  socket.deliver(docName, encodeCommitted(id));
  return update;
}

function denial(reason: string): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 2);
  encoding.writeVarUint(encoder, 0);
  encoding.writeVarString(encoder, reason);
  return encoding.toUint8Array(encoder);
}

const session = (epoch: string, headSequence = 0, checkpointSequence = 0) =>
  encodeSessionState({
    generation: "g",
    epoch,
    headSequence,
    checkpointSequence,
    checkpointRevision: 1,
  });
const receipt = (updateId: string, epoch: string, acceptedSequence: number) =>
  encodeAcceptedReceipt({ updateId, generation: "g", epoch, acceptedSequence });
const progress = (epoch: string, coveredSequence: number) =>
  encodeCheckpointProgress({ generation: "g", epoch, coveredSequence, checkpointRevision: 2 });

it("retains writes through reconnect and clears only matching acknowledgments", async () => {
  const h = await openDocument("ack");
  h.doc.getText("markdown").insert(0, "pending");
  vi.advanceTimersByTime(50);
  const write = writes(h.socket)[0];
  const { id } = readWrite(write);
  expect(h.state().checkpointPending).toBe(true);
  const second = await reconnect(h);
  expect(second.sent.some((frame) => [...frame].join() === [...write].join())).toBe(true);
  second.receive(h.sub.docName, 7, "wrong");
  expect(h.state().checkpointPending).toBe(true);
  second.deliver(h.sub.docName, encodeCommitted(id));
  expect(h.state().checkpointPending).toBe(false);
  expect(h.state()).toMatchObject({ transportPending: false, checkpointPending: false });
  h.destroy();
});

it("batches continuous typing into twenty update frames per second", async () => {
  const h = await openDocument("typing");
  const server = new Y.Doc();
  for (let i = 0; i < 40; i++) {
    h.doc.getText("markdown").insert(i, "x");
    expect(h.state().checkpointPending).toBe(true);
    vi.advanceTimersByTime(10);
    expect(writes(h.socket)).toHaveLength(Math.floor((i + 1) / 5));
  }
  for (const frame of writes(h.socket)) Y.applyUpdate(server, acknowledge(h.socket, frame));
  expect(server.getText("markdown").toString()).toBe("x".repeat(40));
  expect(h.state().checkpointPending).toBe(false);
  server.destroy();
  h.destroy();
});

it("does not clear buffered deletions when an older batch is acknowledged", async () => {
  const h = await openDocument("deletion");
  const text = h.doc.getText("markdown");
  text.insert(0, "delete me");
  vi.advanceTimersByTime(50);
  text.delete(0, text.length);
  const server = new Y.Doc();
  Y.applyUpdate(server, acknowledge(h.socket, writes(h.socket)[0]));
  expect(h.state().checkpointPending).toBe(true);
  vi.advanceTimersByTime(50);
  Y.applyUpdate(server, acknowledge(h.socket, writes(h.socket)[1]));
  expect(server.getText("markdown").toString()).toBe("");
  expect(h.state().checkpointPending).toBe(false);
  server.destroy();
  h.destroy();
});

it.each(["background", "detach"])("flushes on %s without a second timer send", async (event) => {
  const h = await openDocument(event);
  h.doc.getText("markdown").insert(0, "last edit");
  expect(writes(h.socket)).toHaveLength(0);
  if (event === "background") lifecycle.onChange?.("background");
  else h.sub.destroy();
  expect(writes(h.socket)).toHaveLength(1);
  vi.advanceTimersByTime(500);
  expect(writes(h.socket)).toHaveLength(1);
  h.destroy();
});

it.each(["permission", "generation"])(
  "retains a batch without sending after %s loss",
  async (reason) => {
    const h = await openDocument(reason);
    h.doc.getMap("doc_meta").set("generation", "g");
    h.doc.getText("markdown").insert(0, "recover me");
    if (reason === "permission") h.socket.receive(h.sub.docName, 2, "revoked", 0);
    else h.socket.receive(h.sub.docName, 5, "replacement");
    vi.advanceTimersByTime(500);
    expect(writes(h.socket)).toHaveLength(0);
    expect(h.state().checkpointPending).toBe(true);
    expect(h.doc.getText("markdown").toString()).toBe("recover me");
    h.destroy();
  },
);

it("flushes input committed by a later background listener", async () => {
  const h = await openDocument("late-background-input");
  lifecycle.onChange?.("background");
  h.doc.getText("markdown").insert(0, "last native input");
  expect(writes(h.socket)).toHaveLength(1);
  vi.advanceTimersByTime(500);
  expect(writes(h.socket)).toHaveLength(1);
  h.destroy();
});

it("recovers a batch interrupted before its timer fired", async () => {
  const h = await openDocument("early-disconnect");
  h.doc.getText("markdown").insert(0, "recover");
  h.socket.close(1006);
  vi.advanceTimersByTime(500);
  const second = Socket.instances.at(-1)!;
  second.open();
  second.receive(h.sub.docName, 5, "g");
  const server = new Y.Doc();
  expect(writes(second)).toHaveLength(1);
  Y.applyUpdate(server, acknowledge(second, writes(second)[0]));
  expect(server.getText("markdown").toString()).toBe("recover");
  expect(h.state().checkpointPending).toBe(false);
  server.destroy();
  h.destroy();
});

it("includes buffered edits in sync recovery without sending them twice", async () => {
  const h = await openDocument("sync-buffer");
  h.doc.getText("markdown").insert(0, "recover");
  const server = new Y.Doc();
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  syncProtocol.writeSyncStep1(encoder, server);
  h.socket.deliver(h.sub.docName, encoding.toUint8Array(encoder));
  expect(writes(h.socket)).toHaveLength(1);
  Y.applyUpdate(server, acknowledge(h.socket, writes(h.socket)[0]));
  vi.advanceTimersByTime(500);
  expect(writes(h.socket)).toHaveLength(1);
  expect(server.getText("markdown").toString()).toBe("recover");
  expect(h.state().checkpointPending).toBe(false);
  server.destroy();
  h.destroy();
});

it("keeps a large transaction separate from prior buffered edits", async () => {
  const h = await openDocument("large-batch");
  h.doc.getText("first").insert(0, "x".repeat(32 * 1024));
  h.doc.getText("second").insert(0, "y".repeat(1024 * 1024 - 8192));
  expect(writes(h.socket)).toHaveLength(2);
  const server = new Y.Doc();
  for (const frame of writes(h.socket)) Y.applyUpdate(server, acknowledge(h.socket, frame));
  expect(server.getText("first").length).toBe(32 * 1024);
  expect(server.getText("second").length).toBe(1024 * 1024 - 8192);
  expect(h.state().checkpointPending).toBe(false);
  server.destroy();
  h.destroy();
});

it("stops retransmitting a received update but keeps it pending until a checkpoint covers it", async () => {
  const h = await openDocument("receipt");
  h.socket.deliver(h.sub.docName, session("e1"));
  h.doc.getText("markdown").insert(0, "accepted");
  vi.advanceTimersByTime(50);
  const { id } = readWrite(writes(h.socket)[0]);
  h.socket.deliver(h.sub.docName, receipt(id, "e1", 1));
  expect(h.state()).toMatchObject({
    transportPending: false,
    checkpointPending: true,
    generation: "g",
  });
  expect(h.statuses.at(-1)).toBe("connected");
  expect(h.state().checkpointPending).toBe(true);

  const second = await reconnect(h);
  second.deliver(h.sub.docName, session("e1", 1, 0));
  expect(writes(second)).toHaveLength(0);
  expect(h.state().checkpointPending).toBe(true);
  second.deliver(h.sub.docName, progress("e1", 1));
  expect(h.state()).toMatchObject({
    transportPending: false,
    checkpointPending: false,
    oldestUncheckpointedAt: null,
  });
  expect(h.events.map((event) => [event.updateId, event.coverage])).toEqual([
    [id, "local"],
    [id, "accepted"],
    [id, "checkpointed"],
  ]);
  h.destroy();
});

it("checkpoints an update whose progress overtook its receipt", async () => {
  const h = await openDocument("reordered");
  h.socket.deliver(h.sub.docName, session("e1"));
  h.doc.getText("markdown").insert(0, "first");
  vi.advanceTimersByTime(50);
  h.doc.getText("markdown").insert(5, " second");
  vi.advanceTimersByTime(50);
  const [first, second] = writes(h.socket).map((frame) => readWrite(frame).id);
  h.socket.deliver(h.sub.docName, progress("e1", 1));
  h.socket.deliver(h.sub.docName, receipt(first, "e1", 1));
  h.socket.deliver(h.sub.docName, receipt(second, "e1", 2));
  expect(h.events.filter((event) => event.coverage !== "local")).toMatchObject([
    { updateId: first, coverage: "checkpointed" },
    { updateId: second, coverage: "accepted" },
  ]);
  expect(h.state()).toMatchObject({ transportPending: false, checkpointPending: true });
  h.destroy();
});

it("replays accepted updates under their original ids when the buffer epoch changes", async () => {
  const h = await openDocument("epoch");
  h.socket.deliver(h.sub.docName, session("e1"));
  h.doc.getText("markdown").insert(0, "survives a buffer reset");
  vi.advanceTimersByTime(50);
  const original = writes(h.socket)[0];
  const { id } = readWrite(original);
  h.socket.deliver(h.sub.docName, receipt(id, "e1", 1));

  h.socket.deliver(h.sub.docName, session("e2"));
  expect(writes(h.socket)).toHaveLength(2);
  expect([...writes(h.socket)[1]]).toEqual([...original]);
  expect(h.state().transportPending).toBe(true);

  h.socket.deliver(h.sub.docName, progress("e1", 9));
  expect(h.state().checkpointPending).toBe(true);
  h.socket.deliver(h.sub.docName, receipt(id, "e2", 1));
  h.socket.deliver(h.sub.docName, progress("e2", 1));
  expect(h.state()).toMatchObject({ transportPending: false, checkpointPending: false });
  h.destroy();
});

it("resends a write still awaiting its receipt when the epoch changes on a live socket", async () => {
  const h = await openDocument("epoch-in-flight");
  h.socket.deliver(h.sub.docName, session("e1"));
  h.doc.getText("markdown").insert(0, "sent before the reset");
  vi.advanceTimersByTime(50);
  const original = writes(h.socket)[0];
  const { id } = readWrite(original);

  h.socket.deliver(h.sub.docName, session("e2"));
  expect(writes(h.socket).map((frame) => [...frame])).toEqual([[...original], [...original]]);
  h.socket.deliver(h.sub.docName, receipt(id, "e1", 1));
  expect(h.state().transportPending).toBe(true);
  h.socket.deliver(h.sub.docName, receipt(id, "e2", 1));
  h.socket.deliver(h.sub.docName, progress("e2", 1));
  expect(h.state()).toMatchObject({ transportPending: false, checkpointPending: false });

  h.doc.getText("markdown").insert(0, "after ");
  vi.advanceTimersByTime(50);
  h.socket.deliver(h.sub.docName, session("e2", 1, 1));
  expect(writes(h.socket)).toHaveLength(3);
  h.destroy();
});

it("replays an accepted update when session state shows a head below its receipt", async () => {
  const h = await openDocument("lost-tail");
  h.socket.deliver(h.sub.docName, session("e1", 2, 2));
  h.doc.getText("markdown").insert(0, "lost from the buffer");
  vi.advanceTimersByTime(50);
  const original = writes(h.socket)[0];
  h.socket.deliver(h.sub.docName, receipt(readWrite(original).id, "e1", 3));
  const second = await reconnect(h);
  expect(writes(second)).toHaveLength(0);
  second.deliver(h.sub.docName, session("e1", 2, 2));
  expect(writes(second).map((frame) => [...frame])).toEqual([[...original]]);
  expect(h.state().transportPending).toBe(true);
  h.destroy();
});

it("treats message 7 as committed for an update accepted in a retired epoch", async () => {
  const h = await openDocument("committed");
  h.socket.deliver(h.sub.docName, session("e1"));
  h.doc.getText("markdown").insert(0, "seeded");
  vi.advanceTimersByTime(50);
  const { id } = readWrite(writes(h.socket)[0]);
  h.socket.deliver(h.sub.docName, receipt(id, "e1", 1));
  h.socket.deliver(h.sub.docName, session("e2"));
  h.socket.deliver(h.sub.docName, encodeCommitted(id));
  expect(h.state()).toMatchObject({ transportPending: false, checkpointPending: false });
  h.destroy();
});

it("retains and replays a delete-only update until a checkpoint covers it", async () => {
  const h = await openDocument("delete-only");
  const server = new Y.Doc();
  server.getText("markdown").insert(0, "remove me");
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  syncProtocol.writeSyncStep2(encoder, server);
  h.socket.deliver(h.sub.docName, encoding.toUint8Array(encoder));
  h.socket.deliver(h.sub.docName, session("e1"));
  h.doc.getText("markdown").delete(0, 9);
  vi.advanceTimersByTime(50);
  const deletion = readWrite(writes(h.socket)[0]);
  expect(Y.decodeUpdate(deletion.update).structs).toHaveLength(0);
  h.socket.deliver(h.sub.docName, receipt(deletion.id, "e1", 1));
  expect(h.state()).toMatchObject({ transportPending: false, checkpointPending: true });

  const second = await reconnect(h);
  second.deliver(h.sub.docName, session("e2"));
  const replay = readWrite(writes(second)[0]);
  expect(replay.id).toBe(deletion.id);
  Y.applyUpdate(server, replay.update);
  expect(server.getText("markdown").toString()).toBe("");
  second.deliver(h.sub.docName, receipt(deletion.id, "e2", 1));
  second.deliver(h.sub.docName, progress("e2", 1));
  expect(h.state().checkpointPending).toBe(false);
  server.destroy();
  h.destroy();
});

it("ignores duplicate, foreign and malformed coverage frames", async () => {
  const h = await openDocument("duplicates");
  h.socket.deliver(h.sub.docName, session("e1"));
  h.doc.getText("markdown").insert(0, "once");
  vi.advanceTimersByTime(50);
  const { id } = readWrite(writes(h.socket)[0]);
  h.socket.deliver(h.sub.docName, new Uint8Array([...receipt(id, "e1", 1), 0]));
  h.socket.deliver(h.sub.docName, receipt(id, "other-epoch", 1));
  h.socket.deliver(
    h.sub.docName,
    encodeAcceptedReceipt({ updateId: id, generation: "other", epoch: "e1", acceptedSequence: 1 }),
  );
  expect(h.state().transportPending).toBe(true);
  h.socket.deliver(h.sub.docName, receipt(id, "e1", 1));
  h.socket.deliver(h.sub.docName, receipt(id, "e1", 1));
  h.socket.deliver(h.sub.docName, progress("e1", 1));
  h.socket.deliver(h.sub.docName, progress("e1", 1));
  h.socket.deliver(h.sub.docName, encodeCommitted(id));
  expect(h.events.map((event) => event.coverage)).toEqual(["local", "accepted", "checkpointed"]);
  expect(h.state().checkpointPending).toBe(false);
  h.destroy();
});

it("publishes the oldest uncheckpointed edit to listeners subscribed before attach", async () => {
  const { realtimeMultiplexer } = await loadTransport();
  vi.setSystemTime(1_000);
  const seen: RealtimeDocState[] = [];
  const stop = realtimeMultiplexer.subscribeDocState("NOTE:clock", (state) => seen.push(state));
  const h = await openDocument("clock");
  h.socket.deliver(h.sub.docName, session("e1"));
  h.doc.getText("markdown").insert(0, "a");
  expect(seen.at(-1)).toMatchObject({ transportPending: true, oldestUncheckpointedAt: 1_000 });
  vi.advanceTimersByTime(1_000);
  h.doc.getText("markdown").insert(1, "b");
  vi.advanceTimersByTime(50);
  const [first, second] = writes(h.socket).map((frame) => readWrite(frame).id);
  h.socket.deliver(h.sub.docName, receipt(first, "e1", 1));
  h.socket.deliver(h.sub.docName, receipt(second, "e1", 2));
  h.socket.deliver(h.sub.docName, progress("e1", 1));
  expect(seen.at(-1)).toMatchObject({
    transportPending: false,
    checkpointPending: true,
    oldestUncheckpointedAt: 2_000,
  });
  h.destroy();
  expect(seen.at(-1)).toEqual(realtimeMultiplexer.getDocState("NOTE:clock"));
  expect(seen.at(-1)?.checkpointPending).toBe(false);
  stop();
});

it("knows coverage once this socket's session state and the device's retained updates are in", async () => {
  const h = await openDocument("coverage-known");
  expect(h.state().coverageKnown).toBe(false);
  h.socket.deliver(h.sub.docName, session("e1"));
  expect(h.state().coverageKnown).toBe(false);
  // Local recovery found nothing to hand back, which still settles what the device holds.
  expect(h.realtimeMultiplexer.restorePending(h.sub.docName, "g", [])).toBe(true);
  expect(h.state().coverageKnown).toBe(true);

  const second = await reconnect(h);
  expect(h.state().coverageKnown).toBe(false);
  second.deliver(h.sub.docName, session("e1"));
  expect(h.state().coverageKnown).toBe(true);
  h.destroy();
});

it("ignores session state heard before this socket names the generation", async () => {
  const h = await openDocument("state-before-generation");
  h.realtimeMultiplexer.restorePending(h.sub.docName, "g", []);
  h.socket.close(1006);
  await vi.advanceTimersByTimeAsync(500);
  const socket = Socket.instances.at(-1)!;
  socket.open();
  socket.deliver(h.sub.docName, session("e1"));
  expect(h.state().coverageKnown).toBe(false);
  socket.receive(h.sub.docName, 5, "g");
  socket.deliver(h.sub.docName, session("e1"));
  expect(h.state().coverageKnown).toBe(true);
  h.destroy();
});

it("replays a previous session's updates under their ids for the confirmed generation only", async () => {
  const h = await openDocument("restart");
  const earlier = new Y.Doc();
  earlier.getText("markdown").insert(0, "typed before restart");
  const update = Y.encodeStateAsUpdate(earlier);
  const retained = [{ updateId: "earlier:1", update, editedAt: 5 }];
  expect(h.realtimeMultiplexer.restorePending(h.sub.docName, "replaced", retained)).toBe(false);
  expect(writes(h.socket)).toHaveLength(0);

  expect(h.realtimeMultiplexer.restorePending(h.sub.docName, "g", retained)).toBe(true);
  expect(writes(h.socket).map(readWrite)).toMatchObject([{ id: "earlier:1", generation: "g" }]);
  expect(h.doc.getText("markdown").toString()).toBe("typed before restart");
  expect(h.state()).toMatchObject({ transportPending: true, oldestUncheckpointedAt: 5 });
  h.socket.deliver(h.sub.docName, encodeCommitted("earlier:1"));
  expect(h.state().checkpointPending).toBe(false);
  earlier.destroy();
  h.destroy();
});

it("offers only the v2 subprotocol and carries the bearer in a header", async () => {
  const h = await openDocument("offer");
  expect(h.socket.protocols).toEqual(["uniffy.realtime.v2"]);
  expect(h.socket.options.headers).toEqual({ Authorization: "Bearer token" });
  h.destroy();
});

it("asks for an update on close 4426 and never reconnects", async () => {
  const h = await openDocument("upgrade");
  h.doc.getText("markdown").insert(0, "kept on this device");
  vi.advanceTimersByTime(50);

  h.socket.close(4426);
  expect(h.statuses.at(-1)).toBe("upgrade_required");
  lifecycle.onChange?.("active");
  await vi.advanceTimersByTimeAsync(120_000);
  expect(Socket.instances).toHaveLength(1);
  expect(h.state().transportPending).toBe(true);

  const later: RealtimeStatus[] = [];
  const doc = new Y.Doc();
  const sub = h.realtimeMultiplexer.attach({
    contentType: "NOTE",
    contentId: "opened-later",
    organizationId: "org",
    ydoc: doc,
    awareness: new Awareness(doc),
    onStatus: (status) => later.push(status),
  });
  expect(later).toEqual(["upgrade_required"]);
  expect(Socket.instances).toHaveLength(1);
  sub.destroy();
  doc.destroy();
  h.destroy();
});

it("shows access lost on close 4403 and reconnects only with a new access token", async () => {
  const h = await openDocument("forbidden");
  h.doc.getText("markdown").insert(0, "kept on this device");
  vi.advanceTimersByTime(50);
  const [sent] = writes(h.socket).map(readWrite);

  h.socket.close(4403);
  expect(h.statuses.at(-1)).toBe("access_lost");
  lifecycle.onChange?.("active");
  await vi.advanceTimersByTimeAsync(120_000);
  expect(Socket.instances).toHaveLength(1);
  expect(h.statuses.at(-1)).toBe("access_lost");
  expect(h.state().transportPending).toBe(true);

  const later: RealtimeStatus[] = [];
  const doc = new Y.Doc();
  const sub = h.realtimeMultiplexer.attach({
    contentType: "NOTE",
    contentId: "opened-while-forbidden",
    organizationId: "org",
    ydoc: doc,
    awareness: new Awareness(doc),
    onStatus: (status) => later.push(status),
  });
  expect(later).toEqual(["access_lost"]);
  expect(Socket.instances).toHaveLength(1);

  (await import("@core/auth/auth")).setAccessToken("refreshed");
  lifecycle.onChange?.("active");
  expect(Socket.instances).toHaveLength(2);
  const second = Socket.instances[1];
  expect(second.options.headers).toEqual({ Authorization: "Bearer refreshed" });
  second.open();
  expect(h.statuses.at(-1)).toBe("connected");
  second.receive(h.sub.docName, 5, "g");
  expect(writes(second).map(readWrite)).toMatchObject([{ id: sent.id, generation: "g" }]);
  sub.destroy();
  doc.destroy();
  h.destroy();
});

it("keeps refused updates local and resends them under the same ids after five seconds", async () => {
  const h = await openDocument("unavailable");
  h.socket.deliver(h.sub.docName, session("e1"));
  h.doc.getText("markdown").insert(0, "first");
  vi.advanceTimersByTime(50);
  h.doc.getText("markdown").insert(5, " second");
  vi.advanceTimersByTime(50);
  const refused = writes(h.socket).map((frame) => [...frame]);
  h.socket.deliver(h.sub.docName, denial("unavailable"));
  h.socket.deliver(h.sub.docName, denial("unavailable"));
  expect(h.state()).toMatchObject({
    transportPending: true,
    checkpointPending: true,
    savingUnavailable: true,
  });

  h.doc.getText("markdown").insert(0, "sent after the refusal ");
  vi.advanceTimersByTime(50);
  const sent = writes(h.socket).length;
  vi.advanceTimersByTime(4_949);
  expect(writes(h.socket)).toHaveLength(sent);
  vi.advanceTimersByTime(1);
  expect(
    writes(h.socket)
      .slice(sent)
      .map((frame) => [...frame]),
  ).toEqual(refused);
  h.destroy();
});

it.each(["receipt", "commit"])("clears Saving unavailable on the first %s", async (answer) => {
  const h = await openDocument(`unavailable-${answer}`);
  h.socket.deliver(h.sub.docName, session("e1"));
  h.doc.getText("markdown").insert(0, "refused");
  vi.advanceTimersByTime(50);
  const refused = readWrite(writes(h.socket)[0]).id;
  h.socket.deliver(h.sub.docName, denial("unavailable"));
  h.doc.getText("markdown").insert(0, "accepted ");
  vi.advanceTimersByTime(50);
  const accepted = readWrite(writes(h.socket)[1]).id;
  expect(h.state().savingUnavailable).toBe(true);
  h.socket.deliver(
    h.sub.docName,
    answer === "receipt" ? receipt(accepted, "e1", 1) : encodeCommitted(accepted),
  );
  expect(h.state()).toMatchObject({ transportPending: true, savingUnavailable: false });
  vi.advanceTimersByTime(5_000);
  expect(readWrite(writes(h.socket).at(-1)!).id).toBe(refused);
  h.destroy();
});

it("rejects only the conflicting update and keeps syncing the others", async () => {
  const h = await openDocument("conflict");
  h.socket.deliver(h.sub.docName, session("e1"));
  h.doc.getText("markdown").insert(0, "conflicting");
  vi.advanceTimersByTime(50);
  h.doc.getText("markdown").insert(0, "other ");
  vi.advanceTimersByTime(50);
  const [conflicting, other] = writes(h.socket).map((frame) => readWrite(frame).id);
  h.socket.deliver(h.sub.docName, denial("update conflict"));
  h.socket.deliver(h.sub.docName, denial("unavailable"));
  expect(h.statuses.at(-1)).toBe("update_rejected");

  vi.advanceTimersByTime(5_000);
  expect(writes(h.socket).map((frame) => readWrite(frame).id)).toEqual([conflicting, other, other]);
  h.socket.deliver(h.sub.docName, receipt(other, "e1", 1));
  h.socket.deliver(h.sub.docName, progress("e1", 1));
  expect(
    h.events.filter((event) => event.coverage === "checkpointed").map((event) => event.updateId),
  ).toEqual([other]);
  expect(h.state().transportPending).toBe(true);

  const second = await reconnect(h);
  expect(writes(second)).toHaveLength(0);
  expect(h.statuses.at(-1)).toBe("update_rejected");
  h.destroy();
});

function syncFrame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

/** The rest of an attach after message 5, in the server's order: session state and the server's
 * SyncStep1 once, then the SyncStep2 that answers the client's SyncStep1. */
function finishAttach(socket: Socket, name: string, server: Y.Doc, state: Uint8Array) {
  socket.deliver(name, state);
  socket.deliver(
    name,
    syncFrame((encoder) => syncProtocol.writeSyncStep1(encoder, server)),
  );
  socket.deliver(
    name,
    syncFrame((encoder) => syncProtocol.writeSyncStep2(encoder, server)),
  );
}

/** Buffers every write sent on `socket` into `server` and answers each with a receipt. */
function acceptAll(socket: Socket, server: Y.Doc, epoch: string, firstSequence = 1) {
  const accepted = writes(socket).map(readWrite);
  accepted.forEach(({ docName, id, update }, index) => {
    Y.applyUpdate(server, update);
    socket.deliver(docName, receipt(id, epoch, firstSequence + index));
  });
  return accepted;
}

it("resends nothing after a reconnect whose session state shows every accepted update checkpointed", async () => {
  const h = await openDocument("restart-covered");
  const server = new Y.Doc();
  finishAttach(h.socket, h.sub.docName, server, session("e1"));
  h.doc.getText("markdown").insert(0, "first draft");
  vi.advanceTimersByTime(50);
  h.doc.getText("markdown").delete(0, "first ".length);
  vi.advanceTimersByTime(50);
  acceptAll(h.socket, server, "e1");
  expect(h.state()).toMatchObject({ transportPending: false, checkpointPending: true });

  // The worker checkpoints the buffer while no backend serves the socket.
  const second = await reconnect(h);
  finishAttach(second, h.sub.docName, server, session("e1", 2, 2));
  expect(writes(second)).toHaveLength(0);
  expect(h.state()).toMatchObject({ transportPending: false, checkpointPending: false });
  server.destroy();
  h.destroy();
});

it("replays accepted updates once under their original ids when the session state names a new epoch", async () => {
  const h = await openDocument("restart-new-epoch");
  const server = new Y.Doc();
  finishAttach(h.socket, h.sub.docName, server, session("e1"));
  h.doc.getText("markdown").insert(0, "base one");
  vi.advanceTimersByTime(50);
  h.doc.getText("markdown").delete(0, "base ".length);
  vi.advanceTimersByTime(50);
  const accepted = acceptAll(h.socket, server, "e1");

  // The buffer is lost: the server falls back to an empty checkpoint under a new epoch.
  const checkpoint = new Y.Doc();
  const second = await reconnect(h);
  finishAttach(second, h.sub.docName, checkpoint, session("e2"));
  const resent = writes(second).map(readWrite);
  for (const original of accepted)
    expect(resent.filter((write) => write.id === original.id)).toEqual([original]);
  acceptAll(second, checkpoint, "e2");
  second.deliver(h.sub.docName, progress("e2", resent.length));
  expect(checkpoint.getText("markdown").toString()).toBe("one");
  expect(h.state()).toMatchObject({ transportPending: false, checkpointPending: false });
  checkpoint.destroy();
  server.destroy();
  h.destroy();
});

it.each(["e1", "e2"])(
  "resends an update that never got a receipt exactly once after a reconnect into epoch %s",
  async (epoch) => {
    const h = await openDocument(`unanswered-${epoch}`);
    const server = new Y.Doc();
    finishAttach(h.socket, h.sub.docName, server, session("e1"));
    h.doc.getText("markdown").insert(0, "unanswered");
    vi.advanceTimersByTime(50);
    const [sent] = writes(h.socket).map(readWrite);

    const second = await reconnect(h);
    finishAttach(second, h.sub.docName, server, session(epoch));
    const resent = writes(second).map(readWrite);
    expect(resent.filter((write) => write.id === sent.id)).toEqual([sent]);
    // Within one epoch the buffer lost nothing, so the sync answer adds no write of its own.
    if (epoch === "e1") expect(resent).toEqual([sent]);
    server.destroy();
    h.destroy();
  },
);

it("sends an edit made while offline once under its own id, never again inside the sync answer", async () => {
  const h = await openDocument("offline-edit");
  const server = new Y.Doc();
  finishAttach(h.socket, h.sub.docName, server, session("e1"));
  h.doc.getText("markdown").insert(0, "saved");
  vi.advanceTimersByTime(50);
  acceptAll(h.socket, server, "e1");
  h.socket.deliver(h.sub.docName, progress("e1", 1));

  h.socket.close(1006);
  h.doc.getText("markdown").insert(5, " offline");
  await vi.advanceTimersByTimeAsync(500);
  const second = Socket.instances.at(-1)!;
  second.open();
  second.receive(h.sub.docName, 5, "g");
  finishAttach(second, h.sub.docName, server, session("e1", 1, 1));
  expect(writes(second)).toHaveLength(1);
  acceptAll(second, server, "e1", 2);
  expect(server.getText("markdown").toString()).toBe("saved offline");
  server.destroy();
  h.destroy();
});

it("treats the session state a periodic resync repeats as no change", async () => {
  const h = await openDocument("resync");
  const server = new Y.Doc();
  finishAttach(h.socket, h.sub.docName, server, session("e1"));
  h.doc.getText("markdown").insert(0, "accepted");
  vi.advanceTimersByTime(50);
  h.doc.getText("markdown").delete(0, 1);
  vi.advanceTimersByTime(50);
  acceptAll(h.socket, server, "e1");
  const sent = writes(h.socket).length;
  const transitions = h.events.length;
  const state = h.state();

  for (let round = 0; round < 3; round++) {
    vi.advanceTimersByTime(30_000);
    h.socket.receive(h.sub.docName, 5, "g");
    h.socket.deliver(h.sub.docName, session("e1", 2, 0));
    h.socket.deliver(
      h.sub.docName,
      syncFrame((encoder) => syncProtocol.writeSyncStep2(encoder, server)),
    );
  }
  expect(writes(h.socket)).toHaveLength(sent);
  expect(h.events).toHaveLength(transitions);
  expect(h.state()).toBe(state);
  server.destroy();
  h.destroy();
});
