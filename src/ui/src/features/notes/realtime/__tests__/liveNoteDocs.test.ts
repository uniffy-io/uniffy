import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  getLiveNoteDoc,
  registerLiveNoteDoc,
  subscribeLiveNoteDoc,
  type LiveNoteDoc,
} from '@/features/notes/realtime/liveNoteDocs';

function liveDoc(): LiveNoteDoc {
  return { ydoc: new Y.Doc(), whenSynced: Promise.resolve() };
}

describe('registerLiveNoteDoc', () => {
  it('exposes the doc to readers and notifies subscribers on both edges', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLiveNoteDoc('note-1', listener);

    const doc = liveDoc();
    const unregister = registerLiveNoteDoc('note-1', doc);
    expect(getLiveNoteDoc('note-1')).toBe(doc);
    expect(listener).toHaveBeenCalledTimes(1);

    unregister();
    expect(getLiveNoteDoc('note-1')).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it('does not let a stale unregister remove a newer registration', () => {
    const first = liveDoc();
    const second = liveDoc();
    const unregisterFirst = registerLiveNoteDoc('note-2', first);
    const unregisterSecond = registerLiveNoteDoc('note-2', second);

    unregisterFirst();
    expect(getLiveNoteDoc('note-2')).toBe(second);
    unregisterSecond();
    expect(getLiveNoteDoc('note-2')).toBeNull();
  });

  it('scopes notifications to the registered note id', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLiveNoteDoc('note-3', listener);
    const unregister = registerLiveNoteDoc('note-4', liveDoc());
    expect(listener).not.toHaveBeenCalled();
    unregister();
    unsubscribe();
  });
});
