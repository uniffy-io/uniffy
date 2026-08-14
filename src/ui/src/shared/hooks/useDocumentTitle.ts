import { useEffect } from "react";

const APP_NAME = "Uniffy";

/** Sets `document.title` to `{title} | Uniffy` (or just `Uniffy` when no title). Restores on unmount. */
export function useDocumentTitle(title?: string): void {
  useEffect(() => {
    const previousTitle = document.title;

    if (title) {
      document.title = `${title} | ${APP_NAME}`;
    } else {
      document.title = APP_NAME;
    }

    return () => {
      document.title = previousTitle;
    };
  }, [title]);
}
