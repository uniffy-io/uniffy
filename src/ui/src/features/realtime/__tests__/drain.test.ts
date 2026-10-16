import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import * as encoding from "lib0/encoding";
import {
  FakeRealtimeServer,
  FakeWebSocket,
  closeSockets,
  currentSocket,
  updateWrites,
  eventually,
  installBrowser,
  openEditor,
  signInDevice,
} from "@/features/realtime/persistence/__tests__/browser";
import { encodeDocFrame, peekVarString } from "@/features/realtime/multiplex";
import { AUTH_REFRESHED_EVENT } from "@/features/realtime/protocol";
import { realtimeMultiplexer } from "@/features/realtime/multiplexer";
import {
  attachEncryptedPersistence,
  discoverStoredPendingDocs,
  readRecoveredDrafts,
  REMOTE_ORIGIN,
} from "@/features/realtime/persistence/encryptedYjsPersistence";
import {
  clearPendingDocsFor,
  hasPendingDoc,
  listPendingDocs,
  recordPendingDoc,
  subscribePendingDocs,
  type PendingDoc,
} from "@/features/realtime/pendingDocs";
import {
  DRAIN_TIMEOUT_MS,
  abortDrain,
  drainDoc,
  runRealtimeDrain,
} from "@/features/realtime/drain";
import { hasUnsyncedEdits } from "@/features/realtime/unsyncedEdits";
import { teardownStorageEncryption } from "@/shared/crypto/storageEncryption";

const GENERATION = "3f9c1a52-7d4e-4b8a-9c61-0e2f5d8b7a14";
const BATCH_MS = 50;
const scope = { userId: "alice", organizationId: "org-1" };

beforeAll(() => installBrowser());

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await signInDevice("alice");
  clearPendingDocsFor("alice");
  clearPendingDocsFor("bob");
});

afterEach(() => {
  closeSockets();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => teardownStorageEncryption());

function entryFor(contentId: string, overrides: Partial<PendingDoc> = {}): PendingDoc {
  return { contentType: "TASK", contentId, ...scope, discardOnClean: true, ...overrides };
}

// A session that typed without a connection and closed: the rows a drain must settle.
async function strandRows(server: FakeRealtimeServer, contentId: string, text: string) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(server.doc), REMOTE_ORIGIN);
  const persistence = attachEncryptedPersistence({
    contentType: "TASK",
    contentId,
    ydoc: doc,
    scope: entryFor(contentId),
  });
  await persistence.hydrate({ serverGeneration: server.generation });
  doc.transact(() => doc.getText("markdown").insert(0, text), "session-id");
  await persistence.destroy();
  doc.destroy();
}

function deniedFrame(docName: string, reason: string): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 2);
  encoding.writeVarUint(encoder, 0);
  encoding.writeVarString(encoder, reason);
  return encodeDocFrame(docName, encoding.toUint8Array(encoder));
}

// What a later editor of the document would offer as recovered drafts.
async function offeredDrafts(server: FakeRealtimeServer, contentId: string): Promise<string[]> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(server.doc), REMOTE_ORIGIN);
  const persistence = attachEncryptedPersistence({ contentType: "TASK", contentId, ydoc: doc });
  const drafts = await readRecoveredDrafts(doc);
  await persistence.destroy();
  doc.destroy();
  return drafts.map(({ text }) => text);
}

// Starts a drain and answers its attach; resolves once the replay has been sent.
async function startDrain(server: FakeRealtimeServer, entry: PendingDoc) {
  const outcome = drainDoc(entry);
  const ws = currentSocket();
  if (ws.readyState !== WebSocket.OPEN) ws.open();
  server.attach(ws);
  await eventually(() =>
    expect(realtimeMultiplexer.getDocState(server.docName).checkpointPending).toBe(true),
  );
  vi.advanceTimersByTime(BATCH_MS);
  return { outcome, ws };
}

describe("pending doc registry", () => {
  it("records a doc once per name and exposes a stable snapshot", () => {
    recordPendingDoc(entryFor("a"));
    recordPendingDoc(entryFor("a"));
    const snapshot = listPendingDocs();
    expect(snapshot).toHaveLength(1);
    expect(listPendingDocs()).toBe(snapshot);
    expect(hasPendingDoc("TASK", "a")).toBe(true);
  });
});

