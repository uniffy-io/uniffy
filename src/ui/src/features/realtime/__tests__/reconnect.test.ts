import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { createSaveStateStore, type SaveState } from "@/features/realtime/hooks/useDocSaveState";
import { peekVarString } from "@/features/realtime/multiplex";
import { realtimeMultiplexer, type UpdateCoverageEvent } from "@/features/realtime/multiplexer";
import {
  FakeRealtimeServer,
  type FakeWebSocket,
  closeSockets,
  currentSocket,
  durableWrites,
  installBrowser,
  reopenSocket,
} from "@/features/realtime/persistence/__tests__/browser";

const GENERATION = "3f9c1a52-7d4e-4b8a-9c61-0e2f5d8b7a14";
const BATCH_MS = 50;
const RESYNC_MS = 30_000;

const cleanup: (() => void)[] = [];

beforeAll(() => installBrowser());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});

afterEach(() => {
  for (const release of cleanup.splice(0)) release();
  closeSockets();
  vi.useRealTimers();
});

/** A NOTE attached over a fresh socket to a server that already holds `text`. */
function openNote(contentId: string, text: string) {
  const server = new FakeRealtimeServer(`NOTE:${contentId}`, GENERATION, text);
  const ydoc = new Y.Doc();
  const awareness = new Awareness(ydoc);
  awareness.setLocalState(null);
  const subscription = realtimeMultiplexer.attach({
    contentType: "NOTE",
    contentId,
    ydoc,
    awareness,
  });
  cleanup.push(() => {
    subscription.destroy();
    awareness.destroy();
    ydoc.destroy();
  });
  const ws = currentSocket();
  ws.open();
  server.attach(ws);
  const markdown = ydoc.getText("markdown");
  return {
    server,
    ws,
    subscription,
    docName: subscription.docName,
    text: () => markdown.toString(),
    /** One own edit, flushed past the transport batch window. */
    edit: (change: (markdown: Y.Text) => void) => {
      ydoc.transact(() => change(markdown), "session");
      vi.advanceTimersByTime(BATCH_MS);
    },
    state: () => realtimeMultiplexer.getDocState(subscription.docName),
  };
}

function append(suffix: string) {
  return (markdown: Y.Text) => markdown.insert(markdown.length, suffix);
}

function watchChip(docName: string): (SaveState | null)[] {
  const store = createSaveStateStore(docName);
  const seen = [store.getSnapshot()];
  cleanup.push(
    store.subscribe(() => {
      const next = store.getSnapshot();
      if (next !== seen.at(-1)) seen.push(next);
    }),
  );
  return seen;
}

/** Message bytes the client sent for one document, oldest first, without the envelope. */
function docMessages(ws: FakeWebSocket, docName: string): number[][] {
  return ws.sent.flatMap((frame) => {
    const { docName: name, payloadOffset } = peekVarString(frame);
    return name === docName ? [[...frame.subarray(payloadOffset)]] : [];
  });
}

function recordCoverage(docName: string): UpdateCoverageEvent[] {
  const events: UpdateCoverageEvent[] = [];
  cleanup.push(realtimeMultiplexer.subscribeCoverage(docName, (event) => events.push(event)));
  return events;
}

