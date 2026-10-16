import { nativeStorage } from "@shared/realtime/__tests__/storageHarness";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as Y from "yjs";
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
import type { DocSessionHandle } from "@shared/realtime/docSession";

vi.mock("react-native", () => ({
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) },
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
  writtenIds(): string[] {
    return this.sent.flatMap((frame) => {
      const { docName, payloadOffset } = peekVarString(frame);
      const decoder = decoding.createDecoder(frame.subarray(payloadOffset));
      if (docName !== NAME || decoding.readVarUint(decoder) !== 6) return [];
      decoding.readVarString(decoder);
      return [decoding.readVarString(decoder)];
    });
  }
}

const handles: DocSessionHandle[] = [];

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
  await Promise.all(handles.splice(0).map((handle) => handle.close()));
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function syncStep2From(server: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  syncProtocol.writeSyncStep2(encoder, server);
  return encoding.toUint8Array(encoder);
}

function syncStep2(): Uint8Array {
  const server = new Y.Doc();
  server.getMap("doc_meta").set("generation", "G");
  server.getText("markdown").insert(0, "base");
  const step = syncStep2From(server);
  server.destroy();
  return step;
}

const receipt = (updateId: string, acceptedSequence: number) =>
  encodeAcceptedReceipt({ updateId, generation: "G", epoch: "E", acceptedSequence });
const progress = (coveredSequence: number) =>
  encodeCheckpointProgress({ generation: "G", epoch: "E", coveredSequence, checkpointRevision: 1 });
const sessionState = (headSequence = 0, checkpointSequence = 0) =>
  encodeSessionState({
    generation: "G",
    epoch: "E",
    headSequence,
    checkpointSequence,
    checkpointRevision: checkpointSequence,
  });

async function openNote({ withSessionState = true } = {}) {
  const { openDocSession } = await import("@shared/realtime/docSession");
  const { setAccessToken } = await import("@core/auth/auth");
  setAccessToken("token");
  const handle = openDocSession({
    contentType: "NOTE",
    contentId: "note",
    organizationId: "org",
    userId: "user",
  })!;
  handles.push(handle);
  const socket = FakeSocket.sockets.at(-1)!;
  socket.open();
  socket.deliver(encodeGeneration("G"));
  if (withSessionState) socket.deliver(sessionState());
  expect(handle.getSnapshot().persistence).toBe("connecting");
  socket.deliver(syncStep2());
  await handle.session.whenSynced;
  const type = (text: string) => {
    const markdown = handle.session.ydoc.getText("markdown");
    markdown.insert(markdown.length, text);
  };
  // Sends the batched edit and returns its update id.
  const send = (text: string) => {
    type(text);
    vi.advanceTimersByTime(50);
    return socket.writtenIds().at(-1)!;
  };
  return { handle, socket, type, send, persistence: () => handle.getSnapshot().persistence };
}

it("shows Syncing until a receipt, Synced until checkpoint progress, then Saved", async () => {
  const { socket, type, persistence } = await openNote();
  expect(persistence()).toBe("saved");
  type(" edit");
  expect(persistence()).toBe("syncing");
  vi.advanceTimersByTime(50);
  const [updateId] = socket.writtenIds();
  socket.deliver(receipt(updateId, 1));
  expect(persistence()).toBe("syncing");
  vi.advanceTimersByTime(1_000);
  expect(persistence()).toBe("synced");
  socket.deliver(progress(1));
  expect(persistence()).toBe("saved");
});

it("shows Connecting, never Saved, until the socket's session state arrives", async () => {
  const { socket, persistence } = await openNote({ withSessionState: false });
  expect(persistence()).toBe("connecting");
  socket.deliver(sessionState());
  expect(persistence()).toBe("saved");
});

it("shows no save state until the device's retained edits reach this socket", async () => {
  const first = await openNote();
  const updateId = first.send(" edit");
  first.socket.deliver(receipt(updateId, 1));
  expect(await first.handle.persistLocally()).toBe(true);
  // The server buffered the edit; no checkpoint holds it yet.
  const server = new Y.Doc();
  Y.applyUpdate(server, Y.encodeStateAsUpdate(first.handle.session.ydoc));
  await first.handle.close();

  const { openDocSession } = await import("@shared/realtime/docSession");
  const handle = openDocSession({
    contentType: "NOTE",
    contentId: "note",
    organizationId: "org",
    userId: "user",
  })!;
  handles.push(handle);
  const persistence = () => handle.getSnapshot().persistence;
  first.socket.deliver(encodeGeneration("G"));
  first.socket.deliver(sessionState(1, 0));
  first.socket.deliver(syncStep2From(server));
  // The socket drops before local recovery hands the retained edit back.
  first.socket.close(1006);
  vi.advanceTimersByTime(1_000);
  const replacement = FakeSocket.sockets.at(-1)!;
  expect(replacement).not.toBe(first.socket);
  replacement.open();
  await handle.session.whenSynced;
  replacement.deliver(encodeGeneration("G"));
  replacement.deliver(sessionState(1, 0));
  expect(persistence()).toBe("connecting");

  replacement.deliver(syncStep2From(server));
  await vi.waitFor(() => expect(replacement.writtenIds()).toEqual([updateId]));
  expect(persistence()).toBe("syncing");
  replacement.deliver(receipt(updateId, 1));
  vi.advanceTimersByTime(1_000);
  expect(persistence()).toBe("synced");
  replacement.deliver(progress(1));
  expect(persistence()).toBe("saved");
  server.destroy();
});

