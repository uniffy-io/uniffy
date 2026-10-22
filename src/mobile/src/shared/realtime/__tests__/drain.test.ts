import { nativeStorage } from "@shared/realtime/__tests__/storageHarness";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as syncProtocol from "y-protocols/sync";
import { encodeDocFrame, peekVarString } from "@shared/realtime/multiplex";
import {
  encodeAcceptedReceipt,
  encodeCheckpointProgress,
  encodeCommitted,
  encodeGeneration,
  encodeSessionState,
} from "@shared/realtime/protocol";

const lifecycle = vi.hoisted(() => ({ change: (_state: string) => {} }));
vi.mock("react-native", () => ({
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, listener: (state: string) => void) => {
      lifecycle.change = listener;
      return { remove: () => {} };
    },
  },
  Platform: { OS: "ios", Version: "18" },
}));
vi.mock("expo-constants", () => ({ default: { expoConfig: { version: "0" } } }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));

const NAME = "NOTE:note";
const KEY = "realtime.user.org.NOTE.note";

class FakeSocket {
  static OPEN = 1;
  static sockets: FakeSocket[] = [];
  readyState = 0;
  binaryType = "";
  sent: Uint8Array[] = [];
  onopen?: () => void;
  onclose?: (event: { code: number }) => void;
  onmessage?: (event: { data: ArrayBuffer }) => void;
  constructor(public url: string) {
    FakeSocket.sockets.push(this);
  }
  get organizationId(): string | null {
    return new URL(this.url).searchParams.get("org_id");
  }
  /** Names of the documents this socket carried any frame for. */
  docNames(): string[] {
    return [...new Set(this.sent.map((frame) => peekVarString(frame).docName))];
  }
  send(frame: Uint8Array) {
    this.sent.push(frame);
  }
  open() {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  deliver(payload: Uint8Array, name = NAME) {
    this.onmessage?.({ data: encodeDocFrame(name, payload).slice().buffer });
  }
  types(): number[] {
    return this.sent.map((frame) => frame[peekVarString(frame).payloadOffset]);
  }
  /** State vector of the latest SyncStep1 the client sent. */
  stateVector(): Uint8Array | undefined {
    for (const frame of [...this.sent].reverse()) {
      const decoder = decoding.createDecoder(frame.subarray(peekVarString(frame).payloadOffset));
      if (decoding.readVarUint(decoder) !== 0) continue;
      if (decoding.readVarUint(decoder) !== syncProtocol.messageYjsSyncStep1) continue;
      return decoding.readVarUint8Array(decoder);
    }
    return undefined;
  }
  writes(): { id: string; update: Uint8Array }[] {
    return this.sent.flatMap((frame) => {
      const decoder = decoding.createDecoder(frame.subarray(peekVarString(frame).payloadOffset));
      if (decoding.readVarUint(decoder) !== 6) return [];
      decoding.readVarString(decoder);
      return [{ id: decoding.readVarString(decoder), update: decoding.readVarUint8Array(decoder) }];
    });
  }
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  FakeSocket.sockets = [];
  downloads = [];
  vi.stubGlobal("WebSocket", FakeSocket);
  nativeStorage.secure.clear();
  for (const database of nativeStorage.databases.values()) database.close();
  nativeStorage.databases.clear();
  nativeStorage.failInsert = false;
});
afterEach(async () => {
  (await import("@shared/realtime/drain")).stopMobileDrains();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function serverDoc(text: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap("doc_meta").set("generation", "G");
  doc.getText("markdown").insert(0, text);
  return doc;
}

const receipt = (updateId: string, epoch: string, acceptedSequence: number) =>
  encodeAcceptedReceipt({ updateId, generation: "G", epoch, acceptedSequence });
const progress = (epoch: string, coveredSequence: number) =>
  encodeCheckpointProgress({ generation: "G", epoch, coveredSequence, checkpointRevision: 2 });

// Every update the server sent in a SyncStep2, oldest first.
let downloads: Uint8Array[] = [];

function holdsStructsMissingFrom(server: Y.Doc, clientState: Uint8Array): boolean {
  const held = Y.decodeStateVector(Y.encodeStateVector(server));
  for (const [client, clock] of Y.decodeStateVector(clientState))
    if (clock > (held.get(client) ?? 0)) return true;
  return false;
}

/** Answers the client's SyncStep1 the way the server does: generation, buffer state, its own
 * SyncStep1 when the client holds structs it lacks, then what the client lacks. */
function serve(
  socket: FakeSocket,
  server: Y.Doc,
  epoch?: string,
  head = 0,
  checkpoint = 0,
  name = NAME,
): void {
  if (socket.readyState !== FakeSocket.OPEN) socket.open();
  socket.deliver(encodeGeneration("G"), name);
  if (epoch)
    socket.deliver(
      encodeSessionState({
        generation: "G",
        epoch,
        headSequence: head,
        checkpointSequence: checkpoint,
        checkpointRevision: 1,
      }),
      name,
    );
  const clientState = socket.stateVector();
  if (!clientState || holdsStructsMissingFrom(server, clientState)) {
    const ask = encoding.createEncoder();
    encoding.writeVarUint(ask, 0);
    syncProtocol.writeSyncStep1(ask, server);
    socket.deliver(encoding.toUint8Array(ask), name);
  }
  const update = Y.encodeStateAsUpdate(server, clientState);
  downloads.push(update);
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  encoding.writeVarUint(encoder, syncProtocol.messageYjsSyncStep2);
  encoding.writeVarUint8Array(encoder, update);
  socket.deliver(encoding.toUint8Array(encoder), name);
}

function viewDenial(): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 2);
  encoding.writeVarUint(encoder, 1);
  encoding.writeVarString(encoder, "no view access");
  return encoding.toUint8Array(encoder);
}

