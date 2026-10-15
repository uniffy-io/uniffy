import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { Schema } from "@milkdown/prose/model";
import {
  fragmentToProsemirrorNode,
  getProsemirrorFragment,
  MARKDOWN_MIRROR_ORIGIN,
  replaceMarkdownYText,
  replaceProsemirrorFragment,
} from "@/features/realtime/markdown";
import { MarkdownReconciler, mergeMarkdownEdits } from "@/features/realtime/markdownReconciliation";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    text: {},
  },
});
const docs: Y.Doc[] = [];
afterEach(() => docs.splice(0).forEach((doc) => doc.destroy()));

function setup(initial: string, clientID?: number, source?: Y.Doc) {
  const doc = new Y.Doc();
  if (clientID !== undefined) doc.clientID = clientID;
  docs.push(doc);
  const parse = (text: string) =>
    schema.node(
      "doc",
      null,
      text
        .split("\n\n")
        .map((line) => schema.node("paragraph", null, line ? schema.text(line) : undefined)),
    );
  const serialize = (node: ReturnType<typeof parse>) => {
    const paragraphs: string[] = [];
    node.forEach((child) => paragraphs.push(child.textContent));
    return paragraphs.join("\n\n");
  };
  const fragment = getProsemirrorFragment(doc);
  const read = () => fragmentToProsemirrorNode(fragment, schema);
  if (source) Y.applyUpdate(doc, Y.encodeStateAsUpdate(source));
  else {
    replaceMarkdownYText(doc, initial, MARKDOWN_MIRROR_ORIGIN);
    replaceProsemirrorFragment(doc, parse(initial), "seed");
  }
  const reconciler = new MarkdownReconciler(doc, { parse, serialize, read });
  doc
    .getText("markdown")
    .observe((event) =>
      reconciler.observe(event.transaction.origin === MARKDOWN_MIRROR_ORIGIN, true),
    );
  return {
    doc,
    fragment,
    reconciler,
    rich: () => serialize(read()),
    typeRich: (text: string) => replaceProsemirrorFragment(doc, parse(text), "local"),
    typeMarkdown: (text: string) => replaceMarkdownYText(doc, text, "peer"),
  };
}

