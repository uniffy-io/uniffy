import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Schema } from "@milkdown/prose/model";
import { hasRichPeer, resolveColdStartFragment } from "@/features/realtime/coldStartFragment";
import {
  MARKDOWN_MIRROR_FIELD,
  MIRROR_ACTIVE_KEY,
  fragmentToProsemirrorNode,
  getMarkdownYText,
  getProsemirrorFragment,
  replaceProsemirrorFragment,
} from "@/features/realtime/markdown";
import { HYDRATION_ORIGIN } from "@/features/realtime/persistence/encryptedYjsPersistence";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
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

function awarenessWith(
  clientID: number,
  peers: Record<number, { markdownEditor?: string; user?: { name: string } }>,
) {
  const states = new Map<number, { markdownEditor?: string }>(
    Object.entries(peers).map(([id, state]) => [Number(id), state]),
  );
  states.set(clientID, { markdownEditor: "self" });
  return { clientID, getStates: () => states };
}

// A rich session left "old rich text" in the fragment; a Markdown-mode peer then wrote two
// paragraphs straight into Y.Text and cleared the mirror flag.
function staleDoc(): Y.Doc {
  const ydoc = new Y.Doc();
  replaceProsemirrorFragment(ydoc, docNode("old rich text"), HYDRATION_ORIGIN);
  ydoc.transact(() => {
    getMarkdownYText(ydoc).insert(0, "first paragraph\n\nsecond paragraph");
    ydoc.getMap(MARKDOWN_MIRROR_FIELD).set(MIRROR_ACTIVE_KEY, false);
  }, "markdown-peer-session");
  return ydoc;
}

describe("resolveColdStartFragment", () => {
  it("rebuilds a stale fragment from an explicit text write even with a foreign non-rich peer", () => {
    const ydoc = staleDoc();
    const awareness = awarenessWith(10, { 20: { user: { name: "Alice" } } });
    const textBefore = getMarkdownYText(ydoc).toString();

    expect(resolveColdStartFragment(ydoc, awareness, () => false)).toBe("rebuild");

    replaceProsemirrorFragment(
      ydoc,
      docNode("first paragraph", "second paragraph"),
      HYDRATION_ORIGIN,
    );
    expect(fragmentToProsemirrorNode(getProsemirrorFragment(ydoc), schema).textContent).toBe(
      "first paragraphsecond paragraph",
    );
    expect(getMarkdownYText(ydoc).toString()).toBe(textBefore);
    ydoc.destroy();
  });

  it("rebuilds after an explicit text write even when a rich peer is attached", () => {
    const ydoc = staleDoc();
    const awareness = awarenessWith(10, { 20: { markdownEditor: "peer" } });
    expect(resolveColdStartFragment(ydoc, awareness, () => false)).toBe("rebuild");
    ydoc.destroy();
  });

  it("keeps a rich peer's in-flight fragment while the mirror flag is unset", () => {
    const ydoc = new Y.Doc();
    replaceProsemirrorFragment(ydoc, docNode("peer keystrokes"), "ysync");
    getMarkdownYText(ydoc).insert(0, "peer keystroke");
    const richPeer = awarenessWith(10, { 20: { markdownEditor: "peer" } });
    expect(resolveColdStartFragment(ydoc, richPeer, () => false)).toBe("keep");
    const nonRichPeer = awarenessWith(10, { 20: { user: { name: "Mobile" } } });
    expect(resolveColdStartFragment(ydoc, nonRichPeer, () => false)).toBe("keep");
    ydoc.destroy();
  });

  it("keeps the fragment when the mirror wrote last or the forms already match", () => {
    const ydoc = staleDoc();
    const awareness = awarenessWith(10, {});
    expect(resolveColdStartFragment(ydoc, awareness, () => true)).toBe("keep");
    ydoc.getMap(MARKDOWN_MIRROR_FIELD).set(MIRROR_ACTIVE_KEY, true);
    expect(resolveColdStartFragment(ydoc, awareness, () => false)).toBe("keep");
    ydoc.destroy();
  });

  it("seeds when the fragment holds only the ySync placeholder paragraph", () => {
    const ydoc = new Y.Doc();
    getProsemirrorFragment(ydoc).insert(0, [new Y.XmlElement("paragraph")]);
    getMarkdownYText(ydoc).insert(0, "column text");
    expect(resolveColdStartFragment(ydoc, awarenessWith(10, {}), () => false)).toBe("seed");
    ydoc.destroy();
  });
});

describe("hasRichPeer", () => {
  it("counts only foreign states that carry markdownEditor", () => {
    expect(hasRichPeer(awarenessWith(1, {}))).toBe(false);
    expect(hasRichPeer(awarenessWith(1, { 2: { user: { name: "Bob" } } }))).toBe(false);
    expect(hasRichPeer(awarenessWith(1, { 2: { markdownEditor: "bob" } }))).toBe(true);
  });
});