/** The editor contract: snapshot every local edit and retain the coverage of every own update. */
async function openEditor(server: Y.Doc, epoch?: string) {
  const { realtimeMultiplexer, REMOTE_ORIGIN } = await import("@shared/realtime/multiplexer");
  const { saveDraft } = await import("@shared/realtime/draftStorage");
  const { retainCoverage } = await import("@shared/realtime/drain");
  (await import("@core/auth/auth")).setAccessToken("token");
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const writes: Promise<void>[] = [];
  doc.on("update", (_update: Uint8Array, origin: unknown) => {
    if (origin !== REMOTE_ORIGIN && doc.getMap("doc_meta").get("generation"))
      writes.push(saveDraft(KEY, doc));
  });
  const retain = retainCoverage(KEY, NAME);
  const subscription = realtimeMultiplexer.attach({
    contentType: "NOTE",
    contentId: "note",
    organizationId: "org",
    ydoc: doc,
    awareness,
    onCoverage: (events) => writes.push(retain(events)),
  });
  const socket = FakeSocket.sockets.at(-1)!;
  serve(socket, server, epoch);
  const text = doc.getText("markdown");
  return {
    socket,
    text,
    /** Types, lets the batch window pass and returns the id of the frame that carried it. */
    send(edit: () => void) {
      edit();
      vi.advanceTimersByTime(50);
      return socket.writes().at(-1)!.id;
    },
    stored: () => Promise.all(writes),
    /** Done on an editor with pending work: detach, then store the device copy. */
    async close() {
      subscription.destroy();
      await saveDraft(KEY, doc);
      awareness.destroy();
      doc.destroy();
    },
  };
}

/** The process dies: no timer fires again and every module starts fresh from device storage. */
function kill(): void {
  vi.clearAllTimers();
  vi.resetModules();
}

async function restart() {
  (await import("@core/auth/auth")).setAccessToken("token");
  return {
    ...(await import("@shared/realtime/drain")),
    ...(await import("@shared/realtime/draftStorage")),
    realtimeMultiplexer: (await import("@shared/realtime/multiplexer")).realtimeMultiplexer,
  };
}

it("restores an accepted delete-only edit after a force kill and a lost server buffer", async () => {
  const server = serverDoc("remove me");
  const editor = await openEditor(server, "E1");
  const deletion = editor.send(() => editor.text.delete(0, editor.text.length));
  const [write] = editor.socket.writes();
  expect(Y.decodeUpdate(write.update).structs).toEqual([]);
  editor.socket.deliver(receipt(deletion, "E1", 1));
  await editor.stored();
  kill();

  const app = await restart();
  await app.runMobileDrain("user", "org", () => true);
  const socket = FakeSocket.sockets.at(-1)!;
  // The buffer lost the deletion; the server reset its epoch and still has the text.
  serve(socket, server, "E2");
  await vi.waitFor(() => expect(socket.writes().map((frame) => frame.id)).toEqual([deletion]));
  Y.applyUpdate(server, socket.writes()[0].update);
  expect(server.getText("markdown").toString()).toBe("");

  socket.deliver(receipt(deletion, "E2", 1));
  vi.advanceTimersByTime(1_000);
  expect(app.realtimeMultiplexer.isAttached(NAME)).toBe(true);
  expect((await app.readRetainedUpdates(KEY, "G")).map((update) => update.updateId)).toEqual([
    deletion,
  ]);
  socket.deliver(progress("E2", 1));
  await vi.waitFor(async () => expect(await app.listDraftKeys("user")).toEqual([]));
  expect(app.realtimeMultiplexer.isAttached(NAME)).toBe(false);
});

