import { diffStrings } from "@features/notes/realtime/textDiff";

// Gboard keeps a composing span on the word under the caret until a separator
// is typed or the caret leaves it; replacing the buffer inside that span
// splits or duplicates the word. React Native exposes no composition event,
// so the span is inferred from the last text change and the caret. The hold
// caps how long one unfinished word can keep peer edits off screen.
export const COMPOSITION_HOLD_MS = 2500;

const WORD_CHAR_RE = /[\p{L}\p{N}\p{M}'’]/u;

export interface CompositionTracker {
  textChanged: (previous: string, next: string, now: number) => void;
  selectionChanged: (start: number, end: number) => void;
  reset: () => void;
  isComposing: (now: number) => boolean;
}

export function createCompositionTracker(holdMs = COMPOSITION_HOLD_MS): CompositionTracker {
  // Display index right after the word being composed; -1 when none.
  let wordEnd = -1;
  let changedAt = 0;
  return {
    textChanged(previous, next, now) {
      const delta = diffStrings(previous, next);
      if (!delta) return;
      const end = delta.index + delta.insert.length;
      wordEnd = end > 0 && WORD_CHAR_RE.test(next[end - 1]) ? end : -1;
      changedAt = now;
    },
    // Platforms disagree on whether the selection event precedes the text
    // event for a keystroke; either order lands with the caret at the word
    // end, so only a caret elsewhere ends composition.
    selectionChanged(start, end) {
      if (wordEnd >= 0 && (start !== wordEnd || end !== wordEnd)) wordEnd = -1;
    },
    reset() {
      wordEnd = -1;
    },
    isComposing(now) {
      return wordEnd >= 0 && now - changedAt < holdMs;
    },
  };
}
