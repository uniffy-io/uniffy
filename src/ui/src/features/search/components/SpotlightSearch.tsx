/**
 * Spotlight Search Component
 *
 * A macOS Spotlight-style search popup that can be triggered globally.
 * Opens with Ctrl+K (Cmd+K on Mac) and navigates to selected result.
 *
 * Supports Google-style keyword filters:
 * - Type filters: note:, file:, user:, calendar:
 * - Tag filters: tag:work
 * - Ownership: my: (current user's content)
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { useSearch } from '@/features/search/hooks/useSearch';
import { useSpotlightOpenListener } from '@/features/search/hooks/useSpotlightTrigger';
import { SearchResultsList } from '@/features/search/components/SearchResultsList';
import { FilterChip } from '@/features/search/components/FilterChip';
import { FilterHints } from '@/features/search/components/FilterHints';
import { useShortcutHandler, useFormattedKeybinding } from '@/features/settings';
import type { SearchResultItem } from '@/gen/search/v1/search_pb';
import { cn } from '@/shared/utils/cn';
import {
    getTypeFilterLabel,
    removeTypeFilterFromQuery,
    removeTagFilterFromQuery,
    removeMyFilterFromQuery,
    removeProjectFilterFromQuery,
    removePhraseFromQuery,
} from '@/features/search/utils/queryParser';

export function SpotlightSearch() {
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [copiedUrn, setCopiedUrn] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const { query, setQuery, results, isLoading, clearResults, parsedQuery, hasFilters } = useSearch();
    const shortcutDisplay = useFormattedKeybinding('nav.search');

    // Filter removal handlers
    const handleRemoveTypeFilter = useCallback((type: number) => {
        const newQuery = removeTypeFilterFromQuery(query, type);
        setQuery(newQuery);
    }, [query, setQuery]);

    const handleRemoveTagFilter = useCallback((tag: string) => {
        const newQuery = removeTagFilterFromQuery(query, tag);
        setQuery(newQuery);
    }, [query, setQuery]);

    const handleRemoveProjectFilter = useCallback((project: string) => {
        const newQuery = removeProjectFilterFromQuery(query, project);
        setQuery(newQuery);
    }, [query, setQuery]);

    const handleRemoveMyFilter = useCallback(() => {
        const newQuery = removeMyFilterFromQuery(query);
        setQuery(newQuery);
    }, [query, setQuery]);

    const handleRemovePhraseFilter = useCallback((phrase: string) => {
        const newQuery = removePhraseFromQuery(query, phrase);
        setQuery(newQuery);
    }, [query, setQuery]);

    const handleFilterHintClick = useCallback((filter: string) => {
        setQuery(filter + ' ');
        inputRef.current?.focus();
    }, [setQuery]);

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
                            <MagnifyingGlass size={20} weight="bold" className="absolute left-4 text-muted-foreground" />
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
                                        <X size={16} weight="bold" className="text-muted-foreground" />
                                    </button>
                                )}
                                <kbd className="hidden sm:inline-flex px-2 py-1 rounded-md bg-muted border border-border/50 text-xs text-muted-foreground font-mono">
                                    esc
                                </kbd>
                            </div>
                        </div>

                        {/* Active filters display */}
                        {hasFilters && (
                            <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-border/50 bg-muted/30">
                                {parsedQuery.filters.types.map((type) => (
                                    <FilterChip
                                        key={`type-${type}`}
                                        label={getTypeFilterLabel(type)}
                                        onRemove={() => handleRemoveTypeFilter(type)}
                                    />
                                ))}
                                {parsedQuery.filters.tags.map((tag) => (
                                    <FilterChip
                                        key={`tag-${tag}`}
                                        label={`tag:${tag}`}
                                        onRemove={() => handleRemoveTagFilter(tag)}
                                    />
                                ))}
                                {parsedQuery.filters.projects.map((project) => (
                                    <FilterChip
                                        key={`project-${project}`}
                                        label={`project:${project}`}
                                        onRemove={() => handleRemoveProjectFilter(project)}
                                    />
                                ))}
                                {parsedQuery.filters.myContentOnly && (
                                    <FilterChip
                                        label="My content"
                                        onRemove={handleRemoveMyFilter}
                                    />
                                )}
                                {parsedQuery.filters.exactPhrases.map((phrase) => (
                                    <FilterChip
                                        key={`phrase-${phrase}`}
                                        label={`"${phrase}"`}
                                        variant="exact"
                                        onRemove={() => handleRemovePhraseFilter(phrase)}
                                    />
                                ))}
                            </div>
                        )}

                        {/* Results or empty prompt */}
                        {query.trim() || isLoading || hasFilters ? (
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
                                <p className="text-xs text-muted-foreground/60 mt-2 mb-4">
                                    Press <kbd className="px-1.5 py-0.5 rounded bg-muted border border-border/50 font-mono text-[10px]">{shortcutDisplay}</kbd> anytime to open search
                                </p>
                                <FilterHints onHintClick={handleFilterHintClick} />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
}
