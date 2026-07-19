import { useCallback, useSyncExternalStore } from 'react';
import type * as Y from 'yjs';
import { useRealtimeMarkdownContent } from '@/features/notes/realtime/useMarkdownContent';

export interface LiveNoteDoc {
  ydoc: Y.Doc;
  whenSynced: Promise<void>;
}

// The multiplexer forbids attaching the same doc twice per tab, so sibling
// surfaces (metadata panel) read the open editor's session through this
// registry instead of opening their own.
const liveDocs = new Map<string, LiveNoteDoc>();
const listeners = new Map<string, Set<() => void>>();

function notify(noteId: string): void {
  const set = listeners.get(noteId);
  if (!set) return;
  for (const listener of set) listener();
}

export function registerLiveNoteDoc(noteId: string, doc: LiveNoteDoc): () => void {
  liveDocs.set(noteId, doc);
  notify(noteId);
  return () => {
    if (liveDocs.get(noteId) !== doc) return;
    liveDocs.delete(noteId);
    notify(noteId);
  };
}

export function getLiveNoteDoc(noteId: string): LiveNoteDoc | null {
  return liveDocs.get(noteId) ?? null;
}

export function subscribeLiveNoteDoc(noteId: string, listener: () => void): () => void {
  let set = listeners.get(noteId);
  if (!set) {
    set = new Set();
    listeners.set(noteId, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(noteId);
  };
}

/** Live markdown when this tab has a realtime session for the note; `fallback` (Redux content) otherwise. */
export function useLiveNoteMarkdown(noteId: string | null, fallback: string): string {
  const subscribe = useCallback(
    (onChange: () => void) => (noteId ? subscribeLiveNoteDoc(noteId, onChange) : () => {}),
    [noteId],
  );
  const live = useSyncExternalStore(subscribe, () => (noteId ? getLiveNoteDoc(noteId) : null));
  return useRealtimeMarkdownContent(live?.ydoc ?? null, fallback, {
    whenSynced: live?.whenSynced ?? null,
    debounceMs: 300,
  });
}
