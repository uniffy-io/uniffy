/**
 * Spotlight Search Component
 *
 * A macOS Spotlight-style search popup that can be triggered globally.
 * Opens with Ctrl+K (Cmd+K on Mac) and navigates to selected result.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useSearch } from '../hooks/useSearch';
import { useSpotlightOpenListener } from '../hooks/useSpotlightTrigger';
import { SearchResultsList } from './SearchResultsList';
import { useShortcutHandler, useFormattedKeybinding } from '@/features/settings';
import type { SearchResultItem } from '@/gen/search/v1/search_pb';
import { cn } from '@/utils/cn';

export function SpotlightSearch() {
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [copiedUrn, setCopiedUrn] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const { query, setQuery, results, isLoading, clearResults } = useSearch();
    const shortcutDisplay = useFormattedKeybinding('nav.search');

    // Compute bounded index inline to handle when results change
    // This avoids calling setState in an effect which causes cascading renders
    const boundedSelectedIndex = results.length === 0 ? 0 : Math.min(selectedIndex, results.length - 1);

    // Copy selected result's URN to clipboard
    const copySelectedUrn = useCallback(async () => {
        const selected = results[boundedSelectedIndex];
        if (!selected?.urn) return;

        try {
            // Try modern clipboard API first
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(selected.urn);
            } else {
                // Fallback for non-HTTPS contexts
                const textArea = document.createElement('textarea');
                textArea.value = selected.urn;
                textArea.style.position = 'fixed';
                textArea.style.left = '-9999px';
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }
            setCopiedUrn(true);
            setTimeout(() => setCopiedUrn(false), 1500);
        } catch (err) {
            console.error('Failed to copy URN:', err);
        }
    }, [results, boundedSelectedIndex]);

    // Open spotlight with keyboard shortcut or programmatic trigger
    const handleOpen = useCallback(() => {
        setIsOpen(true);
    }, []);

    const handleClose = useCallback(() => {
        setIsOpen(false);
        clearResults();
    }, [clearResults]);

    const handleResultSelect = useCallback((result: SearchResultItem) => {
        navigate(result.url);
        handleClose();
    }, [navigate, handleClose]);

    useShortcutHandler('nav.search', handleOpen);
    useSpotlightOpenListener(handleOpen);

    // Focus input when opened
    useEffect(() => {
        if (isOpen) {
            // Small delay to ensure the input is rendered
            const timer = setTimeout(() => {
                inputRef.current?.focus();
            }, 10);
            return () => clearTimeout(timer);
        }
    }, [isOpen]);

    // Close on escape or click outside
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                handleClose();
            }
        };

        const handleClickOutside = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                handleClose();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('mousedown', handleClickOutside);

        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen, handleClose]);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(e.target.value);
    };

    const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        // Handle Ctrl/Cmd+C to copy URN
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            if (results.length > 0) {
                e.preventDefault();
                copySelectedUrn();
            }
        }
    };

    const handleClear = () => {
        clearResults();
        inputRef.current?.focus();
    };

    if (!isOpen) {
        return null;
    }

    return (
        <>
            {/* Backdrop overlay */}
            <div className="fixed inset-0 bg-background/60 backdrop-blur-sm z-[999] animate-in fade-in-0 duration-150" />

            {/* Centered popup container */}
            <div className="fixed inset-0 z-[1000] flex items-start justify-center pt-[15vh]">
                <div
                    ref={containerRef}
                    className="w-full max-w-2xl mx-4 animate-in fade-in-0 zoom-in-95 slide-in-from-top-4 duration-200"
                >
                    {/* Search input card */}
                    <div className="rounded-2xl border-2 border-primary/50 bg-card shadow-2xl ring-4 ring-primary/10 overflow-hidden">
                        {/* Search input */}
                        <div className="relative flex items-center border-b border-border/50">
                            <MagnifyingGlassIcon className="absolute left-4 h-5 w-5 text-muted-foreground" />
                            <input
                                ref={inputRef}
                                type="text"
                                value={query}
                                onChange={handleInputChange}
                                onKeyDown={handleInputKeyDown}
                                placeholder="Search notes, files, and more..."
                                className={cn(
                                    "w-full h-14 bg-transparent pl-12 pr-20 text-lg",
                                    "placeholder:text-muted-foreground/60",
                                    "focus:outline-none"
                                )}
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck={false}
                            />
                            <div className="absolute right-4 flex items-center gap-2">
                                {query && (
                                    <button
                                        onClick={handleClear}
                                        className="p-1 rounded-md hover:bg-muted transition-colors"
                                    >
                                        <XMarkIcon className="h-4 w-4 text-muted-foreground" />
                                    </button>
                                )}
                                <kbd className="hidden sm:inline-flex px-2 py-1 rounded-md bg-muted border border-border/50 text-xs text-muted-foreground font-mono">
                                    esc
                                </kbd>
                            </div>
                        </div>

                        {/* Results or empty prompt */}
                        {query.trim() || isLoading ? (
                            <SearchResultsList
                                results={results}
                                isLoading={isLoading}
                                query={query}
                                onSelect={handleResultSelect}
                                onClose={handleClose}
                                className="border-0 shadow-none ring-0 rounded-none max-h-[60vh]"
                                showHeader={false}
                                showFooter={true}
                                selectedIndex={boundedSelectedIndex}
                                onSelectedIndexChange={setSelectedIndex}
                                copiedUrn={copiedUrn}
                            />
                        ) : (
                            <div className="py-8 px-4 text-center">
                                <p className="text-sm text-muted-foreground">
                                    Type to search across all your content
                                </p>
                                <p className="text-xs text-muted-foreground/60 mt-2">
                                    Press <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/50 font-mono text-[10px]">{shortcutDisplay}</kbd> anytime to open search
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
