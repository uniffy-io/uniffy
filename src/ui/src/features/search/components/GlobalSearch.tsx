/**
 * Global Search Component
 *
 * A modern search bar with dropdown results for the header.
 * Uses fuzzy search with permission filtering.
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MagnifyingGlassIcon, X } from '@phosphor-icons/react';
import { useSearch } from '../hooks/useSearch';
import { SearchResultsList } from './SearchResultsList';
import { cn } from '@/utils/cn';
import { useFormattedKeybinding } from '@/features/settings';
import type { SearchResultItem } from '@/gen/search/v1/search_pb';

export function GlobalSearch() {
    const navigate = useNavigate();
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
        navigate(result.url);
        setIsOpen(false);
        clearResults();
    };

    const handleClose = () => {
        setIsOpen(false);
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
            {/* Search Input */}
            <div
                className={cn(
                    "relative flex items-center transition-all duration-200",
                    isFocused ? "w-72" : "w-56"
                )}
            >
                {/* Search icon */}
                <MagnifyingGlassIcon
                    size={14}
                    weight="duotone"
                    className={cn(
                        "absolute left-2.5 transition-colors duration-200",
                        isFocused ? "text-primary" : "text-muted-foreground"
                    )}
                />

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
                        "h-8 w-full rounded-lg pl-8 pr-16 text-sm",
                        "bg-muted/50 hover:bg-muted/70",
                        "border border-transparent",
                        "focus:bg-background focus:border-primary/30 focus:ring-1 focus:ring-primary/10",
                        "placeholder:text-muted-foreground/60",
                        "outline-none",
                        "transition-all duration-200"
                    )}
                />

                {/* Right side: Clear button or keyboard shortcut */}
                <div className="absolute right-2.5 flex items-center gap-1.5">
                    {query ? (
                        <button
                            onClick={handleClear}
                            className="p-0.5 rounded hover:bg-muted transition-colors"
                        >
                            <X size={14} weight="bold" className="text-muted-foreground" />
                        </button>
                    ) : (
                        <kbd className="hidden sm:inline-flex h-4 items-center gap-1 rounded border border-border bg-muted/50 px-1 text-[9px] font-medium text-muted-foreground">
                            {searchShortcut || '⌘K'}
                        </kbd>
                    )}
                </div>
            </div>

            {/* Results Dropdown */}
            {isOpen && (query.trim() || isLoading) && (
                <div className="absolute top-full left-0 right-0 mt-1.5 z-50">
                    <div className="rounded-lg bg-card border border-border shadow-lg overflow-hidden">
                        <SearchResultsList
                            results={results}
                            isLoading={isLoading}
                            query={query}
                            onSelect={handleResultSelect}
                            onClose={handleClose}
                            className="max-h-[60vh]"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
