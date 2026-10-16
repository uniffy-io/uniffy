import { vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { setMemoryAccessToken } from "@/config/api";
import { AUTH_STORAGE_KEY } from "@/features/auth/store/credentialStorage";
import { encodeDocFrame, peekVarString } from "@/features/realtime/multiplex";
import {
  realtimeMultiplexer,
  type DocSubscription,
  type MultiplexerAttachOptions,
} from "@/features/realtime/multiplexer";
import {
  MESSAGE_DURABLE_UPDATE,
  encodeAcceptedReceipt,
  encodeCheckpointProgress,
  encodeGeneration,
  encodeSessionState,
} from "@/features/realtime/protocol";

export const GENERATION = "3f9c1a52-7d4e-4b8a-9c61-0e2f5d8b7a14";
export const EPOCH = "E1";

export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  binaryType = "";
  sent: Uint8Array[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null = null;
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

  receive(docName: string, payload: Uint8Array): void {
    this.onmessage?.({ data: encodeDocFrame(docName, payload).slice().buffer } as MessageEvent);
  }

  serverClose(code: number): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code } as CloseEvent);
  }
}

/** Browser globals the transport touches; the server side is the fake socket above. */
export function installRealtimeGlobals(): void {
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), { location: { protocol: "http:", host: "test.local" } }),
  );
  vi.stubGlobal("document", {
    addEventListener: () => {},
    removeEventListener: () => {},
    visibilityState: "visible",
  });
  const storage = new Map([[AUTH_STORAGE_KEY, JSON.stringify({ currentOrganizationId: "org-1" })]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  setMemoryAccessToken("test-token");
}

export interface AttachedDoc {
  docName: string;
  ydoc: Y.Doc;
  subscription: DocSubscription;
}

const attached: AttachedDoc[] = [];

export function attachDoc(
  contentId: string,
  callbacks: Pick<MultiplexerAttachOptions, "onStatus" | "onCloseCode"> = {},
): AttachedDoc {
  const ydoc = new Y.Doc();
  const subscription = realtimeMultiplexer.attach({
    contentType: "TASK",
    contentId,
    ydoc,
    awareness: new Awareness(ydoc),
    ...callbacks,
  });
  const doc = { docName: subscription.docName, ydoc, subscription };
  attached.push(doc);
  return doc;
}

export function detachAll(): void {
  for (const doc of attached.splice(0)) doc.subscription.destroy();
}

/** Opens the shared socket if needed, then plays the server's attach handshake for one doc. */
export function connect(doc: AttachedDoc): FakeWebSocket {
  const ws = FakeWebSocket.instances.at(-1);
  if (!ws) throw new Error("no websocket opened");
  if (ws.readyState !== FakeWebSocket.OPEN) {
    ws.readyState = FakeWebSocket.OPEN;
    ws.onopen?.();
  }
  ws.receive(doc.docName, encodeGeneration(GENERATION));
  const sync = encoding.createEncoder();
  encoding.writeVarUint(sync, 0);
  syncProtocol.writeSyncStep2(sync, new Y.Doc());
  ws.receive(doc.docName, encoding.toUint8Array(sync));
  ws.receive(
    doc.docName,
    encodeSessionState({
      generation: GENERATION,
      epoch: EPOCH,
      headSequence: 0,
      checkpointSequence: 0,
      checkpointRevision: 0,
    }),
  );
  return ws;
}

export function lastUpdateId(ws: FakeWebSocket, doc: AttachedDoc): string {
  const ids: string[] = [];
  for (const frame of ws.sent) {
    const { docName, payloadOffset } = peekVarString(frame);
    const decoder = decoding.createDecoder(frame.subarray(payloadOffset));
    if (docName !== doc.docName || decoding.readVarUint(decoder) !== MESSAGE_DURABLE_UPDATE)
      continue;
    decoding.readVarString(decoder);
    ids.push(decoding.readVarString(decoder));
  }
  const id = ids.at(-1);
  if (!id) throw new Error(`no durable update sent for ${doc.docName}`);
  return id;
}

export function receipt(updateId: string, acceptedSequence: number): Uint8Array {
  return encodeAcceptedReceipt({
    updateId,
    generation: GENERATION,
    epoch: EPOCH,
    acceptedSequence,
  });
}

export function progress(coveredSequence: number): Uint8Array {
  return encodeCheckpointProgress({
    generation: GENERATION,
    epoch: EPOCH,
    coveredSequence,
    checkpointRevision: coveredSequence,
  });
}

/** Document-scoped write denial, as the server sends it for a refused update. */
export function denial(reason: string): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 2);
  encoding.writeVarUint(encoder, 0);
  encoding.writeVarString(encoder, reason);
  return encoding.toUint8Array(encoder);
}
