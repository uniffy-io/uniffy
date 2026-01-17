/**
 * Global Search Component
 * 
 * A search bar with dropdown results for the header.
 * Uses fuzzy search with permission filtering.
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useSearch } from '../hooks/useSearch';
import { SearchResultsList } from './SearchResultsList';
import { cn } from '@/utils/cn';
import type { SearchResultItem } from '@/gen/search/v1/search_pb';

export function GlobalSearch() {
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const { query, setQuery, results, isLoading, clearResults } = useSearch();

    // Close dropdown when clicking outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
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
            <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={handleInputChange}
                    onFocus={() => query.trim() && setIsOpen(true)}
                    placeholder="Search..."
                    className={cn(
                        "h-9 w-64 rounded-md bg-background pl-9 pr-8 text-sm",
                        "ring-1 ring-border focus:ring-primary",
                        "placeholder:text-muted-foreground",
                        "focus:outline-none",
                        "transition-all duration-200"
                    )}
                />
                {query && (
                    <button
                        onClick={handleClear}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted"
                    >
                        <XMarkIcon className="h-4 w-4 text-muted-foreground" />
                    </button>
                )}
            </div>

            {/* Results Dropdown */}
            {isOpen && (query.trim() || isLoading) && (
                <SearchResultsList
                    results={results}
                    isLoading={isLoading}
                    query={query}
                    onSelect={handleResultSelect}
                    onClose={handleClose}
                    className="absolute top-full left-0 mt-2 w-96 z-50"
                />
            )}
        </div>
    );
}
