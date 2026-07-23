import { useCallback, useMemo, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { findMatchesInText } from '@/features/files/components/viewer/pdf/pdfSearch';

export interface PdfSearchApi {
    open: boolean;
    query: string;
    matchesPerPage: Map<number, number>;
    totalMatches: number;
    /** 1-based ordinal of the active match across the document; 0 when there are none. */
    activeOrdinal: number;
    searching: boolean;
    openSearch: () => void;
    closeSearch: () => void;
    setQuery: (query: string) => void;
    next: () => void;
    prev: () => void;
}

export function usePdfSearch(
    pdf: PDFDocumentProxy | null,
    numPages: number,
    onJumpToPage: (page: number) => void
): PdfSearchApi {
    const [open, setOpen] = useState(false);
    const [query, setQueryState] = useState('');
    const [searching, setSearching] = useState(false);
    const [matchesPerPage, setMatchesPerPage] = useState<Map<number, number>>(() => new Map());
    const [activeOrdinal, setActiveOrdinal] = useState(0);

    const pageTextsRef = useRef<Map<number, string> | null>(null);
    const extractionRef = useRef<Promise<Map<number, string>> | null>(null);
    /** Stale async results are discarded by comparing against the latest generation. */
    const searchGenRef = useRef(0);

    const ensureTexts = useCallback((): Promise<Map<number, string>> | null => {
        if (!pdf) return null;
        if (!extractionRef.current) {
            extractionRef.current = (async () => {
                const texts = new Map<number, string>();
                for (let pageNumber = 1; pageNumber <= numPages; pageNumber += 1) {
                    const page = await pdf.getPage(pageNumber);
                    const content = await page.getTextContent();
                    texts.set(
                        pageNumber,
                        content.items.map((item) => ('str' in item ? item.str : '')).join(' ')
                    );
                }
                pageTextsRef.current = texts;
                return texts;
            })();
        }
        return extractionRef.current;
    }, [pdf, numPages]);

    const totalMatches = useMemo(() => {
        let total = 0;
        for (const count of matchesPerPage.values()) total += count;
        return total;
    }, [matchesPerPage]);

    const pageForOrdinal = useCallback(
        (counts: Map<number, number>, ordinal: number): number | null => {
            let remaining = ordinal;
            const pages = [...counts.keys()].sort((a, b) => a - b);
            for (const pageNumber of pages) {
                const count = counts.get(pageNumber) ?? 0;
                if (remaining <= count) return pageNumber;
                remaining -= count;
            }
            return null;
        },
        []
    );

    const setQuery = useCallback(
        (rawQuery: string) => {
            setQueryState(rawQuery);
            const generation = ++searchGenRef.current;
            const trimmed = rawQuery.trim();
            if (!trimmed) {
                setMatchesPerPage(new Map());
                setActiveOrdinal(0);
                setSearching(false);
                return;
            }
            const extraction = ensureTexts();
            if (!extraction) return;
            setSearching(true);
            void extraction
                .then((texts) => {
                    if (generation !== searchGenRef.current) return;
                    const counts = new Map<number, number>();
                    for (const [pageNumber, text] of texts) {
                        const count = findMatchesInText(text, trimmed);
                        if (count > 0) counts.set(pageNumber, count);
                    }
                    setMatchesPerPage(counts);
                    setSearching(false);
                    if (counts.size > 0) {
                        setActiveOrdinal(1);
                        const firstPage = pageForOrdinal(counts, 1);
                        if (firstPage !== null) onJumpToPage(firstPage);
                    } else {
                        setActiveOrdinal(0);
                    }
                })
                .catch(() => {
                    // Document destroyed mid-extraction (file switch); drop the result.
                    if (generation === searchGenRef.current) setSearching(false);
                });
        },
        [ensureTexts, onJumpToPage, pageForOrdinal]
    );

    const step = useCallback(
        (direction: 1 | -1) => {
            if (totalMatches === 0) return;
            let ordinal = activeOrdinal + direction;
            if (ordinal > totalMatches) ordinal = 1;
            if (ordinal < 1) ordinal = totalMatches;
            setActiveOrdinal(ordinal);
            const page = pageForOrdinal(matchesPerPage, ordinal);
            if (page !== null) onJumpToPage(page);
        },
        [totalMatches, activeOrdinal, matchesPerPage, pageForOrdinal, onJumpToPage]
    );

    const next = useCallback(() => step(1), [step]);
    const prev = useCallback(() => step(-1), [step]);

    const openSearch = useCallback(() => setOpen(true), []);

    const closeSearch = useCallback(() => {
        searchGenRef.current += 1;
        setOpen(false);
        setQueryState('');
        setMatchesPerPage(new Map());
        setActiveOrdinal(0);
        setSearching(false);
    }, []);

    return {
        open,
        query,
        matchesPerPage,
        totalMatches,
        activeOrdinal,
        searching,
        openSearch,
        closeSearch,
        setQuery,
        next,
        prev,
    };
}