it("retires only checkpointed updates and replays the rest under their ids after a restart", async () => {
  const server = serverDoc("base");
  const editor = await openEditor(server, "E1");
  const first = editor.send(() => editor.text.insert(4, " first"));
  const second = editor.send(() => editor.text.insert(10, " second"));
  for (const write of editor.socket.writes()) Y.applyUpdate(server, write.update);
  editor.socket.deliver(receipt(first, "E1", 1));
  editor.socket.deliver(receipt(second, "E1", 2));
  editor.socket.deliver(progress("E1", 1));
  await editor.stored();
  kill();

  const app = await restart();
  expect((await app.readRetainedUpdates(KEY, "G")).map((update) => update.updateId)).toEqual([
    second,
  ]);
  await app.runMobileDrain("user", "org", () => true);
  const socket = FakeSocket.sockets.at(-1)!;
  // The buffer still holds both edits; the replay keeps its original sequence.
  serve(socket, server, "E1", 2, 1);
  await vi.waitFor(() => expect(socket.writes().map((frame) => frame.id)).toEqual([second]));
  socket.deliver(receipt(second, "E1", 2));
  vi.advanceTimersByTime(1_000);
  expect((await app.listDraftKeys("user")).length).toBe(1);
  socket.deliver(progress("E1", 2));
  await vi.waitFor(async () => expect(await app.listDraftKeys("user")).toEqual([]));
  expect(server.getText("markdown").toString()).toBe("base first second");
});

it("hands a closed editor's accepted edits to a drain that clears only on checkpoint", async () => {
  const { handOffSavedDrafts } = await import("@shared/realtime/drain");
  const { realtimeMultiplexer } = await import("@shared/realtime/multiplexer");
  const { listDraftKeys } = await import("@shared/realtime/draftStorage");
  const stop = handOffSavedDrafts("user", "org", () => true);
  const server = serverDoc("base");
  const editor = await openEditor(server, "E1");
  const accepted = editor.send(() => editor.text.insert(4, " accepted"));
  Y.applyUpdate(server, editor.socket.writes()[0].update);
  editor.socket.deliver(receipt(accepted, "E1", 1));
  await editor.stored();
  expect(realtimeMultiplexer.getDocState(NAME)).toMatchObject({ checkpointPending: true });
  await editor.close();

  await vi.waitFor(() => expect(realtimeMultiplexer.isAttached(NAME)).toBe(true));
  const before = editor.socket.writes().length;
  serve(editor.socket, server, "E1");
  await vi.waitFor(() =>
    expect(
      editor.socket
        .writes()
        .slice(before)
        .map((frame) => frame.id),
    ).toEqual([accepted]),
  );
  editor.socket.deliver(receipt(accepted, "E1", 1));
  vi.advanceTimersByTime(1_000);
  expect(await listDraftKeys("user")).toEqual([KEY]);
  editor.socket.deliver(progress("E1", 1));
  await vi.waitFor(async () => expect(await listDraftKeys("user")).toEqual([]));
  stop();
});

it("attaches without presence and never asks peers to announce theirs", async () => {
  const server = serverDoc("base");
  const editor = await openEditor(server, "E1");
  editor.send(() => editor.text.insert(4, " headless"));
  await editor.stored();
  kill();

  const app = await restart();
  const [retained] = await app.readRetainedUpdates(KEY, "G");
  await app.runMobileDrain("user", "org", () => true);
  const socket = FakeSocket.sockets.at(-1)!;
  serve(socket, server, "E1");
  await vi.waitFor(() =>
    expect(socket.writes().map((write) => write.id)).toContain(retained.updateId),
  );
  expect(socket.types()[0]).toBe(0);
  expect(socket.types()).not.toContain(1);
  expect(socket.types()).not.toContain(3);
  for (const write of socket.writes()) socket.deliver(encodeCommitted(write.id));
  await vi.waitFor(async () => expect(await app.listDraftKeys("user")).toEqual([]));
});