describe("reconnect after a backend restart", () => {
  it("resends nothing and shows no stale Synced when the session state shows every accepted update checkpointed", () => {
    const note = openNote("covered", "first draft");
    note.edit(append(" grows"));
    note.edit((markdown) => markdown.delete(0, "first ".length));
    note.server.accept(note.ws);
    expect(note.state()).toMatchObject({ transportPending: false, checkpointPending: true });
    const chip = watchChip(note.docName);

    // The worker checkpoints the buffer while no backend serves the socket.
    note.ws.serverClose(1006);
    note.server.checkpoint([]);
    const ws = reopenSocket();
    // Open, with the pre-restart coverage still in memory and nothing heard on this socket yet.
    expect(chip).toEqual(["synced", null]);
    note.server.attach(ws);

    expect(durableWrites(ws, note.docName)).toEqual([]);
    expect(note.state()).toMatchObject({ transportPending: false, checkpointPending: false });
    expect(chip).toEqual(["synced", null, "saved"]);
  });

  it("replays accepted updates once under their original ids when the session state names a new epoch", () => {
    const note = openNote("new-epoch", "base");
    note.edit(append(" one"));
    note.edit((markdown) => markdown.delete(0, "base ".length));
    const accepted = note.server.accept(note.ws);

    note.ws.serverClose(1006);
    note.server.loseBuffer("E2");
    const ws = reopenSocket();
    note.server.attach(ws);

    const writes = durableWrites(ws, note.docName);
    for (const update of accepted)
      expect(writes.filter((write) => write.id === update.id)).toEqual([update]);
    note.server.accept(ws);
    note.server.checkpoint([ws]);
    expect(note.server.text).toBe("one");
    expect(note.text()).toBe("one");
    expect(note.state()).toMatchObject({ transportPending: false, checkpointPending: false });
  });

  it("resends an update that never got a receipt exactly once under its id", () => {
    const note = openNote("unanswered", "base");
    note.edit(append(" unanswered"));
    const [sent] = durableWrites(note.ws, note.docName);

    note.ws.serverClose(1006);
    const ws = reopenSocket();
    note.server.attach(ws);

    expect(durableWrites(ws, note.docName)).toEqual([sent]);
    note.server.accept(ws);
    note.server.checkpoint([ws]);
    expect(note.server.text).toBe("base unanswered");
  });

  it("resends an update that never got a receipt exactly once when the epoch also changed", () => {
    const note = openNote("unanswered-new-epoch", "base");
    note.edit(append(" unanswered"));
    const [sent] = durableWrites(note.ws, note.docName);

    note.ws.serverClose(1006);
    note.server.loseBuffer("E2");
    const ws = reopenSocket();
    note.server.attach(ws);

    expect(durableWrites(ws, note.docName).filter((write) => write.id === sent.id)).toEqual([sent]);
    note.server.accept(ws);
    note.server.checkpoint([ws]);
    expect(note.server.text).toBe("base unanswered");
    expect(note.state()).toMatchObject({ transportPending: false, checkpointPending: false });
  });

  it("sends an edit made while offline once under its own id, never again inside the sync answer", () => {
    const note = openNote("offline-edit", "base");
    note.edit(append(" saved"));
    note.server.accept(note.ws);
    note.server.checkpoint([note.ws]);

    note.ws.serverClose(1006);
    note.edit(append(" offline"));
    const ws = reopenSocket();
    note.server.attach(ws);

    const writes = durableWrites(ws, note.docName);
    expect(writes).toHaveLength(1);
    note.server.accept(ws);
    note.server.checkpoint([ws]);
    expect(note.server.text).toBe("base saved offline");
    expect(note.state()).toMatchObject({ transportPending: false, checkpointPending: false });
  });
});

describe("attach on a new socket", () => {
  it("sends SyncStep1 as the attaching frame and the seed capability after it", () => {
    const note = openNote("capable", "base");
    note.subscription.setSeedCapability!(true);

    note.ws.serverClose(1006);
    const ws = reopenSocket();

    const [first, second] = docMessages(ws, note.docName);
    expect(first.slice(0, 2)).toEqual([0, 0]);
    expect(second).toEqual([10, 1]);
  });
});

describe("periodic resync", () => {
  it("treats the session state a resync repeats as no change", () => {
    const note = openNote("resync", "base");
    const events = recordCoverage(note.docName);
    note.edit(append(" accepted"));
    note.edit((markdown) => markdown.delete(0, 1));
    note.server.accept(note.ws);
    const writes = durableWrites(note.ws, note.docName).length;
    const transitions = events.length;
    const state = note.state();

    vi.advanceTimersByTime(RESYNC_MS);
    note.server.resync(note.ws);
    expect(durableWrites(note.ws, note.docName)).toHaveLength(writes);
    expect(events).toHaveLength(transitions);
    expect(note.state()).toBe(state);

    note.server.checkpoint([note.ws]);
    const chip = watchChip(note.docName);
    for (let round = 0; round < 3; round++) {
      vi.advanceTimersByTime(RESYNC_MS);
      note.server.resync(note.ws);
    }
    expect(chip).toEqual(["saved"]);
    expect(durableWrites(note.ws, note.docName)).toHaveLength(writes);
  });
});
