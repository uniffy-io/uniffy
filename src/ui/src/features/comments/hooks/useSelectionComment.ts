import { useState, useCallback, useEffect, useRef } from 'react';

interface SelectionInfo {
    from: number;
    to: number;
    text: string;
    rect: DOMRect;
}

/**
 * Hook to detect non-empty text selection in a ProseMirror editor.
 * Returns the selection range, text, and bounding rect for popover positioning.
 */
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
            // Delay to let ProseMirror update its selection
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

                // Check that selection is inside the editor
                if (!container.contains(range.commonAncestorContainer)) {
                    setSelection(null);
                    return;
                }

                // Get the editor view from the global reference
                const view = (window as Window & { __milkdownEditorView?: { state: { selection: { from: number; to: number } } } }).__milkdownEditorView;
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
            // Also check on shift+arrow keys for keyboard selection
            if (e.shiftKey) {
                handleMouseUp();
            }
        };

        container.addEventListener('mouseup', handleMouseUp);
        container.addEventListener('keyup', handleKeyUp);

        return () => {
            container.removeEventListener('mouseup', handleMouseUp);
            container.removeEventListener('keyup', handleKeyUp);
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [editorContainerRef]);

    return { selection, clearSelection };
}
