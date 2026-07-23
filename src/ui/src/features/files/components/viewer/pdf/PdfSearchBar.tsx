import { useEffect } from 'react';
import { CaretDown, CaretUp, Spinner, X } from '@phosphor-icons/react';

interface PdfSearchBarProps {
    query: string;
    activeOrdinal: number;
    totalMatches: number;
    searching: boolean;
    onQueryChange: (query: string) => void;
    onNext: () => void;
    onPrev: () => void;
    onClose: () => void;
}

export function PdfSearchBar({
    query,
    activeOrdinal,
    totalMatches,
    searching,
    onQueryChange,
    onNext,
    onPrev,
    onClose,
}: PdfSearchBarProps) {
    // Capture-phase Escape closes search before the modal's viewer.close handler sees it,
    // regardless of where focus sits.
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [onClose]);

    const hasQuery = query.trim().length > 0;

    return (
        <div className="viewer-pdf-searchbar">
            <input
                type="text"
                autoFocus
                value={query}
                placeholder="Search in document"
                onChange={(event) => onQueryChange(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        if (event.shiftKey) {
                            onPrev();
                        } else {
                            onNext();
                        }
                    }
                }}
                className="viewer-pdf-searchbar-input"
                aria-label="Search in document"
            />
            <span className="viewer-pdf-searchbar-count">
                {searching ? (
                    <Spinner size={14} className="animate-spin" />
                ) : hasQuery ? (
                    totalMatches > 0 ? (
                        `${activeOrdinal} of ${totalMatches}`
                    ) : (
                        'No results'
                    )
                ) : null}
            </span>
            <button
                onClick={onPrev}
                disabled={totalMatches === 0}
                className="viewer-btn p-1.5"
                title="Previous match (Shift+Enter)"
            >
                <CaretUp size={16} />
            </button>
            <button
                onClick={onNext}
                disabled={totalMatches === 0}
                className="viewer-btn p-1.5"
                title="Next match (Enter)"
            >
                <CaretDown size={16} />
            </button>
            <button onClick={onClose} className="viewer-btn p-1.5" title="Close search (Esc)">
                <X size={16} />
            </button>
        </div>
    );
}
