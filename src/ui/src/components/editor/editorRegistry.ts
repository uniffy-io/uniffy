import type { Editor } from '@milkdown/core';
import type { EditorView } from '@milkdown/prose/view';

export interface EditorRegistryEntry {
  editor: Editor;
  view: EditorView;
}

const entries = new Set<EditorRegistryEntry>();
let activeEntry: EditorRegistryEntry | null = null;

type WindowWithEditor = Window & {
  __milkdownEditor?: Editor;
  __milkdownEditorView?: EditorView;
};

function setActive(entry: EditorRegistryEntry | null): void {
  activeEntry = entry;
  const w = window as WindowWithEditor;
  if (entry) {
    w.__milkdownEditor = entry.editor;
    w.__milkdownEditorView = entry.view;
  } else {
    delete w.__milkdownEditor;
    delete w.__milkdownEditorView;
  }
}

/**
 * Tracks the focused CrepeEditor across coexisting mounts (chat bubbles,
 * canvas previews, expandable modals). Selection-driven UI (toolbar
 * callbacks, mention input rule, comment selection) reads through
 * `getActiveEditorView` so it never targets a destroyed or unfocused view.
 */
export function registerEditor(entry: EditorRegistryEntry): () => void {
  entries.add(entry);
  setActive(entry);

  const onFocus = () => setActive(entry);
  entry.view.dom.addEventListener('focusin', onFocus);

  return () => {
    entry.view.dom.removeEventListener('focusin', onFocus);
    entries.delete(entry);
    if (activeEntry === entry) {
      const next = entries.values().next().value ?? null;
      setActive(next);
    }
  };
}

export function getActiveEditor(): Editor | null {
  return activeEntry?.editor ?? null;
}

export function getActiveEditorView(): EditorView | null {
  if (activeEntry && activeEntry.view.isDestroyed) {
    return null;
  }
  return activeEntry?.view ?? null;
}
