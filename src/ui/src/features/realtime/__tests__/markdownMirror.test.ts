import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  isMarkdownMirrorLeader,
  MARKDOWN_MIRROR_FIELD,
  MARKDOWN_MIRROR_ORIGIN,
  replaceMarkdownYText,
  waitForFragmentContent,
} from "@/features/realtime/markdown";

describe("markdown mirror coordination", () => {
  it("elects one editable peer and ignores viewers", () => {
    const states = new Map([
      [1, {}],
      [2, { markdownEditor: "second" }],
      [3, { markdownEditor: "third" }],
    ]);
    expect(isMarkdownMirrorLeader({ clientID: 2, getStates: () => states })).toBe(true);
    expect(isMarkdownMirrorLeader({ clientID: 3, getStates: () => states })).toBe(false);
    states.delete(2);
    expect(isMarkdownMirrorLeader({ clientID: 3, getStates: () => states })).toBe(true);
  });

  it("resolves the cold-seed wait when a peer's seed arrives, or gives up on timeout", async () => {
    const doc = new Y.Doc();
    const fragment = doc.getXmlFragment("prosemirror");
    const pending = waitForFragmentContent(fragment, 1000);
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    paragraph.insert(0, [text]);
    fragment.insert(0, [paragraph]);
    text.insert(0, "seeded by the leader");
    await expect(pending).resolves.toBe(true);

    const empty = new Y.Doc();
    const placeholder = new Y.XmlElement("paragraph");
    empty.getXmlFragment("prosemirror").insert(0, [placeholder]);
    await expect(waitForFragmentContent(empty.getXmlFragment("prosemirror"), 20)).resolves.toBe(
      false,
    );
    doc.destroy();
    empty.destroy();
  });

  it("marks mirror updates on remote replay while keeping external writes distinct", () => {
    const source = new Y.Doc();
    const peer = new Y.Doc();
    const metadata = peer.getMap(MARKDOWN_MIRROR_FIELD);
    const classifications: boolean[] = [];
    peer.getText("markdown").observe(() => {
      classifications.push(Boolean(metadata.get("active")));
    });
    replaceMarkdownYText(source, "merged fragment", MARKDOWN_MIRROR_ORIGIN);
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(source));
    const vector = Y.encodeStateVector(peer);
    replaceMarkdownYText(source, "column replacement", "external");
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(source, vector));
    expect(classifications).toEqual([true, false]);
    expect(peer.getText("markdown").toString()).toBe("column replacement");
    source.destroy();
    peer.destroy();
  });
});
