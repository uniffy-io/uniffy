import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  getCanvasYTypes,
  readCanvasFromYDoc,
  seedCanvasYDoc,
} from "@/features/notes/realtime/canvasBinding";
import type { CanvasNode } from "@/features/notes/canvas/types";

function textNode(id: string, content = ""): CanvasNode {
  return {
    id,
    type: "text",
    position: { x: 0, y: 0 },
    data: { type: "text", content },
  } as CanvasNode;
}

describe("seedCanvasYDoc", () => {
  it("threads the given origin through the single seed transaction", () => {
    const ydoc = new Y.Doc();
    // Instantiate the root types first; defining them fires an unrelated origin-null transaction.
    getCanvasYTypes(ydoc);
    const origins: unknown[] = [];
    ydoc.on("afterTransaction", (transaction: Y.Transaction) => {
      origins.push(transaction.origin);
    });
    const origin = Symbol("seed-origin");
    seedCanvasYDoc(ydoc, { nodes: [textNode("a"), textNode("b")], edges: [] }, origin);
    expect(origins).toEqual([origin]);
  });

  it("is not undoable when the UndoManager tracks only the session origin", () => {
    const ydoc = new Y.Doc();
    const { nodes, edges, order, defaults } = getCanvasYTypes(ydoc);
    const undoManager = new Y.UndoManager([nodes, edges, order, defaults], {
      trackedOrigins: new Set(["session-1"]),
    });
    seedCanvasYDoc(ydoc, { nodes: [textNode("a")], edges: [] }, Symbol("hydration"));
    expect(undoManager.canUndo()).toBe(false);
    undoManager.undo();
    expect(readCanvasFromYDoc(ydoc).nodes).toHaveLength(1);
  });

  it("does not seed a doc that already holds content", () => {
    const ydoc = new Y.Doc();
    seedCanvasYDoc(ydoc, { nodes: [textNode("a")], edges: [] }, "first");
    seedCanvasYDoc(ydoc, { nodes: [textNode("b")], edges: [] }, "second");
    expect(readCanvasFromYDoc(ydoc).nodes.map((n) => n.id)).toEqual(["a"]);
  });
});

describe("readCanvasFromYDoc", () => {
  it("dedupes duplicate order entries, first occurrence wins", () => {
    const ydoc = new Y.Doc();
    seedCanvasYDoc(
      ydoc,
      { nodes: [textNode("a"), textNode("b"), textNode("c")], edges: [] },
      "seed",
    );
    const { order } = getCanvasYTypes(ydoc);
    order.push(["a", "c"]);
    expect(order.length).toBe(5);
    expect(readCanvasFromYDoc(ydoc).nodes.map((n) => n.id)).toEqual(["a", "b", "c"]);
  });

  it("returns each node once after two clients seed concurrently", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const state = { nodes: [textNode("a", "alpha"), textNode("b", "beta")], edges: [] };
    seedCanvasYDoc(docA, state, Symbol("hydration"));
    seedCanvasYDoc(docB, state, Symbol("hydration"));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const orderA = getCanvasYTypes(docA).order;
    expect(orderA.length).toBe(4);

    for (const doc of [docA, docB]) {
      const read = readCanvasFromYDoc(doc);
      expect(read.nodes.map((n) => n.id)).toEqual(["a", "b"]);
    }
  });
});
