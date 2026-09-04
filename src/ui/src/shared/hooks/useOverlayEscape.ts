import { useEffect, useId } from "react";

// Every layer that closes on Escape (dialogs, drawers, menus, pickers, the
// thread slide-over) registers here, and only the topmost one acts on the key.
// Without the stack each layer's own document listener fires, so one Escape
// closes a picker and the dialog or slide-over beneath it in the same stroke.
const stack: string[] = [];

/** Closes this overlay on Escape while it is the topmost registered layer. */
export function useOverlayEscape(onEscape: () => void, active = true) {
  const id = useId();

  useEffect(() => {
    if (!active) return;
    stack.push(id);
    return () => {
      const index = stack.indexOf(id);
      if (index >= 0) stack.splice(index, 1);
    };
  }, [active, id]);

  useEffect(() => {
    if (!active) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (stack[stack.length - 1] !== id) return;
      onEscape();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active, id, onEscape]);
}
