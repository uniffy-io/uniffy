import { Plugin, PluginKey } from '@milkdown/prose/state';

export const selectionVersionPluginKey = new PluginKey<number>('editor-selection-version');

export type SelectionListener = () => void;

interface ListenerEntry {
  readonly listeners: Set<SelectionListener>;
}

const ENTRIES = new WeakMap<object, ListenerEntry>();

function getEntry(key: object): ListenerEntry {
  let entry = ENTRIES.get(key);
  if (!entry) {
    entry = { listeners: new Set() };
    ENTRIES.set(key, entry);
  }
  return entry;
}

export function createSelectionVersionPlugin(scope: object) {
  return new Plugin<number>({
    key: selectionVersionPluginKey,
    state: {
      init: () => 0,
      apply: (tr, value) => {
        if (tr.docChanged || tr.selectionSet) return value + 1;
        return value;
      },
    },
    view: () => ({
      update: (view, prevState) => {
        const next = selectionVersionPluginKey.getState(view.state) ?? 0;
        const prev = selectionVersionPluginKey.getState(prevState) ?? 0;
        if (next === prev) return;
        for (const fn of getEntry(scope).listeners) fn();
      },
    }),
  });
}

export function subscribeSelection(scope: object, fn: SelectionListener): () => void {
  const entry = getEntry(scope);
  entry.listeners.add(fn);
  return () => {
    entry.listeners.delete(fn);
  };
}

export function disposeSelectionScope(scope: object) {
  ENTRIES.delete(scope);
}
