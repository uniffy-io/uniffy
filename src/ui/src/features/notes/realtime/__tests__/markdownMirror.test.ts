import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  isMarkdownMirrorLeader,
  MARKDOWN_MIRROR_FIELD,
  MARKDOWN_MIRROR_ORIGIN,
  replaceMarkdownYText,
} from "@/features/notes/realtime/markdown";

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
