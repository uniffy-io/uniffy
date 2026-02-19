/**
 * useCanvasHistory - Undo/redo stack for canvas state.
 *
 * Maintains a stack of canvas states (max 50) with debounced coalescing.
 * Provides pushState(), undo(), redo() operations.
 */

import { useCallback, useRef } from 'react';
import type { CanvasState } from '@/features/notes/canvas/types';

const MAX_HISTORY = 50;

interface CanvasHistory {
  past: CanvasState[];
  future: CanvasState[];
}

interface UseCanvasHistoryResult {
  pushState: (state: CanvasState) => void;
  undo: (currentState: CanvasState) => CanvasState | null;
  redo: (currentState: CanvasState) => CanvasState | null;
}

export function useCanvasHistory(): UseCanvasHistoryResult {
  const historyRef = useRef<CanvasHistory>({ past: [], future: [] });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pushState = useCallback((state: CanvasState) => {
    // Debounce to coalesce rapid changes
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(() => {
      const history = historyRef.current;
      history.past.push(state);
      if (history.past.length > MAX_HISTORY) {
        history.past.shift();
      }
      // Clear future on new action
      history.future = [];
    }, 500);
  }, []);

  const undo = useCallback((currentState: CanvasState): CanvasState | null => {
    const history = historyRef.current;
    if (history.past.length === 0) return null;

    const previous = history.past.pop()!;
    history.future.push(currentState);

    return previous;
  }, []);

  const redo = useCallback((currentState: CanvasState): CanvasState | null => {
    const history = historyRef.current;
    if (history.future.length === 0) return null;

    const next = history.future.pop()!;
    history.past.push(currentState);

    return next;
  }, []);

  return { pushState, undo, redo };
}
