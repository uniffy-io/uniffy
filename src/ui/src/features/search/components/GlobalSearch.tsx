/**
 * Global Search Component
 * 
 * A search bar with dropdown results for the header.
 * Uses fuzzy search with permission filtering.
 */

import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
    MagnifyingGlassIcon,
    DocumentTextIcon,
    FolderIcon,
    ChatBubbleLeftRightIcon,
    UserIcon,
    BookOpenIcon,
    CalendarIcon,
    KeyIcon,
    CubeIcon,
    XMarkIcon,
} from '@heroicons/react/24/outline';
import { useSearch } from '../hooks/useSearch';
import { SearchResultType } from '@/gen/search/v1/search_pb';
import { cn } from '@/utils/cn';

/**
 * Get icon for search result type
 */
function getResultIcon(type: SearchResultType) {
    switch (type) {
        case SearchResultType.NOTE:
            return DocumentTextIcon;
        case SearchResultType.FILE:
            return FolderIcon;
        case SearchResultType.CHAT:
            return ChatBubbleLeftRightIcon;
        case SearchResultType.USER:
            return UserIcon;
        case SearchResultType.BOOK:
            return BookOpenIcon;
        case SearchResultType.CALENDAR_EVENT:
            return CalendarIcon;
        case SearchResultType.PASSWORD:
            return KeyIcon;
        case SearchResultType.SPACE:
            return CubeIcon;
        default:
            return DocumentTextIcon;
    }
}

/**
 * Get label for search result type
 */
function getResultTypeLabel(type: SearchResultType): string {
    switch (type) {
        case SearchResultType.NOTE:
            return 'Note';
        case SearchResultType.FILE:
            return 'File';
        case SearchResultType.CHAT:
            return 'Chat';
        case SearchResultType.USER:
            return 'User';
        case SearchResultType.BOOK:
            return 'Book';
        case SearchResultType.CALENDAR_EVENT:
            return 'Event';
        case SearchResultType.PASSWORD:
            return 'Password';
        case SearchResultType.SPACE:
            return 'Space';
        default:
            return 'Item';
    }
}

export function GlobalSearch() {
    const navigate = useNavigate();
    const [isOpen, setIsOpen] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);
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

    // Reset selected index when results change
    useEffect(() => {
        setSelectedIndex(0);
    }, [results]);

    // Keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (!isOpen || results.length === 0) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex((prev) => (prev + 1) % results.length);
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
                break;
            case 'Enter':
                e.preventDefault();
                if (results[selectedIndex]) {
                    handleResultClick(results[selectedIndex].url);
                }
                break;
            case 'Escape':
                e.preventDefault();
                setIsOpen(false);
                inputRef.current?.blur();
                break;
        }
    };

    const handleResultClick = (url: string) => {
        navigate(url);
        setIsOpen(false);
        clearResults();
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
                    onKeyDown={handleKeyDown}
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
                <div className={cn(
                    "absolute top-full left-0 mt-2 w-96 max-h-80 overflow-auto",
                    "rounded-lg border border-border bg-background shadow-lg",
                    "z-50"
                )}>
                    {isLoading && (
                        <div className="flex items-center justify-center py-8">
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        </div>
                    )}

                    {!isLoading && results.length === 0 && query.trim() && (
                        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                            <MagnifyingGlassIcon className="h-8 w-8 mb-2 opacity-50" />
                            <p className="text-sm">No results found</p>
                            <p className="text-xs mt-1">Try a different search term</p>
                        </div>
                    )}

                    {!isLoading && results.length > 0 && (
                        <ul className="py-2">
                            {results.map((result, index) => {
                                const Icon = getResultIcon(result.type);
                                return (
                                    <li key={result.urn}>
                                        <button
                                            onClick={() => handleResultClick(result.url)}
                                            onMouseEnter={() => setSelectedIndex(index)}
                                            className={cn(
                                                "w-full flex items-start gap-3 px-4 py-2.5 text-left",
                                                "transition-colors duration-100",
                                                index === selectedIndex
                                                    ? "bg-accent text-accent-foreground"
                                                    : "hover:bg-muted"
                                            )}
                                        >
                                            <Icon className="h-5 w-5 mt-0.5 shrink-0 text-muted-foreground" />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="font-medium truncate">
                                                        {result.title}
                                                    </span>
                                                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">
                                                        {getResultTypeLabel(result.type)}
                                                    </span>
                                                </div>
                                                {result.description && (
                                                    <p className="text-sm text-muted-foreground truncate mt-0.5">
                                                        {result.description}
                                                    </p>
                                                )}
                                            </div>
                                            {result.score > 0 && (
                                                <span className="text-xs text-muted-foreground shrink-0">
                                                    {Math.round(result.score * 100)}%
                                                </span>
                                            )}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}

                    {/* Footer hint */}
                    {!isLoading && results.length > 0 && (
                        <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground flex items-center gap-4">
                            <span><kbd className="px-1.5 py-0.5 rounded bg-muted">↑↓</kbd> to navigate</span>
                            <span><kbd className="px-1.5 py-0.5 rounded bg-muted">↵</kbd> to select</span>
                            <span><kbd className="px-1.5 py-0.5 rounded bg-muted">esc</kbd> to close</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