it("detaches after a drain timeout with the draft intact and finishes on the next run", async () => {
  const server = serverDoc("base");
  const editor = await openEditor(server);
  editor.send(() => editor.text.insert(4, " unacknowledged"));
  await editor.stored();
  kill();

  const app = await restart();
  await app.runMobileDrain("user", "org", () => true);
  serve(FakeSocket.sockets.at(-1)!, server);
  await vi.waitFor(() => expect(FakeSocket.sockets.at(-1)!.writes().length).toBeGreaterThan(0));
  vi.advanceTimersByTime(app.DRAIN_TIMEOUT_MS);
  expect(app.realtimeMultiplexer.isAttached(NAME)).toBe(false);
  expect((await app.readStoredDrafts(KEY)).map((draft) => draft.text)).toEqual([
    "base unacknowledged",
  ]);

  vi.advanceTimersByTime(app.DRAIN_BACKOFF_MS);
  const [retained] = await app.readRetainedUpdates(KEY, "G");
  await app.runMobileDrain("user", "org", () => true);
  const socket = FakeSocket.sockets.at(-1)!;
  serve(socket, server);
  await vi.waitFor(() =>
    expect(socket.writes().map((write) => write.id)).toContain(retained.updateId),
  );
  for (const write of socket.writes()) {
    Y.applyUpdate(server, write.update);
    socket.deliver(encodeCommitted(write.id));
  }
  await vi.waitFor(async () => expect(await app.listDraftKeys("user")).toEqual([]));
  expect(server.getText("markdown").toString()).toBe("base unacknowledged");
});

it("drains a draft row stored before retained updates existed, within its user and organization", async () => {
  const { saveDraft } = await import("@shared/realtime/draftStorage");
  const server = serverDoc("base");
  const offline = new Y.Doc();
  Y.applyUpdate(offline, Y.encodeStateAsUpdate(server));
  offline.getText("markdown").insert(4, " offline");
  const otherOrganization = "realtime.user.other.NOTE.note";
  const otherUser = "realtime.bob.org.NOTE.note";
  for (const key of [KEY, otherOrganization, otherUser]) await saveDraft(key, offline);
  nativeStorage.databases.get("realtime-user.db")!.exec("DROP TABLE updates");
  kill();

  const app = await restart();
  await app.runMobileDrain("user", "org", () => true);
  const socket = FakeSocket.sockets.at(-1)!;
  serve(socket, server, "E1");
  await vi.waitFor(() => expect(socket.writes()).toHaveLength(1));
  const [replay] = socket.writes();
  Y.applyUpdate(server, replay.update);
  expect(server.getText("markdown").toString()).toBe("base offline");
  await vi.waitFor(async () =>
    expect((await app.readRetainedUpdates(KEY, "G")).map((update) => update.updateId)).toEqual([
      replay.id,
    ]),
  );
  socket.deliver(receipt(replay.id, "E1", 1));
  socket.deliver(progress("E1", 1));
  await vi.waitFor(async () =>
    expect(await app.listDraftKeys("user")).toEqual([otherOrganization]),
  );
  expect(await app.listDraftKeys("bob")).toEqual([otherUser]);
  offline.destroy();
});

it("flushes edits and their device copy when the app leaves the foreground, and nothing more", async () => {
  const { readRetainedUpdates } = await import("@shared/realtime/draftStorage");
  const editor = await openEditor(serverDoc("base"), "E1");
  const before = editor.socket.sent.length;
  editor.text.insert(4, " last words");
  lifecycle.change("inactive");
  expect(editor.socket.types().slice(before)).toEqual([6]);
  await editor.stored();
  expect((await readRetainedUpdates(KEY, "G")).map((update) => update.updateId)).toEqual([
    editor.socket.writes()[0].id,
  ]);
  vi.advanceTimersByTime(1_000);
  expect(editor.socket.sent.length).toBe(before + 1);
});

