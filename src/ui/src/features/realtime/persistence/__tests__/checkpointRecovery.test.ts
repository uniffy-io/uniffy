import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import * as Y from "yjs";
import {
  FakeRealtimeServer,
  beforeUnloadPrevented,
  closeSockets,
  currentSocket,
  updateWrites,
  eventually,
  installBrowser,
  openEditor,
  signInDevice,
  storeRawRow,
  type Editor,
} from "@/features/realtime/persistence/__tests__/browser";
import { canReleaseSession } from "@/features/realtime/hooks/useDocSession";
import { createSaveStateStore, type SaveState } from "@/features/realtime/hooks/useDocSaveState";
import { peekVarString } from "@/features/realtime/multiplex";
import { realtimeMultiplexer, type UpdateCoverageEvent } from "@/features/realtime/multiplexer";
import { hasPendingDoc } from "@/features/realtime/pendingDocs";
import {
  discoverStoredPendingDocs,
  getDeviceRecoveryState,
  readRecoveredDrafts,
  subscribeDeviceRecovery,
  type DeviceRecoveryState,
} from "@/features/realtime/persistence/encryptedYjsPersistence";
import { encryptForStorage, teardownStorageEncryption } from "@/shared/crypto/storageEncryption";

const GENERATION = "3f9c1a52-7d4e-4b8a-9c61-0e2f5d8b7a14";
const BATCH_MS = 50;

beforeAll(() => installBrowser());

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await signInDevice("alice");
});

