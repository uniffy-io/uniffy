import { useCallback, useEffect, useRef, useState } from "react";

const COPIED_FEEDBACK_MS = 2000;

/** Copies text and reports `copied` briefly, only once the browser accepted the write. */
export function useCopyToClipboard(feedbackMs = COPIED_FEEDBACK_MS) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Denied permission or an insecure context; the label stays on "Copy".
        return false;
      }
      if (timer.current) clearTimeout(timer.current);
      setCopied(true);
      timer.current = setTimeout(() => setCopied(false), feedbackMs);
      return true;
    },
    [feedbackMs],
  );

  return { copied, copy };
}