it("waits for the checkpoint before sign-out, then deletes only that user's drafts", async () => {
  const { settleUnsyncedEdits, signOutDrafts } = await import("@shared/realtime/drain");
  const { listUnsyncedOrganizations, onUnsyncedEditsCheck } =
    await import("@core/auth/sessionEvents");
  const { isDraftStorageActive, listDraftKeys, saveDraft } =
    await import("@shared/realtime/draftStorage");
  const stop = onUnsyncedEditsCheck(settleUnsyncedEdits);
  const bystander = serverDoc("bob's draft");
  await saveDraft("realtime.bob.org.NOTE.note", bystander);
  const editor = await openEditor(serverDoc("base"), "E1");
  editor.text.insert(4, " typed before sign-out");
  let unsynced: string[] | undefined;
  const checking = listUnsyncedOrganizations("user").then((value) => (unsynced = value));
  const [write] = editor.socket.writes();
  editor.socket.deliver(receipt(write.id, "E1", 1));
  await editor.stored();
  expect(unsynced).toBeUndefined();
  editor.socket.deliver(progress("E1", 1));
  await checking;
  expect(unsynced).toEqual([]);

  await signOutDrafts("user");
  expect(isDraftStorageActive("user")).toBe(false);
  expect(nativeStorage.databases.has("realtime-user.db")).toBe(false);
  expect(await listDraftKeys("bob")).toEqual(["realtime.bob.org.NOTE.note"]);
  bystander.destroy();
  stop();
});

it("reports accepted edits still unsaved after one checkpoint window and keeps them", async () => {
  const { SIGN_OUT_SETTLE_MS, settleUnsyncedEdits } = await import("@shared/realtime/drain");
  const { listUnsyncedOrganizations, onUnsyncedEditsCheck } =
    await import("@core/auth/sessionEvents");
  const { readRetainedUpdates } = await import("@shared/realtime/draftStorage");
  const stop = onUnsyncedEditsCheck(settleUnsyncedEdits);
  const editor = await openEditor(serverDoc("base"), "E1");
  editor.text.insert(4, " accepted, never saved");
  let unsynced: string[] | undefined;
  const checking = listUnsyncedOrganizations("user").then((value) => (unsynced = value));
  const [write] = editor.socket.writes();
  editor.socket.deliver(receipt(write.id, "E1", 1));
  await editor.stored();
  vi.advanceTimersByTime(SIGN_OUT_SETTLE_MS - 1);
  await Promise.resolve();
  expect(unsynced).toBeUndefined();
  vi.advanceTimersByTime(1);
  await checking;
  expect(unsynced).toEqual(["org"]);
  expect((await readRetainedUpdates(KEY, "G")).map((update) => update.updateId)).toEqual([
    write.id,
  ]);
  stop();
});

it.each(["denial", "handoff"])("keeps the draft when a drain ends by %s", async (reason) => {
  const server = serverDoc("base");
  const editor = await openEditor(server);
  editor.send(() => editor.text.insert(4, " kept"));
  await editor.stored();
  kill();

  const app = await restart();
  await app.runMobileDrain("user", "org", () => true);
  const socket = FakeSocket.sockets.at(-1)!;
  serve(socket, server);
  await vi.waitFor(() => expect(socket.writes().length).toBeGreaterThan(0));
  if (reason === "denial") {
    const denial = encoding.createEncoder();
    encoding.writeVarUint(denial, 2);
    encoding.writeVarUint(denial, 0);
    encoding.writeVarString(denial, "edit access removed");
    socket.deliver(encoding.toUint8Array(denial));
  } else app.abortMobileDrain(NAME);
  expect(app.realtimeMultiplexer.isAttached(NAME)).toBe(false);
  expect((await app.readStoredDrafts(KEY)).map((draft) => draft.text)).toEqual(["base kept"]);
});

it("keeps the device copy as a recovered draft no drain replays once the document answers no view access", async () => {
  const server = serverDoc("base");
  const editor = await openEditor(server, "E1");
  const kept = editor.send(() => editor.text.insert(4, " kept"));
  editor.socket.deliver(receipt(kept, "E1", 1));
  await editor.stored();
  kill();

  const app = await restart();
  await app.runMobileDrain("user", "org", () => true);
  const socket = FakeSocket.sockets.at(-1)!;
  socket.open();
  // Deleted or unshared: the server answers the attach with a denial and nothing else.
  socket.deliver(viewDenial());
  expect(app.realtimeMultiplexer.isAttached(NAME)).toBe(false);
  // The device never learned which of its edits the server accepted, so it keeps them all.
  await vi.waitFor(async () =>
    expect(
      (await app.readStoredDrafts(KEY)).map((draft) => [
        draft.generation.split(":")[0],
        draft.text,
      ]),
    ).toEqual([["recovery", "base kept"]]),
  );
  expect(await app.readRetainedUpdates(KEY, "G")).toEqual([]);
  expect(socket.writes()).toEqual([]);

  await app.runMobileDrain("user", "org", () => true);
  expect(app.realtimeMultiplexer.isAttached(NAME)).toBe(false);
  expect(await app.listDraftKeys("user")).toEqual([KEY]);
});

