import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { getMarkdownYText } from "@features/notes/realtime/markdown";

/**
 * Live read of the canonical `Y.Text("markdown")`. Returns `fallback` until
 * the doc has confirmed content (first sync or non-empty text), so a cold
 * attach never flashes an empty note over fetched content.
 */
export function useRealtimeMarkdownContent(
  ydoc: Y.Doc | null,
  fallback: string,
  options: { whenSynced?: Promise<void> | null; debounceMs?: number } = {},
): string {
  const { whenSynced, debounceMs } = options;
  const debounce = debounceMs ?? 0;

  const fallbackRef = useRef(fallback);
  useEffect(() => {
    fallbackRef.current = fallback;
  });

  // Sync confirmation is per doc: a plain boolean stays stale across note
  // switches (the hook instance survives, the ydoc swaps) and would render
  // note B empty instead of its fallback until its own sync landed.
  const syncedDocRef = useRef<Y.Doc | null>(null);

  const initialFor = (doc: Y.Doc | null): string => {
    if (!doc) return fallback;
    const text = getMarkdownYText(doc).toString();
    return text || fallback;
  };

  const [content, setContent] = useState<string>(() => initialFor(ydoc));
  // Render-time reset on doc switch so note B never flashes note A's content.
  const [prevDoc, setPrevDoc] = useState(ydoc);
  if (prevDoc !== ydoc) {
    setPrevDoc(ydoc);
    setContent(initialFor(ydoc));
  }

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!ydoc) {
      setContent(fallbackRef.current);
      return;
    }
    const ytext = getMarkdownYText(ydoc);
    if (ytext.length > 0) syncedDocRef.current = ydoc;
    const apply = () => {
      const next = ytext.toString();
      if (next.length > 0) syncedDocRef.current = ydoc;
      if (syncedDocRef.current === ydoc) {
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
        syncedDocRef.current = ydoc;
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
    // `fallback` read via ref so parent bumping note.content does not re-subscribe.
  }, [ydoc, debounce, whenSynced]);

  return content;
}
