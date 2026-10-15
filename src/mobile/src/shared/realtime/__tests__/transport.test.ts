import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { encodeDocFrame, peekVarString } from "@shared/realtime/multiplex";

vi.mock("react-native", () => ({ AppState: { addEventListener: vi.fn() } }));
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