it("drops the device copy once the document answers no view access after this socket showed every edit accepted", async () => {
  const server = serverDoc("base");
  const editor = await openEditor(server, "E1");
  const accepted = editor.send(() => editor.text.insert(4, " accepted"));
  Y.applyUpdate(server, editor.socket.writes()[0].update);
  editor.socket.deliver(receipt(accepted, "E1", 1));
  await editor.stored();
  kill();

  const app = await restart();
  await app.runMobileDrain("user", "org", () => true);
  const socket = FakeSocket.sockets.at(-1)!;
  serve(socket, server, "E1", 1);
  await vi.waitFor(() => expect(socket.writes().map((write) => write.id)).toEqual([accepted]));
  socket.deliver(receipt(accepted, "E1", 1));
  socket.deliver(viewDenial());
  await vi.waitFor(async () => expect(await app.listDraftKeys("user")).toEqual([]));
  expect(await app.readStoredDrafts(KEY)).toEqual([]);
});

it("re-attaches a stuck document only after a doubling backoff and downloads only what changed", async () => {
  const server = serverDoc("base");
  const editor = await openEditor(server, "E1");
  const accepted = editor.send(() => editor.text.insert(4, " accepted, never checkpointed"));
  Y.applyUpdate(server, editor.socket.writes()[0].update);
  editor.socket.deliver(receipt(accepted, "E1", 1));
  await editor.stored();
  kill();

  const app = await restart();
  const attempt = async (checkpoint: boolean) => {
    await app.runMobileDrain("user", "org", () => true);
    expect(app.realtimeMultiplexer.isAttached(NAME)).toBe(true);
    const socket = FakeSocket.sockets.at(-1)!;
    serve(socket, server, "E1", 1);
    // The attaching SyncStep1 carried the device copy, so the answer holds no struct it has.
    expect(Y.decodeUpdate(downloads.at(-1)!).structs).toEqual([]);
    await vi.waitFor(() => expect(socket.writes().map((write) => write.id)).toContain(accepted));
    socket.deliver(receipt(accepted, "E1", 1));
    if (checkpoint) socket.deliver(progress("E1", 1));
    else vi.advanceTimersByTime(app.DRAIN_TIMEOUT_MS);
    await vi.waitFor(() => expect(app.realtimeMultiplexer.isAttached(NAME)).toBe(false));
  };
  const waiting = async () => {
    await app.runMobileDrain("user", "org", () => true);
    return !app.realtimeMultiplexer.isAttached(NAME);
  };

  await attempt(false);
  expect(await waiting()).toBe(true);
  vi.advanceTimersByTime(app.DRAIN_BACKOFF_MS);
  await attempt(false);
  vi.advanceTimersByTime(app.DRAIN_BACKOFF_MS);
  expect(await waiting()).toBe(true);
  vi.advanceTimersByTime(app.DRAIN_BACKOFF_MS);
  await attempt(true);
  await vi.waitFor(async () => expect(await app.listDraftKeys("user")).toEqual([]));
});

