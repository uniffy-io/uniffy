import { describe, expect, it } from "vitest";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import * as Y from "yjs";
import {
  applyCodeMirrorMarkdown,
  bindCodeMirrorMarkdown,
} from "@/features/realtime/codeMirrorBinding";

describe("CodeMirror shared text binding", () => {
  it("applies peer deltas before the next local input without erasing peer text", () => {
    const doc = new Y.Doc();
    const text = doc.getText("markdown");
    text.insert(0, "hello");
    let state = EditorState.create({ doc: "hello" });
    const dispatch = (spec: TransactionSpec) => {
      const transaction = state.update(spec);
      state = transaction.state;
      applyCodeMirrorMarkdown({ transactions: [transaction] }, text, "local");
    };
    const stop = bindCodeMirrorMarkdown({ dispatch }, text, "local");
    doc.transact(() => text.insert(5, " peer"), "remote");
    expect(state.doc.toString()).toBe("hello peer");
    dispatch({ changes: { from: 0, insert: "local " } });
    expect(text.toString()).toBe("local hello peer");
    expect(doc.getMap("markdown_mirror").get("active")).toBe(false);
    doc.transact(() => {
      text.delete(6, 5);
      text.insert(6, "world");
    }, "remote");
    expect(state.doc.toString()).toBe("local world peer");
    dispatch({
      changes: [
        { from: 0, to: 6 },
        { from: 11, insert: "!" },
      ],
    });
    expect(text.toString()).toBe("world! peer");
    stop();
    doc.destroy();
  });
});
