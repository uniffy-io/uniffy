/**
 * Global Search Component
 *
 * A modern command-palette style search bar for the header.
 * Expands on focus to become the central interaction point.
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { useSearch } from '@/features/search/hooks/useSearch';
import { SearchResultsList } from '@/features/search/components/SearchResultsList';
import { cn } from '@/shared/utils/cn';
import { useFormattedKeybinding } from '@/features/settings';
import { useAppDispatch } from '@/app/hooks';
import { openViewerWithFetch } from '@/features/files';
import { SearchResultType } from '@/gen/search/v1/search_pb';
import type { SearchResultItem } from '@/gen/search/v1/search_pb';

export function GlobalSearch() {
    const navigate = useNavigate();
    const dispatch = useAppDispatch();
    const [isOpen, setIsOpen] = useState(false);
    const [isFocused, setIsFocused] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const { query, setQuery, results, isLoading, clearResults } = useSearch();
    const searchShortcut = useFormattedKeybinding('nav.search');

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setIsFocused(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleResultSelect = (result: SearchResultItem) => {
        // For FILE results, open the viewer modal instead of navigating
        // This keeps the user on their current page
        if (result.type === SearchResultType.FILE) {
            // Extract file ID from URN (urn:uniffy:content:FILE:uuid)
            const fileId = result.urn.split(':').pop();
            if (fileId) {
                dispatch(openViewerWithFetch({ fileId }));
            }
        } else {
            navigate(result.url);
        }
        setIsOpen(false);
        setIsFocused(false);
        clearResults();
        inputRef.current?.blur();
    };

    const handleClose = () => {
        setIsOpen(false);
        setIsFocused(false);
        inputRef.current?.blur();
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(e.target.value);
        if (e.target.value.trim()) {
            setIsOpen(true);
        }
    };

    const handleClear = () => {
        clearResults();
        setIsOpen(false);
        inputRef.current?.focus();
    };

    return (
        <div ref={containerRef} className="relative">
            {/* Search Input Container */}
            <div
                className={cn(
                    "group relative flex items-center",
                    "transition-all duration-500 ease-out",
                    isFocused ? "w-[420px]" : "w-64"
                )}
            >
                {/* Glow effect when focused */}
                <div className={cn(
                    "absolute -inset-1 rounded-xl opacity-0 blur-md transition-opacity duration-500",
                    "bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20",
                    isFocused && "opacity-100"
                )} />

                {/* Input wrapper */}
                <div className={cn(
                    "relative w-full flex items-center rounded-lg overflow-hidden",
                    "transition-all duration-300",
                    isFocused
                        ? "bg-card border border-primary/30 shadow-lg"
                        : "bg-muted/60 border border-transparent hover:bg-muted/80"
                )}>
                    {/* Search icon */}
                    <div className={cn(
                        "flex items-center justify-center w-9 h-8 shrink-0",
                        "transition-colors duration-300",
                        isFocused ? "text-primary" : "text-muted-foreground"
                    )}>
                        <MagnifyingGlass size={16} weight={isFocused ? "bold" : "duotone"} />
                    </div>

                    {/* Input field */}
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={handleInputChange}
                        onFocus={() => {
                            setIsFocused(true);
                            if (query.trim()) setIsOpen(true);
                        }}
                        onBlur={() => !isOpen && setIsFocused(false)}
                        placeholder="Search anything..."
                        className={cn(
                            "flex-1 h-8 bg-transparent text-sm",
                            "placeholder:text-muted-foreground/50",
                            "outline-none border-none",
                            "transition-all duration-300"
                        )}
                    />

                    {/* Right side: Clear button or keyboard shortcut */}
                    <div className="flex items-center pr-2.5 gap-2">
                        {query ? (
                            <button
                                onClick={handleClear}
                                className={cn(
                                    "p-1 rounded-md transition-all duration-200",
                                    "text-muted-foreground hover:text-foreground",
                                    "hover:bg-muted"
                                )}
                            >
                                <X size={14} weight="bold" />
                            </button>
                        ) : (
                            <kbd className={cn(
                                "hidden sm:inline-flex h-5 items-center gap-0.5 rounded-md px-1.5",
                                "text-[10px] font-medium tracking-wide",
                                "transition-all duration-300",
                                isFocused
                                    ? "bg-primary/10 text-primary border border-primary/20"
                                    : "bg-background/50 text-muted-foreground border border-border/50"
                            )}>
                                {searchShortcut || '⌘K'}
                            </kbd>
                        )}
                    </div>
                </div>
            </div>

            {/* Results Dropdown */}
            {isOpen && (query.trim() || isLoading) && (
                <div className={cn(
                    "absolute top-full left-1/2 -translate-x-1/2 mt-2 z-50",
                    "w-[480px]"
                )}>
                    <SearchResultsList
                        results={results}
                        isLoading={isLoading}
                        query={query}
                        onSelect={handleResultSelect}
                        onClose={handleClose}
                        className="max-h-[70vh]"
                        showHeader={false}
                    />
                </div>
            )}
        </div>
    );
}