describe("realtime drain", () => {
  it("yields to an editor without dropping its stored pending update", async () => {
    const server = new FakeRealtimeServer("TASK:handoff", GENERATION);
    await strandRows(server, "handoff", "pending during reopen");
    recordPendingDoc(entryFor("handoff"));
    runRealtimeDrain(scope);
    abortDrain("TASK:handoff");
    const doc = new Y.Doc();
    const persistence = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "handoff",
      ydoc: doc,
    });
    await persistence.hydrate({ serverGeneration: GENERATION });
    expect(doc.getText("markdown").toString()).toBe("pending during reopen");
    expect(hasPendingDoc("TASK", "handoff")).toBe(true);
    await persistence.destroy();
    doc.destroy();
  });

  it("resends stranded edits and keeps the entry until a checkpoint, not a receipt, covers them", async () => {
    const server = new FakeRealtimeServer("TASK:drained", GENERATION);
    await strandRows(server, "drained", "typed offline");
    recordPendingDoc(entryFor("drained"));
    const { outcome, ws } = await startDrain(server, entryFor("drained"));
    server.accept(ws);
    expect(server.text).toBe("typed offline");
    await eventually(async () => expect(await discoverStoredPendingDocs("alice")).toBe(true));
    expect(hasPendingDoc("TASK", "drained")).toBe(true);
    expect(realtimeMultiplexer.isAttached(server.docName)).toBe(true);

    server.checkpoint([ws]);
    expect(await outcome).toBe("drained");
    expect(hasPendingDoc("TASK", "drained")).toBe(false);
    expect(realtimeMultiplexer.isAttached(server.docName)).toBe(false);
    expect(await discoverStoredPendingDocs("alice")).toBe(false);
  });

  it("drains on a committed acknowledgment from a server that commits every write", async () => {
    const server = new FakeRealtimeServer("TASK:committed", GENERATION);
    await strandRows(server, "committed", "typed offline");
    recordPendingDoc(entryFor("committed"));
    const { outcome, ws } = await startDrain(server, entryFor("committed"));
    server.commit(ws);
    expect(await outcome).toBe("drained");
    expect(server.text).toBe("typed offline");
    expect(hasPendingDoc("TASK", "committed")).toBe(false);
  });

  it("keeps the entry and every row when no checkpoint arrives in time, then settles on a later run", async () => {
    const server = new FakeRealtimeServer("TASK:slow", GENERATION);
    await strandRows(server, "slow", "typed offline");
    recordPendingDoc(entryFor("slow"));
    const first = await startDrain(server, entryFor("slow"));
    const [write] = server.accept(first.ws);
    vi.advanceTimersByTime(DRAIN_TIMEOUT_MS);
    expect(await first.outcome).toBe("retry");
    expect(hasPendingDoc("TASK", "slow")).toBe(true);
    expect(await discoverStoredPendingDocs("alice")).toBe(true);

    const second = drainDoc(entryFor("slow"));
    const ws = currentSocket();
    if (ws.readyState !== WebSocket.OPEN) ws.open();
    server.attach(ws);
    await eventually(() =>
      expect(realtimeMultiplexer.getDocState(server.docName).checkpointPending).toBe(true),
    );
    vi.advanceTimersByTime(BATCH_MS);
    // Its receipt is still in the buffer, so the restored update is not resent.
    expect(updateWrites(ws, server.docName).map(({ id }) => id)).not.toContain(write.id);
    server.checkpoint([ws]);
    expect(await second).toBe("drained");
    expect(hasPendingDoc("TASK", "slow")).toBe(false);
  });

  it("keeps the entry and every row while the server forbids the connection, then drains with new credentials", async () => {
    const server = new FakeRealtimeServer("TASK:forbidden", GENERATION);
    await strandRows(server, "forbidden", "typed offline");
    recordPendingDoc(entryFor("forbidden"));
    const { outcome, ws } = await startDrain(server, entryFor("forbidden"));
    ws.serverClose(4403);
    expect(await outcome).toBe("retry");
    expect(hasPendingDoc("TASK", "forbidden")).toBe(true);
    expect(await discoverStoredPendingDocs("alice")).toBe(true);

    // The same credentials would be refused again, so a later drain opens no socket.
    const opened = FakeWebSocket.instances.length;
    const second = drainDoc(entryFor("forbidden"));
    expect(FakeWebSocket.instances).toHaveLength(opened);

    window.dispatchEvent(new Event(AUTH_REFRESHED_EVENT));
    const fresh = currentSocket();
    expect(fresh).not.toBe(ws);
    fresh.open();
    server.attach(fresh);
    // Local recovery has handed back every stored row, including the update the refused socket
    // carried.
    await eventually(() =>
      expect(realtimeMultiplexer.getDocState(server.docName).coverageKnown).toBe(true),
    );
    vi.advanceTimersByTime(BATCH_MS);
    server.commit(fresh);
    expect(await second).toBe("drained");
    expect(server.text).toBe("typed offline");
    expect(hasPendingDoc("TASK", "forbidden")).toBe(false);
  });

  it("hands a closed editor's accepted edits to the drain and holds sign-out until the checkpoint", async () => {
    // The authenticated shell drains whenever the registry changes.
    const unsubscribe = subscribePendingDocs(() => runRealtimeDrain(scope));
    const server = new FakeRealtimeServer("NOTE:closed", GENERATION);
    const editor = openEditor("closed", { discardOnClean: true });
    const ws = currentSocket();
    ws.open();
    server.attach(ws);
    await editor.hydrated;
    editor.type("accepted before Done");
    vi.advanceTimersByTime(BATCH_MS);
    const [write] = server.accept(ws);
    await editor.persistence.flush();
    await editor.close();

    expect(realtimeMultiplexer.isAttached("NOTE:closed")).toBe(true);
    expect(hasPendingDoc("NOTE", "closed")).toBe(true);
    expect(hasUnsyncedEdits("alice")).toBe(true);
    expect(await discoverStoredPendingDocs("alice")).toBe(true);
    server.attach(ws);
    await eventually(() =>
      expect(realtimeMultiplexer.getDocState("NOTE:closed")).toMatchObject({
        transportPending: false,
        checkpointPending: true,
      }),
    );
    expect(updateWrites(ws, "NOTE:closed").map(({ id }) => id)).toEqual([write.id]);
    expect(hasUnsyncedEdits("alice")).toBe(true);

    server.checkpoint([ws]);
    await eventually(() => expect(realtimeMultiplexer.isAttached("NOTE:closed")).toBe(false));
    expect(hasUnsyncedEdits("alice")).toBe(false);
    await eventually(async () => expect(await discoverStoredPendingDocs("alice")).toBe(false));
    unsubscribe();
  });

  it.each([
    ["after", false],
    ["before", true],
  ])(
    "offers unaccepted rows as a recovered draft and drops the entry when writes are denied %s the handshake",
    async (_, denialFirst) => {
      const contentId = `denied-${String(denialFirst)}`;
      const server = new FakeRealtimeServer(`TASK:${contentId}`, GENERATION);
      await strandRows(server, contentId, "typed offline");
      recordPendingDoc(entryFor(contentId));
      const outcome = drainDoc(entryFor(contentId));
      const ws = currentSocket();
      if (ws.readyState !== WebSocket.OPEN) ws.open();
      if (denialFirst) ws.receive(deniedFrame(server.docName, "read only"));
      server.attach(ws);
      if (!denialFirst) ws.receive(deniedFrame(server.docName, "read only"));
      expect(await outcome).toBe("retained");
      expect(hasPendingDoc("TASK", contentId)).toBe(false);
      expect(updateWrites(ws, server.docName)).toEqual([]);
      expect(await discoverStoredPendingDocs("alice")).toBe(true);
      expect(await offeredDrafts(server, contentId)).toEqual(["typed offline"]);
    },
  );

  it("attaches without presence and never asks peers to announce theirs", async () => {
    const server = new FakeRealtimeServer("TASK:headless", GENERATION);
    await strandRows(server, "headless", "typed offline");
    recordPendingDoc(entryFor("headless"));
    const { outcome, ws } = await startDrain(server, entryFor("headless"));
    const messageTypes = ws.sent.flatMap((frame) => {
      const { docName, payloadOffset } = peekVarString(frame);
      return docName === server.docName ? [frame[payloadOffset]] : [];
    });
    expect(messageTypes[0]).toBe(0);
    expect(messageTypes).not.toContain(1);
    expect(messageTypes).not.toContain(3);
    server.accept(ws);
    server.checkpoint([ws]);
    expect(await outcome).toBe("drained");
  });

  it("keeps the rows as a draft when the server generation moved on", async () => {
    const stale = new FakeRealtimeServer("TASK:moved", "G");
    await strandRows(stale, "moved", "typed offline");
    recordPendingDoc(entryFor("moved"));
    const replaced = new FakeRealtimeServer("TASK:moved", "H");
    const outcome = drainDoc(entryFor("moved"));
    const ws = currentSocket();
    if (ws.readyState !== WebSocket.OPEN) ws.open();
    replaced.attach(ws);
    await outcome;
    expect(realtimeMultiplexer.isAttached("TASK:moved")).toBe(false);
    expect(hasPendingDoc("TASK", "moved")).toBe(false);

    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(replaced.doc), REMOTE_ORIGIN);
    const persistence = attachEncryptedPersistence({
      contentType: "TASK",
      contentId: "moved",
      ydoc: doc,
    });
    expect(
      (await readRecoveredDrafts(doc)).map(({ generation, text }) => [generation, text]),
    ).toEqual([["G", "typed offline"]]);
    await persistence.destroy();
    doc.destroy();
  });

  it("skips a doc an open editor holds and docs of other users or organizations", async () => {
    const editor = openEditor("held");
    recordPendingDoc(entryFor("held", { contentType: "NOTE" }));
    recordPendingDoc(entryFor("other-user", { userId: "bob" }));
    recordPendingDoc(entryFor("other-org", { organizationId: "org-2" }));
    recordPendingDoc(entryFor("mine"));
    runRealtimeDrain(scope);
    expect(realtimeMultiplexer.isAttached("TASK:other-user")).toBe(false);
    expect(realtimeMultiplexer.isAttached("TASK:other-org")).toBe(false);
    expect(realtimeMultiplexer.isAttached("TASK:mine")).toBe(true);
    abortDrain("TASK:mine");
    expect(
      listPendingDocs()
        .map(({ contentId }) => contentId)
        .sort(),
    ).toEqual(["held", "mine", "other-org", "other-user"]);
    await editor.close();
  });
});
