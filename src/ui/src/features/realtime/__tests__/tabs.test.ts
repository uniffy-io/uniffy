import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installWebLocks } from "@/features/realtime/__tests__/webLocks";
import { realtimeMultiplexer } from "@/features/realtime/multiplexer";
import {
  FakeRealtimeServer,
  closeSockets,
  currentSocket,
  eventually,
  installBrowser,
  openEditor,
  signInDevice,
  updateWrites,
  type Editor,
  type FakeWebSocket,
} from "@/features/realtime/persistence/__tests__/browser";
import { teardownStorageEncryption } from "@/shared/crypto/storageEncryption";

const GENERATION = "3f9c1a52-7d4e-4b8a-9c61-0e2f5d8b7a14";
const BATCH_MS = 50;

let uninstallWebLocks = () => {};

beforeAll(() => installBrowser());

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  uninstallWebLocks = installWebLocks();
  await signInDevice("alice");
});

afterEach(() => {
  closeSockets();
  uninstallWebLocks();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => teardownStorageEncryption());

/** Another tab of this origin: its own modules over the device database, key and Web Locks
 * every tab shares. */
async function openTab() {
  vi.resetModules();
  const browser = await import("@/features/realtime/persistence/__tests__/browser");
  const { realtimeMultiplexer: multiplexer } = await import("@/features/realtime/multiplexer");
  const encryption = await import("@/shared/crypto/storageEncryption");
  await browser.unlockDevice("alice");
  return {
    openEditor: browser.openEditor,
    multiplexer,
    close: encryption.teardownStorageEncryption,
  };
}

/** The socket a tab opens next, answered by the server as an attach. */
function attachNext(server: FakeRealtimeServer, reconnect?: () => void): FakeWebSocket {
  reconnect?.();
  const ws = currentSocket();
  ws.open();
  server.attach(ws);
  return ws;
}

/** Edits `editor` types while its socket is down; they reach only its device rows. */
async function typeOffline(editor: Editor, ws: FakeWebSocket, text: string): Promise<void> {
  ws.serverClose(1006);
  editor.type(text);
  vi.advanceTimersByTime(BATCH_MS);
  await editor.persistence.flush();
}

const writtenBy = (ws: FakeWebSocket, docName: string, editor: Editor) =>
  updateWrites(ws, docName)
    .map(({ id }) => id)
    .filter((id) => id.startsWith(`${editor.ydoc.guid}:`));

describe("editors across tabs of one origin", () => {
  it("leave the rows of an editor still open in another tab to that editor when one reconnects", async () => {
    const server = new FakeRealtimeServer("NOTE:shared", GENERATION, "base");
    const here = openEditor("shared");
    attachNext(server);
    await here.hydrated;
    const tab = await openTab();
    const there = tab.openEditor("shared");
    const theirs = attachNext(server);
    await there.hydrated;
    await typeOffline(there, theirs, " typed in the other tab");

    const reconnected = attachNext(server, () => realtimeMultiplexer.retryConnection());
    // Reads the device again after the read the reconnect started.
    await here.persistence.hydrate({ serverGeneration: GENERATION });
    vi.advanceTimersByTime(BATCH_MS);
    server.accept(reconnected);

    expect(writtenBy(reconnected, here.docName, there)).toEqual([]);
    expect(here.ydoc.getText("markdown").toString()).toBe("base");
    expect(server.text).toBe("base");
    // No edit of the other tab counts as this editor's, so its chip cannot report it delayed.
    expect(realtimeMultiplexer.getDocState(here.docName).checkpointPending).toBe(false);

    const back = attachNext(server, () => tab.multiplexer.retryConnection());
    await eventually(() => expect(writtenBy(back, there.docName, there)).toHaveLength(1));
    server.accept(back);
    expect(server.text).toBe("base typed in the other tab");

    await there.close();
    await here.close();
    tab.close();
  });

  it("let an open editor take over the rows a closed editor in another tab left unconfirmed", async () => {
    const server = new FakeRealtimeServer("NOTE:handed", GENERATION, "base");
    const here = openEditor("handed");
    attachNext(server);
    await here.hydrated;
    const tab = await openTab();
    const there = tab.openEditor("handed");
    const theirs = attachNext(server);
    await there.hydrated;
    await typeOffline(there, theirs, " typed before closing");
    await there.close();

    const reconnected = attachNext(server, () => realtimeMultiplexer.retryConnection());
    await here.persistence.hydrate({ serverGeneration: GENERATION });
    vi.advanceTimersByTime(BATCH_MS);
    server.accept(reconnected);
    server.checkpoint([reconnected]);

    expect(writtenBy(reconnected, here.docName, there)).toHaveLength(1);
    expect(server.text).toBe("base typed before closing");
    expect(realtimeMultiplexer.getDocState(here.docName).checkpointPending).toBe(false);

    await here.close();
    tab.close();
  });
});
