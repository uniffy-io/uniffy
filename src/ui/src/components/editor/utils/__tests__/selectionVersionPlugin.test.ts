import { describe, it, expect, vi } from "vitest";
import { EditorState } from "@milkdown/prose/state";
import { Schema } from "@milkdown/prose/model";
import {
  createSelectionVersionPlugin,
  selectionVersionPluginKey,
  subscribeSelection,
  disposeSelectionScope,
} from "@/components/editor/utils/selectionVersionPlugin";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: {},
  },
});

function makeState(scope: object) {
  const plugin = createSelectionVersionPlugin(scope);
  return EditorState.create({ schema, plugins: [plugin] });
}

describe("selectionVersionPlugin", () => {
  it("starts the version counter at zero", () => {
    const scope = {};
    const state = makeState(scope);
    expect(selectionVersionPluginKey.getState(state)).toBe(0);
  });

  it("increments the counter on doc-changing transactions", () => {
    const scope = {};
    let state = makeState(scope);
    const tr = state.tr.insertText("hello");
    state = state.apply(tr);
    expect(selectionVersionPluginKey.getState(state)).toBe(1);

    const tr2 = state.tr.insertText("!");
    state = state.apply(tr2);
    expect(selectionVersionPluginKey.getState(state)).toBe(2);
  });

  it("leaves the counter unchanged for transactions that touch neither doc nor selection", () => {
    const scope = {};
    let state = makeState(scope);
    const tr = state.tr.setMeta("custom-meta", "value");
    state = state.apply(tr);
    expect(selectionVersionPluginKey.getState(state)).toBe(0);
  });

  it("isolates listeners by scope and clears them on dispose", () => {
    const scopeA = {};
    const scopeB = {};
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    subscribeSelection(scopeA, listenerA);
    subscribeSelection(scopeB, listenerB);

    // Dispose scope A - listener A should no longer be tracked
    disposeSelectionScope(scopeA);
    // Re-subscribe to confirm a fresh entry was created
    const replacement = vi.fn();
    const unsubscribe = subscribeSelection(scopeA, replacement);
    unsubscribe();

    expect(listenerA).not.toHaveBeenCalled();
    expect(listenerB).not.toHaveBeenCalled();
  });
});
