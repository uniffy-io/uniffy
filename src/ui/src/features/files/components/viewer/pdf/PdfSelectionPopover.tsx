import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { Copy, Quotes } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { buildQuoteMarkdown } from '@/features/files/components/viewer/pdf/pdfQuote';

interface PdfSelectionPopoverProps {
    /** Positioned ancestor the popover coordinates are relative to (the PDF layout div). */
    layoutRef: RefObject<HTMLDivElement | null>;
    /** Scroll container holding the page wrappers; scrolling dismisses the popover. */
    containerRef: RefObject<HTMLDivElement | null>;
    filename: string;
    fileId: string;
}

interface SelectionAnchor {
    left: number;
    top: number;
    text: string;
    page: number;
}

function closestPageWrapper(node: Node | null): HTMLElement | null {
    const element = node instanceof Element ? node : node?.parentElement;
    return element?.closest('[data-page]') ?? null;
}

export function PdfSelectionPopover({
    layoutRef,
    containerRef,
    filename,
    fileId,
}: PdfSelectionPopoverProps) {
    const [anchor, setAnchor] = useState<SelectionAnchor | null>(null);
    const popoverRef = useRef<HTMLDivElement | null>(null);

    const updateFromSelection = useCallback(() => {
        const layout = layoutRef.current;
        const selection = window.getSelection();
        if (!layout || !selection || selection.isCollapsed || selection.rangeCount === 0) {
            setAnchor(null);
            return;
        }
        const wrapper = closestPageWrapper(selection.anchorNode);
        if (!wrapper || !layout.contains(wrapper)) {
            setAnchor(null);
            return;
        }
        const text = selection.toString().trim();
        if (!text) {
            setAnchor(null);
            return;
        }
        const rect = selection.getRangeAt(0).getBoundingClientRect();
        const layoutRect = layout.getBoundingClientRect();
        setAnchor({
            left: rect.left - layoutRect.left + rect.width / 2,
            top: rect.top - layoutRect.top,
            text,
            page: Number(wrapper.dataset.page) || 1,
        });
    }, [layoutRef]);

    useEffect(() => {
        const handleMouseUp = (event: MouseEvent) => {
            if (popoverRef.current?.contains(event.target as Node)) return;
            // Selection settles after mouseup; read it on the next tick.
            window.setTimeout(updateFromSelection, 0);
        };
        const handleSelectionChange = () => {
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed) {
                setAnchor(null);
            }
        };
        document.addEventListener('mouseup', handleMouseUp);
        document.addEventListener('selectionchange', handleSelectionChange);
        return () => {
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('selectionchange', handleSelectionChange);
        };
    }, [updateFromSelection]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !anchor) return;
        const dismiss = () => setAnchor(null);
        container.addEventListener('scroll', dismiss, { passive: true });
        return () => container.removeEventListener('scroll', dismiss);
    }, [containerRef, anchor]);

    if (!anchor) return null;

    const copy = async (content: string, message: string) => {
        try {
            await navigator.clipboard.writeText(content);
            toast.success(message);
        } catch {
            toast.error('Failed to copy');
        }
        setAnchor(null);
        window.getSelection()?.removeAllRanges();
    };

    return (
        <div
            ref={popoverRef}
            className="viewer-pdf-selection-popover"
            style={{ left: anchor.left, top: anchor.top }}
        >
            <button
                onClick={() => void copy(anchor.text, 'Copied')}
                className="viewer-btn px-2.5 py-1.5 text-xs inline-flex items-center gap-1.5"
            >
                <Copy size={14} />
                Copy
            </button>
            <button
                onClick={() =>
                    void copy(
                        buildQuoteMarkdown(anchor.text, filename, fileId, anchor.page),
                        'Quote copied'
                    )
                }
                className="viewer-btn px-2.5 py-1.5 text-xs inline-flex items-center gap-1.5"
            >
                <Quotes size={14} />
                Copy as quote
            </button>
        </div>
    );
}
