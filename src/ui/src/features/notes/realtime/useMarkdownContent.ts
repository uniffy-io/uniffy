import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { getMarkdownYText } from "@/features/realtime/markdown";

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
    typeof options === "number" ? { whenSynced: null, debounceMs: options } : options;
  const debounce = debounceMs ?? 0;

  const fallbackRef = useRef(fallback);
  useEffect(() => {
    fallbackRef.current = fallback;
  });

  // Sync confirmation belongs to one document, including an authoritative empty value.
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

  return ydoc ? content : fallback;
}