it("waits for the new socket's session state before Synced or Saved after a reconnect", async () => {
  const { socket, send, persistence } = await openNote();
  socket.deliver(receipt(send(" edit"), 1));
  vi.advanceTimersByTime(1_000);
  expect(persistence()).toBe("synced");
  socket.close(1006);
  expect(persistence()).toBe("offline");

  // The checkpoint lands while no socket is open.
  vi.advanceTimersByTime(1_000);
  const replacement = FakeSocket.sockets.at(-1)!;
  expect(replacement).not.toBe(socket);
  replacement.open();
  replacement.deliver(encodeGeneration("G"));
  expect(persistence()).toBe("connecting");
  replacement.deliver(sessionState(1, 1));
  expect(persistence()).toBe("saved");
});

it("shows Saving delayed thirty seconds after the oldest uncheckpointed edit", async () => {
  const { socket, send, persistence } = await openNote();
  socket.deliver(receipt(send(" edit"), 1));
  vi.advanceTimersByTime(29_000);
  expect(persistence()).toBe("synced");
  vi.advanceTimersByTime(950);
  expect(persistence()).toBe("delayed");
  socket.deliver(progress(1));
  expect(persistence()).toBe("saved");
});

it("lets Offline outrank Saving delayed when the socket drops", async () => {
  const { socket, send, persistence } = await openNote();
  socket.deliver(receipt(send(" edit"), 1));
  vi.advanceTimersByTime(30_000);
  expect(persistence()).toBe("delayed");
  socket.close(1006);
  expect(persistence()).toBe("offline");
});

function denial(reason: string): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 2);
  encoding.writeVarUint(encoder, 0);
  encoding.writeVarString(encoder, reason);
  return encoding.toUint8Array(encoder);
}

it("shows Saving unavailable over Saving delayed until the first receipt", async () => {
  const { socket, send, persistence } = await openNote();
  const updateId = send(" edit");
  socket.deliver(denial("unavailable"));
  expect(persistence()).toBe("unavailable");
  vi.advanceTimersByTime(30_000);
  expect(persistence()).toBe("unavailable");
  socket.deliver(receipt(updateId, 1));
  vi.advanceTimersByTime(1_000);
  expect(persistence()).toBe("delayed");
  socket.deliver(progress(1));
  expect(persistence()).toBe("saved");
});

it("shows the rejected state when the server holds other bytes for an edit", async () => {
  const { socket, send, persistence } = await openNote();
  send(" edit");
  socket.deliver(denial("update conflict"));
  expect(persistence()).toBe("rejected");
});

it("asks for an app update after close 4426", async () => {
  const { handle, socket, type, persistence } = await openNote();
  type(" edit");
  socket.close(4426);
  expect(persistence()).toBe("upgrade_required");
  expect(handle.getSnapshot().status).toBe("upgrade_required");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(FakeSocket.sockets).toHaveLength(1);
});

it("shows Access lost after close 4403 and stays there instead of reconnecting", async () => {
  const { handle, socket, type, persistence } = await openNote();
  type(" edit");
  socket.close(4403);
  expect(persistence()).toBe("access_lost");
  expect(handle.getSnapshot().status).toBe("access_lost");
  await vi.advanceTimersByTimeAsync(60_000);
  expect(persistence()).toBe("access_lost");
  expect(FakeSocket.sockets).toHaveLength(1);
});

it("keeps View-only after a denial even when an earlier edit commits", async () => {
  const { handle, socket, send, persistence } = await openNote();
  const updateId = send(" edit");
  socket.deliver(denial("edit access removed"));
  socket.deliver(encodeCommitted(updateId));
  expect(persistence()).toBe("view_only");
  expect(handle.getSnapshot().status).toBe("permission_lost");
});

it("keeps Done open and shows the failure while the device cannot store edits", async () => {
  const { handle, type, persistence } = await openNote();
  nativeStorage.failInsert = true;
  type(" edit");
  expect(await handle.persistLocally()).toBe(false);
  expect(persistence()).toBe("storage_failed");
  nativeStorage.failInsert = false;
  type(" again");
  expect(await handle.persistLocally()).toBe(true);
  expect(persistence()).toBe("syncing");
});

