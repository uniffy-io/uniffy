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
  constructor() {
    FakeSocket.sockets.push(this);
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
  deliver(payload: Uint8Array) {
    this.onmessage?.({ data: encodeDocFrame(NAME, payload).slice().buffer });
  }
  types(): number[] {
    return this.sent.map((frame) => frame[peekVarString(frame).payloadOffset]);
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

/** Answers the client's SyncStep1 the way the server does: generation, buffer state, document. */
function serve(socket: FakeSocket, server: Y.Doc, epoch?: string, head = 0, checkpoint = 0): void {
  if (socket.readyState !== FakeSocket.OPEN) socket.open();
  socket.deliver(encodeGeneration("G"));
  if (epoch)
    socket.deliver(
      encodeSessionState({
        generation: "G",
        epoch,
        headSequence: head,
        checkpointSequence: checkpoint,
        checkpointRevision: 1,
      }),
    );
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  syncProtocol.writeSyncStep2(encoder, server);
  socket.deliver(encoding.toUint8Array(encoder));
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

it("detaches after a drain timeout with the draft intact and finishes on the next run", async () => {
  const server = serverDoc("base");
  const editor = await openEditor(server);
  editor.send(() => editor.text.insert(4, " unacknowledged"));
  await editor.stored();
  kill();

  const app = await restart();
  await app.runMobileDrain("user", "org", () => true);
  serve(FakeSocket.sockets.at(-1)!, server);
  await vi.waitFor(() => expect(FakeSocket.sockets.at(-1)!.writes()).toHaveLength(1));
  vi.advanceTimersByTime(60_000);
  expect(app.realtimeMultiplexer.isAttached(NAME)).toBe(false);
  expect((await app.readStoredDrafts(KEY)).map((draft) => draft.text)).toEqual([
    "base unacknowledged",
  ]);

  await app.runMobileDrain("user", "org", () => true);
  const socket = FakeSocket.sockets.at(-1)!;
  serve(socket, server);
  await vi.waitFor(() => expect(socket.writes().length).toBeGreaterThan(0));
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
  const { hasUnsyncedEdits, onUnsyncedEditsCheck } = await import("@core/auth/sessionEvents");
  const { isDraftStorageActive, listDraftKeys, saveDraft } =
    await import("@shared/realtime/draftStorage");
  const stop = onUnsyncedEditsCheck(settleUnsyncedEdits);
  const bystander = serverDoc("bob's draft");
  await saveDraft("realtime.bob.org.NOTE.note", bystander);
  const editor = await openEditor(serverDoc("base"), "E1");
  editor.text.insert(4, " typed before sign-out");
  let unsynced: boolean | undefined;
  const checking = hasUnsyncedEdits("user").then((value) => (unsynced = value));
  const [write] = editor.socket.writes();
  editor.socket.deliver(receipt(write.id, "E1", 1));
  await editor.stored();
  expect(unsynced).toBeUndefined();
  editor.socket.deliver(progress("E1", 1));
  await checking;
  expect(unsynced).toBe(false);

  await signOutDrafts("user");
  expect(isDraftStorageActive("user")).toBe(false);
  expect(nativeStorage.databases.has("realtime-user.db")).toBe(false);
  expect(await listDraftKeys("bob")).toEqual(["realtime.bob.org.NOTE.note"]);
  bystander.destroy();
  stop();
});

it("reports accepted edits still unsaved after one checkpoint window and keeps them", async () => {
  const { SIGN_OUT_SETTLE_MS, settleUnsyncedEdits } = await import("@shared/realtime/drain");
  const { hasUnsyncedEdits, onUnsyncedEditsCheck } = await import("@core/auth/sessionEvents");
  const { readRetainedUpdates } = await import("@shared/realtime/draftStorage");
  const stop = onUnsyncedEditsCheck(settleUnsyncedEdits);
  const editor = await openEditor(serverDoc("base"), "E1");
  editor.text.insert(4, " accepted, never saved");
  let unsynced: boolean | undefined;
  const checking = hasUnsyncedEdits("user").then((value) => (unsynced = value));
  const [write] = editor.socket.writes();
  editor.socket.deliver(receipt(write.id, "E1", 1));
  await editor.stored();
  vi.advanceTimersByTime(SIGN_OUT_SETTLE_MS - 1);
  await Promise.resolve();
  expect(unsynced).toBeUndefined();
  vi.advanceTimersByTime(1);
  await checking;
  expect(unsynced).toBe(true);
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
  await vi.waitFor(() => expect(socket.writes()).toHaveLength(1));
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
