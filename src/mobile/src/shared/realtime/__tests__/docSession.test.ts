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

function syncStep2(): Uint8Array {
  const server = new Y.Doc();
  server.getMap("doc_meta").set("generation", "G");
  server.getText("markdown").insert(0, "base");
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  syncProtocol.writeSyncStep2(encoder, server);
  server.destroy();
  return encoding.toUint8Array(encoder);
}

const receipt = (updateId: string, acceptedSequence: number) =>
  encodeAcceptedReceipt({ updateId, generation: "G", epoch: "E", acceptedSequence });
const progress = (coveredSequence: number) =>
  encodeCheckpointProgress({ generation: "G", epoch: "E", coveredSequence, checkpointRevision: 1 });

async function openNote({ sessionState = true } = {}) {
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
  if (sessionState)
    socket.deliver(
      encodeSessionState({
        generation: "G",
        epoch: "E",
        headSequence: 0,
        checkpointSequence: 0,
        checkpointRevision: 0,
      }),
    );
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

it("shows Saved on a committed acknowledgment from a server without receipts", async () => {
  const { socket, send, persistence } = await openNote({ sessionState: false });
  socket.deliver(encodeCommitted(send(" edit")));
  vi.advanceTimersByTime(1_000);
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

it("keeps View-only after a denial even when an earlier edit commits", async () => {
  const { handle, socket, send, persistence } = await openNote();
  const updateId = send(" edit");
  const denial = encoding.createEncoder();
  encoding.writeVarUint(denial, 2);
  encoding.writeVarUint(denial, 0);
  encoding.writeVarString(denial, "edit access removed");
  socket.deliver(encoding.toUint8Array(denial));
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