it("hands accepted-only edits to the drain after Done stores them on the device", async () => {
  const { handle, socket, send, persistence } = await openNote();
  socket.deliver(receipt(send(" accepted"), 1));
  vi.advanceTimersByTime(1_000);
  expect(persistence()).toBe("synced");
  expect(await handle.persistLocally()).toBe(true);
  await handle.close();
  const { readStoredDrafts } = await import("@shared/realtime/draftStorage");
  const { realtimeMultiplexer } = await import("@shared/realtime/multiplexer");
  const { runMobileDrain, stopMobileDrains } = await import("@shared/realtime/drain");
  const drafts = await readStoredDrafts(KEY);
  expect(drafts.map((draft) => [draft.generation, draft.text])).toEqual([["G", "base accepted"]]);
  expect(realtimeMultiplexer.isAttached(NAME)).toBe(false);
  await runMobileDrain("user", "org", () => true);
  expect(realtimeMultiplexer.isAttached(NAME)).toBe(true);
  stopMobileDrains();
});

it("discards the device copy when Done follows a checkpoint", async () => {
  const { handle, socket, send } = await openNote();
  socket.deliver(encodeCommitted(send(" saved")));
  expect(await handle.persistLocally()).toBe(true);
  await handle.close();
  const { readStoredDrafts } = await import("@shared/realtime/draftStorage");
  expect(await readStoredDrafts(KEY)).toEqual([]);
});

it("keeps the device copy when the server replaced the generation", async () => {
  const { handle, socket, send } = await openNote();
  socket.deliver(encodeCommitted(send(" edit")));
  socket.deliver(encodeGeneration("replacement"));
  await handle.close();
  const { readStoredDrafts } = await import("@shared/realtime/draftStorage");
  const drafts = await readStoredDrafts(KEY);
  expect(drafts.map((draft) => [draft.generation, draft.text])).toEqual([["G", "base edit"]]);
});

function viewDenial(): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 2);
  encoding.writeVarUint(encoder, 1);
  encoding.writeVarString(encoder, "access revoked");
  return encoding.toUint8Array(encoder);
}

it("never shows Saving delayed after a reopen before this socket's session state, then shows it at once for an old edit", async () => {
  const first = await openNote();
  const updateId = first.send(" edit");
  first.socket.deliver(receipt(updateId, 1));
  expect(await first.handle.persistLocally()).toBe(true);
  const server = new Y.Doc();
  Y.applyUpdate(server, Y.encodeStateAsUpdate(first.handle.session.ydoc));
  await first.handle.close();

  // The app reopens the note a minute later.
  vi.setSystemTime(Date.now() + 60_000);
  const { openDocSession } = await import("@shared/realtime/docSession");
  const handle = openDocSession({
    contentType: "NOTE",
    contentId: "note",
    organizationId: "org",
    userId: "user",
  })!;
  handles.push(handle);
  const seen: string[] = [];
  handle.subscribe(() => seen.push(handle.getSnapshot().persistence));
  first.socket.deliver(encodeGeneration("G"));
  first.socket.deliver(syncStep2From(server));
  await handle.session.whenSynced;
  await vi.waitFor(() => expect(first.socket.writtenIds()).toEqual([updateId, updateId]));
  expect(seen).not.toContain("delayed");

  first.socket.deliver(sessionState(1, 0));
  expect(handle.getSnapshot().persistence).toBe("delayed");
  first.socket.deliver(receipt(updateId, 1));
  first.socket.deliver(progress(1));
  vi.advanceTimersByTime(1_000);
  expect(handle.getSnapshot().persistence).toBe("saved");
  server.destroy();
});

it("drops the device copy once the document answers no view access with every edit accepted", async () => {
  const { listDraftKeys, readStoredDrafts } = await import("@shared/realtime/draftStorage");
  const { handle, socket, send } = await openNote();
  socket.deliver(receipt(send(" accepted"), 1));
  expect(await handle.persistLocally()).toBe(true);
  expect((await readStoredDrafts(KEY)).length).toBeGreaterThan(0);

  socket.deliver(viewDenial());
  expect(handle.getSnapshot().persistence).toBe("access_lost");
  await vi.waitFor(async () => expect(await listDraftKeys("user")).toEqual([]));
  await handle.close();
  expect(await listDraftKeys("user")).toEqual([]);
});

it("keeps an edit the server never accepted as a recovered draft once view access goes", async () => {
  const { readStoredDrafts } = await import("@shared/realtime/draftStorage");
  const { handle, socket, type } = await openNote();
  type(" unsent");
  socket.deliver(viewDenial());
  const stored = async () =>
    (await readStoredDrafts(KEY)).map((draft) => [draft.generation.split(":")[0], draft.text]);
  await vi.waitFor(async () => expect(await stored()).toEqual([["recovery", "base unsent"]]));
  expect(handle.getSnapshot().recoveredDrafts.map((draft) => draft.text)).toEqual(["base unsent"]);
  await handle.close();
  expect(await stored()).toEqual([["recovery", "base unsent"]]);
  expect(socket.writtenIds()).toEqual([]);
});
