import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeStatusBadge } from "@/features/realtime/components/RealtimeStatusBadge";
import {
  SAVE_DELAYED_AFTER_MS,
  SYNCING_SETTLE_MS,
  checkpointPendingStore,
  createSaveStateStore,
  releasableStore,
  useDocSaveState,
  type DocValueStore,
  type SaveState,
} from "@/features/realtime/hooks/useDocSaveState";
import { realtimeMultiplexer } from "@/features/realtime/multiplexer";
import { encodeCommitted } from "@/features/realtime/protocol";
import {
  FakeWebSocket,
  attachDoc,
  connect,
  denial,
  detachAll,
  installRealtimeGlobals,
  lastUpdateId,
  progress,
  receipt,
  type AttachedDoc,
} from "@/features/realtime/hooks/__tests__/realtimeHarness";

beforeAll(installRealtimeGlobals);
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  detachAll();
  vi.useRealTimers();
});

function watch(doc: AttachedDoc) {
  const store = createSaveStateStore(doc.docName);
  const seen: (SaveState | null)[] = [store.getSnapshot()];
  const unsubscribe = store.subscribe(() => {
    const state = store.getSnapshot();
    if (state !== seen.at(-1)) seen.push(state);
  });
  return { current: () => store.getSnapshot(), seen, unsubscribe };
}

function type(doc: AttachedDoc, text: string) {
  doc.ydoc.getText("markdown").insert(0, text);
}

describe("save state through the transport", () => {
  it("shows no save state until session state arrives, then Saved", () => {
    const doc = attachDoc("before-session-state");
    const chip = watch(doc);
    expect(chip.current()).toBeNull();
    connect(doc);
    expect(chip.seen).toEqual([null, "saved"]);
    chip.unsubscribe();
  });

  it("shows Syncing for an edit made before session state arrives", () => {
    const doc = attachDoc("edit-before-session-state");
    const chip = watch(doc);
    type(doc, "draft");
    vi.advanceTimersByTime(50);
    expect(chip.seen).toEqual([null, "syncing"]);
    chip.unsubscribe();
  });

  it("shows Syncing for a local edit, Synced after its receipt and Saved after progress", () => {
    const doc = attachDoc("receipt-then-progress");
    const chip = watch(doc);
    const ws = connect(doc);
    expect(chip.current()).toBe("saved");

    type(doc, "draft");
    expect(chip.current()).toBe("syncing");
    vi.advanceTimersByTime(50);
    ws.receive(doc.docName, receipt(lastUpdateId(ws, doc), 1));
    expect(chip.current()).toBe("syncing");
    vi.advanceTimersByTime(SYNCING_SETTLE_MS);
    expect(chip.current()).toBe("synced");

    ws.receive(doc.docName, progress(1));
    expect(chip.current()).toBe("saved");
    expect(chip.seen).toEqual([null, "saved", "syncing", "synced", "saved"]);
    chip.unsubscribe();
  });

  it("goes straight to Saved when the server commits the update", () => {
    const doc = attachDoc("committed");
    const chip = watch(doc);
    const ws = connect(doc);
    type(doc, "draft");
    vi.advanceTimersByTime(50);
    ws.receive(doc.docName, encodeCommitted(lastUpdateId(ws, doc)));
    vi.advanceTimersByTime(SYNCING_SETTLE_MS);
    expect(chip.seen).toEqual([null, "saved", "syncing", "saved"]);
    chip.unsubscribe();
  });

  it("never shows Saved for a receipt alone", () => {
    const doc = attachDoc("receipt-only");
    const chip = watch(doc);
    const ws = connect(doc);
    type(doc, "draft");
    vi.advanceTimersByTime(50);
    ws.receive(doc.docName, receipt(lastUpdateId(ws, doc), 1));
    vi.advanceTimersByTime(SAVE_DELAYED_AFTER_MS - 100);
    expect(chip.seen).toEqual([null, "saved", "syncing", "synced"]);
    chip.unsubscribe();
  });

  it("holds Syncing while typing continues across receipts", () => {
    const doc = attachDoc("typing");
    const chip = watch(doc);
    const ws = connect(doc);
    for (let sequence = 1; sequence <= 5; sequence++) {
      type(doc, "x");
      vi.advanceTimersByTime(50);
      ws.receive(doc.docName, receipt(lastUpdateId(ws, doc), sequence));
      vi.advanceTimersByTime(SYNCING_SETTLE_MS / 2);
    }
    expect(chip.seen).toEqual([null, "saved", "syncing"]);
    vi.advanceTimersByTime(SYNCING_SETTLE_MS / 2);
    expect(chip.seen).toEqual([null, "saved", "syncing", "synced"]);
    chip.unsubscribe();
  });

  it("reports Saving delayed thirty seconds after the oldest unsaved edit", () => {
    vi.setSystemTime(10_000);
    const doc = attachDoc("delayed");
    const chip = watch(doc);
    const ws = connect(doc);
    type(doc, "first");
    vi.advanceTimersByTime(50);
    ws.receive(doc.docName, receipt(lastUpdateId(ws, doc), 1));
    vi.advanceTimersByTime(20_000);
    type(doc, "second");
    vi.advanceTimersByTime(50);
    ws.receive(doc.docName, receipt(lastUpdateId(ws, doc), 2));
    vi.advanceTimersByTime(SAVE_DELAYED_AFTER_MS - 20_000 - 101);
    expect(chip.current()).toBe("synced");
    vi.advanceTimersByTime(1);
    expect(chip.current()).toBe("delayed");

    ws.receive(doc.docName, progress(2));
    expect(chip.current()).toBe("saved");
    chip.unsubscribe();
  });

  it("shows Saving unavailable over Saving delayed until the first receipt", () => {
    const doc = attachDoc("unavailable");
    const chip = watch(doc);
    const ws = connect(doc);
    type(doc, "draft");
    vi.advanceTimersByTime(50);
    const id = lastUpdateId(ws, doc);
    ws.receive(doc.docName, denial("unavailable"));
    expect(chip.current()).toBe("unavailable");
    vi.advanceTimersByTime(SAVE_DELAYED_AFTER_MS);
    expect(chip.current()).toBe("unavailable");

    ws.receive(doc.docName, receipt(id, 1));
    vi.advanceTimersByTime(SYNCING_SETTLE_MS);
    expect(chip.current()).toBe("delayed");
    ws.receive(doc.docName, progress(1));
    expect(chip.seen).toEqual([null, "saved", "syncing", "unavailable", "delayed", "saved"]);
    chip.unsubscribe();
  });

  it("never reports Saving delayed before the reconnected socket's session state", () => {
    vi.setSystemTime(10_000);
    const doc = attachDoc("delayed-reconnect");
    const chip = watch(doc);
    const ws = connect(doc);
    type(doc, "draft");
    vi.advanceTimersByTime(50);
    ws.receive(doc.docName, receipt(lastUpdateId(ws, doc), 1));
    ws.serverClose(1006);
    vi.advanceTimersByTime(SAVE_DELAYED_AFTER_MS);
    const reopened = FakeWebSocket.instances.at(-1);
    expect(reopened).not.toBe(ws);
    reopened!.readyState = FakeWebSocket.OPEN;
    reopened!.onopen?.();

    // The checkpoint may have covered the edit while the socket was down; only 13 can say.
    expect(chip.current()).not.toBe("delayed");
    expect(chip.seen).not.toContain("delayed");
    chip.unsubscribe();
  });

  it("reports Saving delayed for an edit the server never accepts", () => {
    const doc = attachDoc("never-accepted");
    const chip = watch(doc);
    connect(doc);
    type(doc, "draft");
    vi.advanceTimersByTime(SAVE_DELAYED_AFTER_MS);
    expect(chip.current()).toBe("delayed");
    chip.unsubscribe();
  });
});

