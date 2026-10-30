import { useEffect, useId } from "react";

// Every layer that closes on Escape (dialogs, drawers, menus, pickers, the
// thread slide-over) registers here, and only the topmost one acts on the key.
// Without the stack each layer's own document listener fires, so one Escape
// closes a picker and the dialog or slide-over beneath it in the same stroke.
// Layers are ordered per document: a menu open in the call pop-out window must
// not swallow an Escape pressed in the main window.
const stack: { id: string; doc: Document }[] = [];

function topmostIn(doc: Document): string | undefined {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    if (stack[index].doc === doc) return stack[index].id;
  }
  return undefined;
}

/** Closes this overlay on Escape while it is the topmost registered layer of its document. */
export function useOverlayEscape(onEscape: () => void, active = true, ownerDocument?: Document) {
  const id = useId();

  useEffect(() => {
    if (!active) return;
    const entry = { id, doc: ownerDocument ?? document };
    stack.push(entry);
    return () => {
      const index = stack.indexOf(entry);
      if (index >= 0) stack.splice(index, 1);
    };
  }, [active, id, ownerDocument]);

  useEffect(() => {
    if (!active) return;
    const targetDocument = ownerDocument ?? document;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (topmostIn(targetDocument) !== id) return;
      onEscape();
    }
    targetDocument.addEventListener("keydown", handleKeyDown);
    return () => targetDocument.removeEventListener("keydown", handleKeyDown);
  }, [active, id, onEscape, ownerDocument]);
}
