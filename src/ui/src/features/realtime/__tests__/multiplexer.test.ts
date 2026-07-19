import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { realtimeMultiplexer, type DocSubscription } from '@/features/realtime/multiplexer';
import { encodeDocFrame, peekVarString } from '@/features/realtime/multiplex';

vi.mock('@/config/api', () => ({
  getAccessToken: () => 'test-token',
}));

const MESSAGE_SYNC = 0;
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
  binaryType = '';
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
  if (!ws) throw new Error('no websocket opened');
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

function applyClientFramesToServer(ws: FakeWebSocket, docName: string, serverDoc: Y.Doc): void {
  for (const bytes of ws.sent) {
    const { docName: name, payloadOffset } = peekVarString(bytes);
    if (name !== docName) continue;
    const payload = bytes.subarray(payloadOffset);
    if (payload[0] !== MESSAGE_SYNC) continue;
    if (payload[1] !== SYNC_STEP2 && payload[1] !== SYNC_UPDATE) continue;
    const decoder = decoding.createDecoder(payload);
    decoding.readVarUint(decoder);
    const replyEncoder = encoding.createEncoder();
    syncProtocol.readSyncMessage(decoder, replyEncoder, serverDoc, 'server');
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

function attachDoc(contentId: string): AttachedDoc {
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  const onSync = vi.fn();
  const subscription = realtimeMultiplexer.attach({
    contentType: 'NOTE',
    contentId,
    ydoc,
    awareness,
    onSync,
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
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('window', {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { protocol: 'http:', host: 'test.local' },
  });
  vi.stubGlobal('document', {
    addEventListener: () => {},
    removeEventListener: () => {},
    visibilityState: 'visible',
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) =>
      key === 'persist:root'
        ? JSON.stringify({ auth: JSON.stringify({ currentOrganizationId: 'org-1' }) })
        : null,
  });
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

describe('read-only docs', () => {
  it('sends no SYNC write frames for local or hydration updates', () => {
    const doc = attachDoc('viewer-updates');
    currentWs().open();
    realtimeMultiplexer.setDocReadOnly(doc.docName, true);

    doc.ydoc.getText('markdown').insert(0, 'replayed from idb', undefined);

    const subtypes = sentSyncSubtypes(currentWs(), doc.docName);
    expect(subtypes).toContain(SYNC_STEP1);
    expect(subtypes).not.toContain(SYNC_STEP2);
    expect(subtypes).not.toContain(SYNC_UPDATE);
    expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(false);
  });

  it('suppresses the SyncStep2 reply even when the local doc has extra state', () => {
    const doc = attachDoc('viewer-handshake');
    currentWs().open();
    realtimeMultiplexer.setDocReadOnly(doc.docName, true);
    doc.ydoc.getText('markdown').insert(0, 'stale local state');

    const serverDoc = new Y.Doc();
    currentWs().receive(serverSyncStep1Frame(doc.docName, serverDoc));

    const subtypes = sentSyncSubtypes(currentWs(), doc.docName);
    expect(subtypes).not.toContain(SYNC_STEP2);
    expect(subtypes).not.toContain(SYNC_UPDATE);
  });
});

describe('handshake replies', () => {
  it('suppresses the no-op empty SyncStep2 reply when the docs are in sync', () => {
    const doc = attachDoc('in-sync');
    currentWs().open();

    const serverDoc = new Y.Doc();
    currentWs().receive(serverSyncStep1Frame(doc.docName, serverDoc));

    expect(sentSyncSubtypes(currentWs(), doc.docName)).not.toContain(SYNC_STEP2);
  });

  it('resolves sync when the server SyncStep2 arrives', () => {
    const doc = attachDoc('sync-resolution');
    currentWs().open();

    const serverDoc = new Y.Doc();
    currentWs().receive(serverSyncStep2Frame(doc.docName, serverDoc, Y.encodeStateVector(doc.ydoc)));

    expect(doc.onSync).toHaveBeenCalledTimes(1);
  });
});

describe('outbound pending tracking', () => {
  it('marks edits pending while connecting and clears them via the handshake reply', () => {
    const doc = attachDoc('offline-edit');
    const pendingStates: boolean[] = [];
    const unsubscribe = realtimeMultiplexer.subscribeOutboundPending(doc.docName, (pending) =>
      pendingStates.push(pending),
    );

    doc.ydoc.getText('markdown').insert(0, 'offline edit');
    expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(true);
    expect(pendingStates).toEqual([true]);

    currentWs().open();
    const serverDoc = new Y.Doc();
    currentWs().receive(serverSyncStep1Frame(doc.docName, serverDoc));

    expect(sentSyncSubtypes(currentWs(), doc.docName)).toContain(SYNC_STEP2);
    expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(false);
    expect(pendingStates).toEqual([true, false]);

    applyClientFramesToServer(currentWs(), doc.docName, serverDoc);
    expect(serverDoc.getText('markdown').toString()).toBe('offline edit');
    unsubscribe();
  });

  it('stays pending while socket bytes are buffered and clears once drained', () => {
    vi.useFakeTimers();
    const doc = attachDoc('buffered-edit');
    const ws = currentWs();
    ws.open();

    ws.bufferedAmount = 64;
    doc.ydoc.getText('markdown').insert(0, 'buffered');
    expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(true);
    expect(sentSyncSubtypes(ws, doc.docName)).toContain(SYNC_UPDATE);

    ws.bufferedAmount = 0;
    vi.advanceTimersByTime(300);
    expect(realtimeMultiplexer.isOutboundPending(doc.docName)).toBe(false);
  });
});