it("stops at a replaced generation when its device copy names no generation, sending nothing", async () => {
  const { deleteEncryptedDrafts, encryptedDraftRecords } =
    await import("@shared/realtime/encryptedDraftStore");
  const server = serverDoc("base");
  const editor = await openEditor(server, "E1");
  editor.send(() => editor.text.insert(4, " typed for G"));
  await editor.stored();
  // Only the retained update survives, as after a crash before the full copy landed.
  await deleteEncryptedDrafts(
    KEY,
    (await encryptedDraftRecords(KEY)).map((record) => record.id),
  );
  kill();

  const app = await restart();
  expect((await app.readStoredDrafts(KEY)).map((draft) => [draft.id, draft.generation])).toEqual([
    ["retained.G", "G"],
  ]);
  await app.runMobileDrain("user", "org", () => true);
  const socket = FakeSocket.sockets.at(-1)!;
  socket.open();
  const replacement = new Y.Doc();
  replacement.getMap("doc_meta").set("generation", "H");
  replacement.getText("markdown").insert(0, "replacement");
  socket.deliver(encodeGeneration("H"));
  const ask = encoding.createEncoder();
  encoding.writeVarUint(ask, 0);
  syncProtocol.writeSyncStep1(ask, replacement);
  socket.deliver(encoding.toUint8Array(ask));
  vi.advanceTimersByTime(50);
  expect(socket.writes()).toEqual([]);
  expect(app.realtimeMultiplexer.isAttached(NAME)).toBe(false);
  expect((await app.readRetainedUpdates(KEY, "G")).length).toBe(1);
  replacement.destroy();
});

it("drains another organization's parked draft on that organization's socket after a switch", async () => {
  const { realtimeMultiplexer } = await import("@shared/realtime/multiplexer");
  const { listDraftKeys, readStoredDrafts, saveDraft } =
    await import("@shared/realtime/draftStorage");
  const { runMobileDrain } = await import("@shared/realtime/drain");
  (await import("@core/auth/auth")).setAccessToken("token");
  const parkedName = "NOTE:parked";
  const parkedKey = "realtime.user.org-b.NOTE.parked";
  const server = serverDoc("base");
  const offline = new Y.Doc();
  Y.applyUpdate(offline, Y.encodeStateAsUpdate(server));
  offline.getText("markdown").insert(4, " parked");
  await saveDraft(parkedKey, offline);

  // A note of the first organization was open and closed; its socket stays open while idle.
  const closed = new Y.Doc();
  const awareness = new Awareness(closed);
  const subscription = realtimeMultiplexer.attach({
    contentType: "NOTE",
    contentId: "note",
    organizationId: "org",
    ydoc: closed,
    awareness,
  });
  const first = FakeSocket.sockets[0];
  first.open();
  subscription.destroy();

  await runMobileDrain("user", "org-b", () => true);
  expect(realtimeMultiplexer.isAttached(parkedName)).toBe(true);
  expect(first.readyState).toBe(3);
  expect(first.docNames()).toEqual([NAME]);
  // The first organization's server would refuse the document; its socket is gone already.
  first.deliver(viewDenial(), parkedName);
  const socket = FakeSocket.sockets.at(-1)!;
  expect(socket.organizationId).toBe("org-b");
  serve(socket, server, "E1", 0, 0, parkedName);
  await vi.waitFor(() => expect(socket.writes()).toHaveLength(1));
  const [replay] = socket.writes();
  Y.applyUpdate(server, replay.update);
  expect(server.getText("markdown").toString()).toBe("base parked");
  socket.deliver(receipt(replay.id, "E1", 1), parkedName);
  socket.deliver(progress("E1", 1), parkedName);
  await vi.waitFor(async () => expect(await listDraftKeys("user")).toEqual([]));
  expect(await readStoredDrafts(parkedKey)).toEqual([]);
  awareness.destroy();
  closed.destroy();
  offline.destroy();
});

it("ends a drain of the previous organization as retry with its draft intact when the socket moves", async () => {
  const server = serverDoc("base");
  const editor = await openEditor(server);
  editor.send(() => editor.text.insert(4, " parked"));
  await editor.stored();
  kill();

  const app = await restart();
  const { emitAuthBoundary } = await import("@core/auth/sessionEvents");
  await app.runMobileDrain("user", "org", () => true);
  expect(app.realtimeMultiplexer.isAttached(NAME)).toBe(true);
  const socket = FakeSocket.sockets.at(-1)!;
  socket.open();
  emitAuthBoundary("org-b");
  const next = FakeSocket.sockets.at(-1)!;
  expect(next).not.toBe(socket);
  expect(next.organizationId).toBe("org-b");
  next.open();
  await vi.waitFor(() => expect(app.realtimeMultiplexer.isAttached(NAME)).toBe(false));
  // A late answer of the previous organization's server changes nothing.
  socket.deliver(viewDenial());
  expect(next.sent).toEqual([]);
  expect((await app.readStoredDrafts(KEY)).map((draft) => [draft.generation, draft.text])).toEqual([
    ["G", "base parked"],
  ]);
  expect((await app.readRetainedUpdates(KEY, "G")).length).toBe(1);
});
