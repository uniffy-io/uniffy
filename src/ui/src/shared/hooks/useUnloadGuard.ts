import { useEffect } from "react";

/** Native "leave page?" prompt while `active`; the browser owns the copy. */
export function useUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => {
      window.removeEventListener("beforeunload", handler);
    };
  }, [active]);
}
