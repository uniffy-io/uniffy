import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Schema } from "@milkdown/prose/model";
import {
  fragmentHasRealContent,
  fragmentToProsemirrorNode,
  getProsemirrorFragment,
  replaceMarkdownYText,
  replaceProsemirrorFragment,
} from "@/features/notes/realtime/markdown";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    heading: { group: "block", content: "inline*" },
    text: { group: "inline" },
  },
});

function docNode(...paragraphs: string[]) {
  return schema.node(
    "doc",
    null,
    paragraphs.map((text) => schema.node("paragraph", null, text ? [schema.text(text)] : [])),
  );
}

describe("replaceProsemirrorFragment", () => {
  it("threads the given origin through a single transaction", () => {
    const ydoc = new Y.Doc();
    getProsemirrorFragment(ydoc);
    const origins: unknown[] = [];
    ydoc.on("afterTransaction", (tr: Y.Transaction) => {
      origins.push(tr.origin);
    });
    const origin = Symbol("hydration");
    replaceProsemirrorFragment(ydoc, docNode("hello"), origin);
    expect(origins).toEqual([origin]);
  });

  it("replaces stale fragment content instead of appending", () => {
    const ydoc = new Y.Doc();
    replaceProsemirrorFragment(ydoc, docNode("stale one", "stale two"), "seed");
    replaceProsemirrorFragment(ydoc, docNode("canonical"), "reconcile");
    const roundtrip = fragmentToProsemirrorNode(getProsemirrorFragment(ydoc), schema);
    expect(roundtrip.childCount).toBe(1);
    expect(roundtrip.textContent).toBe("canonical");
  });

  it("is not undoable when the UndoManager tracks only the session origin", () => {
    const ydoc = new Y.Doc();
    const fragment = getProsemirrorFragment(ydoc);
    const undoManager = new Y.UndoManager([fragment], {
      trackedOrigins: new Set(["session-1"]),
    });
    replaceProsemirrorFragment(ydoc, docNode("hydrated"), Symbol("hydration"));
    expect(undoManager.canUndo()).toBe(false);
    undoManager.undo();
    expect(fragmentToProsemirrorNode(fragment, schema).textContent).toBe("hydrated");
  });
});

describe("fragmentHasRealContent", () => {
  it("is false for an empty fragment", () => {
    const ydoc = new Y.Doc();
    expect(fragmentHasRealContent(getProsemirrorFragment(ydoc))).toBe(false);
  });

  it("is false for the ySync placeholder paragraph", () => {
    const ydoc = new Y.Doc();
    const fragment = getProsemirrorFragment(ydoc);
    fragment.insert(0, [new Y.XmlElement("paragraph")]);
    expect(fragmentHasRealContent(fragment)).toBe(false);
  });

  it("is true once a paragraph holds text", () => {
    const ydoc = new Y.Doc();
    replaceProsemirrorFragment(ydoc, docNode("content"), "seed");
    expect(fragmentHasRealContent(getProsemirrorFragment(ydoc))).toBe(true);
  });

  it("is true for a non-paragraph block even when empty", () => {
    const ydoc = new Y.Doc();
    const fragment = getProsemirrorFragment(ydoc);
    fragment.insert(0, [new Y.XmlElement("heading")]);
    expect(fragmentHasRealContent(fragment)).toBe(true);
  });
});

describe("replaceMarkdownYText", () => {
  it("writes under the given origin", () => {
    const ydoc = new Y.Doc();
    const origins: unknown[] = [];
    ydoc.on("afterTransaction", (tr: Y.Transaction) => {
      if (tr.changed.size > 0) origins.push(tr.origin);
    });
    replaceMarkdownYText(ydoc, "# Title", "mirror");
    expect(ydoc.getText("markdown").toString()).toBe("# Title");
    expect(origins).toEqual(["mirror"]);
  });

  it("is a no-op when the text already matches", () => {
    const ydoc = new Y.Doc();
    replaceMarkdownYText(ydoc, "same", "first");
    let fired = 0;
    ydoc.on("afterTransaction", (tr: Y.Transaction) => {
      if (tr.changed.size > 0) fired += 1;
    });
    replaceMarkdownYText(ydoc, "same", "second");
    expect(fired).toBe(0);
  });
});
