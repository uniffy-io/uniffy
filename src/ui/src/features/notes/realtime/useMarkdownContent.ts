import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { getMarkdownYText } from '@/features/notes/realtime/markdown';

interface RealtimeMarkdownOptions {
  /**
   * Resolves on first server sync. Before resolution the hook returns
   * `fallback` to avoid a blank-content flash; afterward the Y type is
   * authoritative (so a user clearing the doc reads as empty).
   */
  whenSynced?: Promise<void> | null;
  /**
   * Coalesce remote updates into one render. Use 0 for cheap consumers
   * (CodeMirror) and ~250-300ms for ones that rebuild heavy children
   * on every value change (Milkdown readonly preview).
   */
  debounceMs?: number;
}

/**
 * Subscribe to the canonical markdown in `Y.Text("markdown")`. When `ydoc`
 * is null the caller is outside a realtime session and we fall through to
 * the static `fallback` from the Redux store.
 */
export function useRealtimeMarkdownContent(
  ydoc: Y.Doc | null,
  fallback: string,
  options: RealtimeMarkdownOptions | number = {},
): string {
  const { whenSynced, debounceMs } =
    typeof options === 'number' ? { whenSynced: null, debounceMs: options } : options;
  const debounce = debounceMs ?? 0;

  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  const [synced, setSynced] = useState<boolean>(() => {
    if (!ydoc) return false;
    return getMarkdownYText(ydoc).length > 0;
  });
  const [content, setContent] = useState<string>(() => {
    if (!ydoc) return fallback;
    const initial = getMarkdownYText(ydoc).toString();
    return initial || fallback;
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ydoc) {
      setContent(fallbackRef.current);
      setSynced(false);
      return;
    }
    const ytext = getMarkdownYText(ydoc);
    const apply = () => {
      const next = ytext.toString();
      if (synced || next.length > 0) {
        if (next.length > 0 && !synced) setSynced(true);
        setContent(next);
      } else {
        setContent(fallbackRef.current);
      }
    };
    apply();
    const handler = () => {
      if (debounce <= 0) {
        apply();
        return;
      }
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(apply, debounce);
    };
    ytext.observe(handler);

    let cancelled = false;
    if (whenSynced) {
      void whenSynced.then(() => {
        if (cancelled) return;
        setSynced(true);
        apply();
      });
    }

    return () => {
      cancelled = true;
      ytext.unobserve(handler);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
    // `fallback` is read via ref so a parent render bumping note.content
    // does not re-subscribe; `synced`/`whenSynced` are sticky once set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, debounce, whenSynced]);

  return content;
}
