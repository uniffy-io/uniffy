import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RealtimeStatusBadge } from "@/features/realtime/components/RealtimeStatusBadge";
import {
  SAVE_DELAYED_AFTER_MS,
  SYNCING_SETTLE_MS,
  createSaveStateStore,
  useDocSaveState,
  type SaveState,
} from "@/features/realtime/hooks/useDocSaveState";
import { encodeCommitted } from "@/features/realtime/protocol";
import {
  attachDoc,
  connect,
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
  const seen: SaveState[] = [store.getSnapshot()];
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
    expect(chip.seen).toEqual(["saved", "syncing", "synced", "saved"]);
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
    expect(chip.seen).toEqual(["saved", "syncing", "saved"]);
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
    expect(chip.seen).toEqual(["saved", "syncing", "synced"]);
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
    expect(chip.seen).toEqual(["saved", "syncing"]);
    vi.advanceTimersByTime(SYNCING_SETTLE_MS / 2);
    expect(chip.seen).toEqual(["saved", "syncing", "synced"]);
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
