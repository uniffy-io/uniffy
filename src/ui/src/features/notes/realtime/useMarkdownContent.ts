import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { getMarkdownYText } from '@/features/notes/realtime/markdown';

interface RealtimeMarkdownOptions {
  // Before resolution we return `fallback` to avoid a blank-content flash; after, Y.Text is authoritative.
  whenSynced?: Promise<void> | null;
  debounceMs?: number;
}

/** Subscribes to canonical markdown in `Y.Text("markdown")`; falls back to Redux when no session. */
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
    // `fallback` read via ref so parent bumping note.content does not re-subscribe; sync flags sticky.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ydoc, debounce, whenSynced]);

  return content;
}
