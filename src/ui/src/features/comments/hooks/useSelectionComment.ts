import { useState, useCallback, useEffect, useRef } from "react";
import { getActiveEditorView } from "@/components/editor/editorRegistry";

interface SelectionInfo {
  from: number;
  to: number;
  text: string;
  rect: DOMRect;
}

/** Detect non-empty selection in a ProseMirror editor; returns range + bounding rect for popover positioning. */
export function useSelectionComment(editorContainerRef: React.RefObject<HTMLElement | null>) {
  const [selection, setSelection] = useState<SelectionInfo | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    const handleMouseUp = () => {
      // Defer to let ProseMirror finish updating its own selection state.
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        const domSelection = window.getSelection();
        if (!domSelection || domSelection.isCollapsed || !domSelection.rangeCount) {
          setSelection(null);
          return;
        }

        const range = domSelection.getRangeAt(0);
        const text = domSelection.toString().trim();
        if (!text) {
          setSelection(null);
          return;
        }

        if (!container.contains(range.commonAncestorContainer)) {
          setSelection(null);
          return;
        }

        const view = getActiveEditorView();
        if (!view) {
          setSelection(null);
          return;
        }

        const rect = range.getBoundingClientRect();
        setSelection({
          from: view.state.selection.from,
          to: view.state.selection.to,
          text,
          rect,
        });
      }, 100);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.shiftKey) {
        handleMouseUp();
      }
    };

    container.addEventListener("mouseup", handleMouseUp);
    container.addEventListener("keyup", handleKeyUp);

    return () => {
      container.removeEventListener("mouseup", handleMouseUp);
      container.removeEventListener("keyup", handleKeyUp);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [editorContainerRef]);

  return { selection, clearSelection };
}