describe("useDocSaveState", () => {
  function Chip({ docName }: { docName: string | null }) {
    return createElement(RealtimeStatusBadge, {
      status: "connected",
      save: useDocSaveState(docName),
      storage: "available",
    });
  }

  it("renders the attached document's save state", () => {
    const doc = attachDoc("rendered");
    connect(doc);
    expect(renderToStaticMarkup(createElement(Chip, { docName: doc.docName }))).toContain("Saved");
    type(doc, "draft");
    expect(renderToStaticMarkup(createElement(Chip, { docName: doc.docName }))).toContain(
      "Syncing",
    );
  });

  it("renders nothing without a document", () => {
    expect(renderToStaticMarkup(createElement(Chip, { docName: null }))).toBe("");
  });
});

describe("narrow document values for editor hosts", () => {
  function heard<T>(store: DocValueStore<T>) {
    const values: T[] = [store.getSnapshot()];
    const unsubscribe = store.subscribe(() => values.push(store.getSnapshot()));
    return { values, unsubscribe };
  }

  it("hears checkpoint pending flip at the first edit and the checkpoint, not on every batch", () => {
    const doc = attachDoc("narrow-typing");
    const ws = connect(doc);
    let fullStateChanges = 0;
    const stopFull = realtimeMultiplexer.subscribeDocState(doc.docName, () => fullStateChanges++);
    const pending = heard(checkpointPendingStore(doc.docName));
    for (let sequence = 1; sequence <= 5; sequence++) {
      type(doc, "x");
      vi.advanceTimersByTime(50);
      ws.receive(doc.docName, receipt(lastUpdateId(ws, doc), sequence));
    }
    ws.receive(doc.docName, progress(5));

    expect(pending.values).toEqual([false, true, false]);
    // Each batch and receipt changes the full document state.
    expect(fullStateChanges).toBeGreaterThanOrEqual(10);
    pending.unsubscribe();
    stopFull();
  });

  it("decides the hand-off from the document only while a closing editor asks", () => {
    const doc = attachDoc("narrow-closing");
    const ws = connect(doc);
    type(doc, "x");
    expect(releasableStore(null, "connected").getSnapshot()).toBe(true);
    const closing = heard(releasableStore(doc.docName, "connected"));
    expect(closing.values).toEqual([false]);
    vi.advanceTimersByTime(50);
    ws.receive(doc.docName, receipt(lastUpdateId(ws, doc), 1));
    ws.receive(doc.docName, progress(1));
    expect(closing.values).toEqual([false, true]);
    closing.unsubscribe();
  });
});
