import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import { encodeDocFrame, peekVarString } from "@shared/realtime/multiplex";

const lifecycle = vi.hoisted(() => ({
  onChange: undefined as ((state: string) => void) | undefined,
}));
vi.mock("react-native", () => ({
  AppState: {
    addEventListener: (_: string, callback: (state: string) => void) => {
      lifecycle.onChange = callback;
    },
  },
}));
vi.mock("@core/auth/auth", () => ({ getAccessToken: () => "token" }));
vi.mock("@core/auth/refresh", () => ({ refreshSession: vi.fn() }));
vi.mock("@core/auth/sessionEvents", () => ({ onSessionExpired: vi.fn() }));
vi.mock("@core/api/connectivity", () => ({ addOnlineListener: vi.fn() }));
vi.mock("@core/config/serverUrl", () => ({ getServerUrl: () => "http://test.local" }));

class Socket {
  static instances: Socket[] = [];
  static OPEN = 1;
  readyState = 0;
  onopen?: () => void;
  onclose?: (event: { code: number }) => void;
  onmessage?: (event: { data: ArrayBuffer }) => void;
  sent: Uint8Array[] = [];
  constructor() {
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
  receive(name: string, type: number, text: string, scope?: number) {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, type);
    if (scope !== undefined) encoding.writeVarUint(enc, scope);
    encoding.writeVarString(enc, text);
    const frame = encodeDocFrame(name, encoding.toUint8Array(enc));
    this.onmessage?.({ data: frame.buffer as ArrayBuffer });
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "reconnects after proxy normal close and preserves explicit read-only=%s",
  async (readOnly) => {
    const { realtimeMultiplexer } = await import("@shared/realtime/multiplexer");
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
    vi.advanceTimersByTime(250);
    const writes = second.sent.filter((frame) => frame[peekVarString(frame).payloadOffset] === 6);
    expect(writes.length > 0).toBe(!readOnly);
    sub.destroy();
    awareness.destroy();
    doc.destroy();
  },
);

it("retains writes through reconnect and clears only matching acknowledgments", async () => {
  const { realtimeMultiplexer } = await import("@shared/realtime/multiplexer");
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const sub = realtimeMultiplexer.attach({
    contentType: "NOTE",
    contentId: "ack",
    organizationId: "org",
    ydoc: doc,
    awareness,
  });
  const first = Socket.instances[0];
  first.open();
  first.receive(sub.docName, 5, "g");
  doc.getText("markdown").insert(0, "pending");
  vi.advanceTimersByTime(250);
  const write = first.sent.find((frame) => frame[peekVarString(frame).payloadOffset] === 6)!;
  const decoder = decoding.createDecoder(write.subarray(peekVarString(write).payloadOffset));
  decoding.readVarUint(decoder);
  decoding.readVarString(decoder);
  const id = decoding.readVarString(decoder);
  expect(realtimeMultiplexer.isOutboundPending(sub.docName)).toBe(true);
  first.close(1006);
  await vi.advanceTimersByTimeAsync(500);
  const second = Socket.instances[1];
  second.open();
  second.receive(sub.docName, 5, "g");
  expect(second.sent.some((frame) => [...frame].join() === [...write].join())).toBe(true);
  second.receive(sub.docName, 7, "wrong");
  expect(realtimeMultiplexer.isOutboundPending(sub.docName)).toBe(true);
  second.receive(sub.docName, 7, id);
  expect(realtimeMultiplexer.isOutboundPending(sub.docName)).toBe(false);
  sub.destroy();
  awareness.destroy();
  doc.destroy();
});

async function openDocument(id: string) {
  const { realtimeMultiplexer } = await import("@shared/realtime/multiplexer");
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const pending = vi.fn();
  const sub = realtimeMultiplexer.attach({
    contentType: "NOTE",
    contentId: id,
    organizationId: "org",
    ydoc: doc,
    awareness,
    onPending: pending,
  });
  const socket = Socket.instances.at(-1)!;
  socket.open();
  socket.receive(sub.docName, 5, "g");
  return {
    realtimeMultiplexer,
    doc,
    sub,
    socket,
    pending,
    destroy() {
      sub.destroy();
      awareness.destroy();
      doc.destroy();
    },
  };
}

function writes(socket: Socket): Uint8Array[] {
  return socket.sent.filter((frame) => frame[peekVarString(frame).payloadOffset] === 6);
}

function acknowledge(socket: Socket, frame: Uint8Array): Uint8Array {
  const { docName, payloadOffset } = peekVarString(frame);
  const decoder = decoding.createDecoder(frame.subarray(payloadOffset));
  decoding.readVarUint(decoder);
  decoding.readVarString(decoder);
  const id = decoding.readVarString(decoder);
  const update = decoding.readVarUint8Array(decoder);
  socket.receive(docName, 7, id);
  return update;
}

it("batches continuous typing into four durable frames per second", async () => {
  const h = await openDocument("typing");
  const server = new Y.Doc();
  for (let i = 0; i < 20; i++) {
    h.doc.getText("markdown").insert(i, "x");
    expect(h.realtimeMultiplexer.isOutboundPending(h.sub.docName)).toBe(true);
    vi.advanceTimersByTime(50);
    expect(writes(h.socket)).toHaveLength(Math.floor((i + 1) / 5));
  }
  for (const frame of writes(h.socket)) Y.applyUpdate(server, acknowledge(h.socket, frame));
  expect(server.getText("markdown").toString()).toBe("x".repeat(20));
  expect(h.realtimeMultiplexer.isOutboundPending(h.sub.docName)).toBe(false);
  server.destroy();
  h.destroy();
});

it("does not clear buffered deletions when an older batch is acknowledged", async () => {
  const h = await openDocument("deletion");
  const text = h.doc.getText("markdown");
  text.insert(0, "delete me");
  vi.advanceTimersByTime(250);
  text.delete(0, text.length);
  const server = new Y.Doc();
  Y.applyUpdate(server, acknowledge(h.socket, writes(h.socket)[0]));
  expect(h.pending).toHaveBeenLastCalledWith(true);
  expect(h.realtimeMultiplexer.isOutboundPending(h.sub.docName)).toBe(true);
  vi.advanceTimersByTime(250);
  Y.applyUpdate(server, acknowledge(h.socket, writes(h.socket)[1]));
  expect(server.getText("markdown").toString()).toBe("");
  expect(h.pending).toHaveBeenLastCalledWith(false);
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
    expect(h.realtimeMultiplexer.isOutboundPending(h.sub.docName)).toBe(true);
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
  expect(h.realtimeMultiplexer.isOutboundPending(h.sub.docName)).toBe(false);
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
  const frame = encodeDocFrame(h.sub.docName, encoding.toUint8Array(encoder));
  h.socket.onmessage?.({ data: frame.buffer as ArrayBuffer });
  expect(writes(h.socket)).toHaveLength(1);
  Y.applyUpdate(server, acknowledge(h.socket, writes(h.socket)[0]));
  vi.advanceTimersByTime(500);
  expect(writes(h.socket)).toHaveLength(1);
  expect(server.getText("markdown").toString()).toBe("recover");
  expect(h.realtimeMultiplexer.isOutboundPending(h.sub.docName)).toBe(false);
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
  expect(h.realtimeMultiplexer.isOutboundPending(h.sub.docName)).toBe(false);
  server.destroy();
  h.destroy();
});