describe("Markdown reconciliation", () => {
  it.each([
    [1000, 2000],
    [2000, 1000],
  ])("preserves simultaneous rich insertions with atomic mirrors (%s, %s)", (firstId, secondId) => {
    const first = setup("base", firstId);
    const second = setup("base", secondId, first.doc);
    const stopFirst = first.reconciler.bindLocalMirror(() => true);
    const stopSecond = second.reconciler.bindLocalMirror(() => true);
    first.typeRich("base Alice");
    second.typeRich("base Bob");
    const firstUpdate = Y.encodeStateAsUpdate(first.doc);
    const secondUpdate = Y.encodeStateAsUpdate(second.doc);
    Y.applyUpdate(first.doc, secondUpdate, "remote");
    Y.applyUpdate(second.doc, firstUpdate, "remote");
    first.reconciler.flush();
    Y.applyUpdate(second.doc, Y.encodeStateAsUpdate(first.doc), "remote");
    second.reconciler.flush();
    Y.applyUpdate(first.doc, Y.encodeStateAsUpdate(second.doc), "remote");
    expect(first.rich()).toBe(second.rich());
    expect(first.doc.getText("markdown").toString()).toBe(first.rich());
    expect(first.rich().match(/Alice/g)).toHaveLength(1);
    expect(first.rich().match(/Bob/g)).toHaveLength(1);
    stopFirst();
    stopSecond();
  });
  it("mirrors a local rich transaction before the transport batch completes", () => {
    const editor = setup("base");
    const server = new Y.Doc();
    docs.push(server);
    Y.applyUpdate(server, Y.encodeStateAsUpdate(editor.doc));
    const stop = editor.reconciler.bindLocalMirror(() => true);
    let updates: Uint8Array[] = [];
    let batches = 0;
    editor.doc.on("update", (update) => updates.push(update));
    editor.doc.on("afterAllTransactions", () => {
      Y.applyUpdate(server, Y.mergeUpdates(updates));
      updates = [];
      batches++;
      expect(server.getText("markdown").toString()).toBe("base rich edit");
    });
    editor.typeRich("base rich edit");
    expect(batches).toBe(1);
    stop();
  });
  it.each([
    [2000, 1000],
    [1000, 2000],
  ])("preserves text during concurrent mirror writes (%s, %s)", (richId, textId) => {
    const editor = setup("hello", richId);
    const peer = new Y.Doc();
    peer.clientID = textId;
    docs.push(peer);
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(editor.doc));
    editor.typeRich("hello world");
    editor.reconciler.flush();
    peer.transact(() => {
      peer.getMap("markdown_mirror").set("active", false);
      peer.getText("markdown").insert(5, "!");
    }, "phone");
    Y.applyUpdate(editor.doc, Y.encodeStateAsUpdate(peer), "remote");
    editor.reconciler.flush();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(editor.doc), "remote");
    expect(editor.rich()).toContain("!");
    expect(peer.getText("markdown").toString()).toBe(editor.rich());
    expect(editor.rich()).toContain("world");
  });
  it("merges unflushed rich typing before projecting a Markdown peer", () => {
    const editor = setup("one\n\ntwo");
    editor.typeRich("one rich\n\ntwo");
    editor.typeMarkdown("one\n\ntwo mobile");
    editor.reconciler.reconcile();
    expect(editor.rich()).toBe("one rich\n\ntwo mobile");
    expect(editor.doc.getText("markdown").toString()).toBe(editor.rich());
  });

  it("reads the latest text when several peer changes precede the queued projection", () => {
    const editor = setup("base");
    editor.typeRich("R base");
    editor.typeMarkdown("base 1");
    editor.typeMarkdown("base 12");
    editor.reconciler.reconcile();
    editor.reconciler.reconcile();
    expect(editor.rich()).toBe("R base 12");
  });

  it("flushes both edits when navigation beats the queued projection", () => {
    const editor = setup("base");
    editor.typeRich("R base");
    editor.typeMarkdown("base M");
    editor.reconciler.flush();
    expect(editor.doc.getText("markdown").toString()).toBe("R base M");
    expect(editor.rich()).toBe("R base M");
  });

  it("retains the base while a non-leader waits to take over", () => {
    const editor = setup("base");
    editor.typeRich("R base");
    editor.typeMarkdown("base M");
    editor.typeRich("R2 base");
    editor.reconciler.flush();
    expect(editor.rich()).toBe("R2 base M");
  });

  it("keeps Yjs text identity and relative cursor anchors across projection", () => {
    const editor = setup("first\n\nsecond");
    const paragraph = editor.fragment.get(1) as Y.XmlElement;
    const text = paragraph.get(0) as Y.XmlText;
    const cursor = Y.createRelativePositionFromTypeIndex(text, 3);
    editor.typeMarkdown("first changed\n\nsecond");
    editor.reconciler.reconcile();
    expect(editor.fragment.get(1)).toBe(paragraph);
    expect(Y.createAbsolutePositionFromRelativePosition(cursor, editor.doc)?.index).toBe(3);
    expect(Y.createAbsolutePositionFromRelativePosition(cursor, editor.doc)?.type).toBe(text);
  });

  it("converges with a second Y.Doc after preserving simultaneous edits", () => {
    const editor = setup("base");
    const peer = new Y.Doc();
    docs.push(peer);
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(editor.doc));
    editor.typeRich("R base");
    replaceMarkdownYText(peer, "base M", "mobile");
    Y.applyUpdate(editor.doc, Y.encodeStateAsUpdate(peer));
    editor.reconciler.flush();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(editor.doc));
    expect(peer.getText("markdown").toString()).toBe("R base M");
    expect(fragmentToProsemirrorNode(getProsemirrorFragment(peer), schema).textContent).toBe(
      "R base M",
    );
  });
});

describe("mergeMarkdownEdits", () => {
  it.each([
    ["base", "base", "peer", "peer"],
    ["base", "rich", "base", "rich"],
    ["base", "same", "same", "same"],
    ["abc", "aRbc", "aMbc", "aRMbc"],
    ["abc", "ac", "abMc", "aMc"],
    ["abc", "", "abMc", "M"],
    ["abc", "aXbc", "aXbcY", "aXbcY"],
    ["first\nsecond", "first R\nsecond", "first\nsecond M", "first R\nsecond M"],
    ["café", "café R", "M café", "M café R"],
  ])("merges %j, %j and %j", (base, rich, incoming, expected) => {
    expect(mergeMarkdownEdits(base, rich, incoming)).toBe(expected);
  });

  it("retains both replacements when bounded diff falls back on large unrelated text", () => {
    const base = "a".repeat(3000);
    const rich = "b".repeat(3000);
    const incoming = "c".repeat(3000);
    expect(mergeMarkdownEdits(base, rich, incoming)).toBe(rich + incoming);
  });
});