afterEach(() => {
  closeSockets();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => teardownStorageEncryption());

function recordCoverage(docName: string): UpdateCoverageEvent[] {
  const events: UpdateCoverageEvent[] = [];
  realtimeMultiplexer.subscribeCoverage(docName, (event) => events.push(event));
  return events;
}

async function connect(contentId: string, text = "") {
  const server = new FakeRealtimeServer(`NOTE:${contentId}`, GENERATION, text);
  const editor = openEditor(contentId);
  const ws = currentSocket();
  ws.open();
  server.attach(ws);
  await editor.hydrated;
  return { server, editor, ws };
}

/** Every chip save state from now on, starting with the current one. */
function watchChip(docName: string): (SaveState | null)[] {
  const store = createSaveStateStore(docName);
  const seen = [store.getSnapshot()];
  const unsubscribe = store.subscribe(() => {
    const next = store.getSnapshot();
    if (next !== seen.at(-1)) seen.push(next);
  });
  onTestFinished(unsubscribe);
  return seen;
}

function pending(editor: Editor) {
  const { transportPending, checkpointPending } = realtimeMultiplexer.getDocState(editor.docName);
  return { transportPending, checkpointPending };
}

/** Whether Done may close the editor and leave what remains to the drain. */
function releasable(editor: Editor): boolean {
  return canReleaseSession(
    "connected",
    realtimeMultiplexer.getDocState(editor.docName),
    getDeviceRecoveryState(editor.docName),
  );
}

function failWrites() {
  return vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(() => {
    throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
  });
}

describe("checkpoint coverage in local recovery", () => {
  it("restores an accepted delete-only edit after restart and replays it under its id once the buffer is lost", async () => {
    const { server, editor, ws } = await connect("fixture-9", "delete me");
    editor.ydoc.transact(
      () => editor.ydoc.getText("markdown").delete(0, "delete me".length),
      "session",
    );
    vi.advanceTimersByTime(BATCH_MS);
    const [deletion] = server.accept(ws);
    expect(server.text).toBe("");
    await editor.persistence.flush();
    expect(pending(editor)).toEqual({ transportPending: false, checkpointPending: true });
    await editor.close();

    server.loseBuffer("E2");
    expect(server.text).toBe("delete me");

    const restarted = openEditor("fixture-9");
    const events = recordCoverage(restarted.docName);
    server.attach(ws);
    await restarted.hydrated;
    expect(events.find((event) => event.updateId === deletion.id)?.coverage).toBe("local");
    const replays = updateWrites(ws, restarted.docName).filter((write) => write.id === deletion.id);
    expect(replays.at(-1)?.update).toEqual(deletion.update);
    vi.advanceTimersByTime(BATCH_MS);
    server.accept(ws);
    expect(server.text).toBe("");
    expect(restarted.ydoc.getText("markdown").toString()).toBe("");

    await restarted.persistence.flush();
    expect(await discoverStoredPendingDocs("alice")).toBe(true);
    server.checkpoint([ws]);
    expect(pending(restarted).checkpointPending).toBe(false);
    await restarted.persistence.markCheckpointed();
    expect(await discoverStoredPendingDocs("alice")).toBe(false);
    await restarted.close();
  });

  it("shows Synced after a reload with an accepted edit and never Saved until progress covers it", async () => {
    const { server, editor, ws } = await connect("reload-accepted", "base");
    editor.type(" accepted");
    vi.advanceTimersByTime(BATCH_MS);
    server.accept(ws);
    await editor.persistence.flush();
    await editor.close();

    const chip = watchChip(editor.docName);
    const reloaded = openEditor("reload-accepted");
    server.attach(ws);
    // Session state is in, but local recovery has not read this device's rows yet.
    expect(chip).toEqual([null]);
    await reloaded.hydrated;
    expect(chip).toEqual([null, "synced"]);
    server.checkpoint([ws]);
    expect(chip).toEqual([null, "synced", "saved"]);
    await reloaded.close();
  });

  it("shows Saved after a reload with nothing pending only once local recovery has read the device", async () => {
    const { editor } = await connect("reload-clean", "base");
    await editor.close();

    const chip = watchChip(editor.docName);
    const reloaded = openEditor("reload-clean");
    const server = new FakeRealtimeServer(reloaded.docName, GENERATION, "base");
    server.attach(currentSocket());
    expect(chip).toEqual([null]);
    await reloaded.hydrated;
    expect(chip).toEqual([null, "saved"]);
    await reloaded.close();
  });

  it("retires only the entries a checkpoint covers, even when the close claims a checkpoint", async () => {
    const { server, editor, ws } = await connect("covered");
    for (const word of ["one", " two", " three"]) {
      editor.type(word);
      vi.advanceTimersByTime(BATCH_MS);
    }
    const [, , three] = server.accept(ws);
    server.checkpoint([ws], 2);
    await editor.persistence.flush();
    await editor.close({ checkpointed: true, discard: true });

    const restarted = openEditor("covered");
    const events = recordCoverage(restarted.docName);
    server.attach(ws);
    await restarted.hydrated;
    expect(events.map(({ updateId, coverage }) => [updateId, coverage])).toEqual([
      [three.id, "accepted"],
    ]);
    // The buffer still holds it, so nothing is resent.
    expect(updateWrites(ws, restarted.docName).filter((write) => write.id === three.id)).toEqual([
      three,
    ]);
    server.checkpoint([ws]);
    expect(events.at(-1)).toMatchObject({ updateId: three.id, coverage: "checkpointed" });
    await restarted.persistence.flush();
    await restarted.close();

    const settled = openEditor("covered");
    const later = recordCoverage(settled.docName);
    server.attach(ws);
    await settled.hydrated;
    expect(later).toEqual([]);
    expect(settled.ydoc.getText("markdown").toString()).toBe("one two three");
    await settled.close();
  });

  it("replays an accepted edit whose receipt lies above the head after the buffer lost its tail in place", async () => {
    const { server, editor, ws } = await connect("lost-tail", "base");
    editor.type(" kept");
    vi.advanceTimersByTime(BATCH_MS);
    const [lost] = server.accept(ws);
    await editor.persistence.flush();
    await editor.close();

    server.loseTail();
    expect(server.text).toBe("base");
    const restarted = openEditor("lost-tail");
    const events = recordCoverage(restarted.docName);
    server.attach(ws);
    await restarted.hydrated;
    expect(events.find((event) => event.updateId === lost.id)?.coverage).toBe("local");
    expect(
      updateWrites(ws, restarted.docName)
        .filter((write) => write.id === lost.id)
        .at(-1)?.update,
    ).toEqual(lost.update);
    vi.advanceTimersByTime(BATCH_MS);
    server.accept(ws);
    expect(server.text).toBe("base kept");
    server.checkpoint([ws]);
    expect(pending(restarted)).toEqual({ transportPending: false, checkpointPending: false });
    await restarted.close();
  });

  it("never hands a replaced generation's updates to the session opened on the new one", async () => {
    const { server, editor, ws } = await connect("replaced", "base");
    editor.type(" accepted");
    vi.advanceTimersByTime(BATCH_MS);
    const [accepted] = server.accept(ws);
    editor.type(" unanswered");
    vi.advanceTimersByTime(BATCH_MS);
    const unanswered = updateWrites(ws, editor.docName).at(-1)!;
    await editor.persistence.flush();
    const replacement = new FakeRealtimeServer(editor.docName, "G2", "replacement");
    replacement.attach(ws);

    // The session hook reopens on the new generation while the old session is still closing.
    const closing = editor.close({ checkpointed: false, discard: false });
    const reopened = openEditor("replaced");
    const writesBefore = updateWrites(ws, reopened.docName).length;
    replacement.attach(ws);
    await reopened.hydrated;
    await closing;
    vi.advanceTimersByTime(BATCH_MS);
    const resent = updateWrites(ws, reopened.docName).slice(writesBefore);
    expect(resent.map((write) => write.id)).not.toContain(accepted.id);
    expect(resent.map((write) => write.id)).not.toContain(unanswered.id);
    expect(pending(reopened)).toEqual({ transportPending: false, checkpointPending: false });
    expect((await readRecoveredDrafts(reopened.ydoc)).map((draft) => draft.text)).toEqual([
      "base accepted unanswered",
    ]);
    await reopened.close();
  });

  it("keeps an unaccepted edit across restart and resends it under its original id", async () => {
    const { server, editor, ws } = await connect("unaccepted", "base");
    editor.type(" offline tail");
    vi.advanceTimersByTime(BATCH_MS);
    const [unsent] = updateWrites(ws, editor.docName);
    ws.serverClose(1006);
    await editor.persistence.flush();
    await editor.close();

    const restarted = openEditor("unaccepted");
    const replacement = currentSocket();
    expect(replacement).not.toBe(ws);
    replacement.open();
    server.attach(replacement);
    await restarted.hydrated;
    expect(updateWrites(replacement, restarted.docName)).toContainEqual(unsent);
    vi.advanceTimersByTime(BATCH_MS);
    server.accept(replacement);
    server.checkpoint([replacement]);
    expect(server.text).toBe("base offline tail");
    expect(pending(restarted)).toEqual({ transportPending: false, checkpointPending: false });
    await restarted.close();
  });

  it("flushes transport and local persistence on pagehide without asking for a save", async () => {
    const { editor, ws } = await connect("pagehide");
    editor.type("leaving now");
    const before = ws.sent.length;
    window.dispatchEvent(new Event("pagehide"));
    const sent = ws.sent.slice(before).map((frame) => frame[peekVarString(frame).payloadOffset]);
    expect(sent).toEqual([6]);
    await editor.persistence.flush();
    expect(getDeviceRecoveryState(editor.docName).unpersisted).toBe(false);
    expect(pending(editor)).toEqual({ transportPending: true, checkpointPending: true });
    await editor.close();
  });
});

describe("unload warning", () => {
  it("warns for an edit not yet on the device and stops once it is stored, accepted or not", async () => {
    const editor = openEditor("unload-local");
    editor.type("typed offline");
    expect(beforeUnloadPrevented()).toBe(true);
    await editor.persistence.flush();
    expect(pending(editor).transportPending).toBe(true);
    expect(beforeUnloadPrevented()).toBe(false);
    await editor.close();
  });

  it("never warns for accepted edits safely retained on the device", async () => {
    const { server, editor, ws } = await connect("unload-accepted");
    editor.type("accepted, not checkpointed");
    vi.advanceTimersByTime(BATCH_MS);
    server.accept(ws);
    await editor.persistence.flush();
    expect(pending(editor)).toEqual({ transportPending: false, checkpointPending: true });
    expect(beforeUnloadPrevented()).toBe(false);
    await editor.close();
    expect(beforeUnloadPrevented()).toBe(false);
  });

  it("keeps warning without device storage until a checkpoint covers the edit", async () => {
    teardownStorageEncryption();
    const { server, editor, ws } = await connect("unload-no-key");
    editor.type("only in memory");
    await editor.persistence.flush();
    expect(getDeviceRecoveryState(editor.docName)).toEqual({
      storage: "unavailable",
      unpersisted: true,
    });
    vi.advanceTimersByTime(BATCH_MS);
    server.accept(ws);
    expect(beforeUnloadPrevented()).toBe(true);
    server.checkpoint([ws]);
    expect(beforeUnloadPrevented()).toBe(false);
    await editor.close();
  });
});

describe("device storage failure", () => {
  it("surfaces a failed write, never records the doc as saved on device, and recovers on the next write", async () => {
    const { server, editor, ws } = await connect("quota");
    const states: DeviceRecoveryState[] = [];
    const unsubscribe = subscribeDeviceRecovery(editor.docName, (state) => states.push(state));
    const put = failWrites();
    editor.type("not stored");
    await editor.persistence.flush();
    expect(getDeviceRecoveryState(editor.docName)).toEqual({
      storage: "failed",
      unpersisted: true,
    });
    expect(hasPendingDoc("NOTE", "quota")).toBe(false);
    vi.advanceTimersByTime(BATCH_MS);
    server.accept(ws);
    expect(beforeUnloadPrevented()).toBe(true);

    put.mockRestore();
    await editor.persistence.flush();
    expect(getDeviceRecoveryState(editor.docName)).toEqual({
      storage: "available",
      unpersisted: false,
    });
    expect(hasPendingDoc("NOTE", "quota")).toBe(true);
    expect(beforeUnloadPrevented()).toBe(false);
    expect(states).toEqual([
      { storage: "available", unpersisted: true },
      { storage: "failed", unpersisted: true },
      { storage: "available", unpersisted: false },
    ]);
    unsubscribe();
    await editor.close();
  });
});

describe("edit access removed", () => {
  it("offers no recovered draft once a checkpoint covers the edits accepted before it, beside rows without coverage identity", async () => {
    const stale = new Y.Doc();
    stale.getText("markdown").insert(0, "typed before coverage identity");
    const update = btoa(String.fromCharCode(...Y.encodeStateAsUpdate(stale)));
    await storeRawRow(
      ["NOTE", "revoked", GENERATION, "old-tab:0000000001"],
      await encryptForStorage({ update, dirty: true }),
    );
    await storeRawRow(["NOTE", "revoked", "old-tab:0000000001"], await encryptForStorage(update));
    const { server, editor, ws } = await connect("revoked", "Shared note.");
    editor.type(" Bob before revoke.");
    vi.advanceTimersByTime(BATCH_MS);
    server.accept(ws);
    server.removeEditAccess(ws);
    server.checkpoint([ws]);
    expect(pending(editor)).toEqual({ transportPending: false, checkpointPending: false });
    await editor.persistence.markCheckpointed();
    expect(await readRecoveredDrafts(editor.ydoc)).toEqual([]);
    expect(await discoverStoredPendingDocs("alice")).toBe(false);
    await editor.close({ checkpointed: false, discard: false });

    const reopened = openEditor("revoked");
    server.attach(ws);
    await reopened.hydrated;
    server.removeEditAccess(ws, "read only");
    expect(reopened.ydoc.getText("markdown").toString()).toBe("Shared note. Bob before revoke.");
    expect(await readRecoveredDrafts(reopened.ydoc)).toEqual([]);
    await reopened.close();
    stale.destroy();
  });

  it("offers edits typed offline as a recovered draft when the reopened document is read-only before local recovery reads them", async () => {
    const { server, editor, ws } = await connect("offline-then-viewer", "Shared note.");
    ws.serverClose(1006);
    editor.type(" Typed offline.");
    vi.advanceTimersByTime(BATCH_MS);
    await editor.persistence.flush();
    await editor.close();

    const reopened = openEditor("offline-then-viewer");
    const replacement = currentSocket();
    replacement.open();
    // The server refuses writes ahead of the handshake that starts local recovery.
    server.removeEditAccess(replacement, "read only");
    server.attach(replacement);
    await reopened.hydrated;
    expect(reopened.ydoc.getText("markdown").toString()).toBe("Shared note. Typed offline.");
    vi.advanceTimersByTime(BATCH_MS);
    expect(updateWrites(replacement, reopened.docName)).toEqual([]);
    await eventually(async () =>
      expect((await readRecoveredDrafts(reopened.ydoc)).map((draft) => draft.text)).toEqual([
        "Shared note. Typed offline.",
      ]),
    );
    await reopened.close();

    const later = openEditor("offline-then-viewer");
    server.removeEditAccess(replacement, "read only");
    server.attach(replacement);
    await later.hydrated;
    expect((await readRecoveredDrafts(later.ydoc)).map((draft) => draft.text)).toEqual([
      "Shared note. Typed offline.",
    ]);
    await later.close();
  });

  it("keeps edits the server never accepted as a recovered draft", async () => {
    const { server, editor, ws } = await connect("refused", "Shared note.");
    editor.type(" Typed as access went.");
    server.removeEditAccess(ws);
    vi.advanceTimersByTime(BATCH_MS);
    await eventually(async () =>
      expect((await readRecoveredDrafts(editor.ydoc)).map((draft) => draft.text)).toEqual([
        "Shared note. Typed as access went.",
      ]),
    );
    expect(updateWrites(ws, editor.docName)).toEqual([]);
    await editor.close();
  });
});

describe("Done", () => {
  it("releases the editor once the server accepts an edit the device holds", async () => {
    const { server, editor, ws } = await connect("done-stored");
    editor.type("stored");
    vi.advanceTimersByTime(BATCH_MS);
    await editor.persistence.flush();
    expect(releasable(editor)).toBe(false);
    server.accept(ws);
    expect(pending(editor)).toEqual({ transportPending: false, checkpointPending: true });
    expect(releasable(editor)).toBe(true);
    await editor.close();
  });

  it("holds the editor for an accepted edit the device failed to store until a checkpoint covers it", async () => {
    const { server, editor, ws } = await connect("done-failed");
    const put = failWrites();
    editor.type("not stored");
    await editor.persistence.flush();
    vi.advanceTimersByTime(BATCH_MS);
    server.accept(ws);
    expect(releasable(editor)).toBe(false);
    server.checkpoint([ws]);
    expect(releasable(editor)).toBe(true);
    put.mockRestore();
    await editor.close();
  });

  it("holds the editor without device storage until a checkpoint covers the edit", async () => {
    teardownStorageEncryption();
    const { server, editor, ws } = await connect("done-no-key");
    editor.type("only in memory");
    vi.advanceTimersByTime(BATCH_MS);
    server.accept(ws);
    expect(releasable(editor)).toBe(false);
    server.checkpoint([ws]);
    expect(releasable(editor)).toBe(true);
    await editor.close();
  });
});
