/**
 * Share Target Search Component
 *
 * Autocomplete search for finding users and groups to share with.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { MagnifyingGlass, User, UsersThree } from '@phosphor-icons/react';
import { useShareTargetSearch, isUserTarget } from '../hooks/useSharingHooks';
import { PermissionLevel } from '@/gen/common/v1/common_pb';
import { PermissionLevelSelect } from './PermissionLevelSelect';
import type { SerializedShareTarget } from '../store/sharingSlice';

interface ShareTargetSearchProps {
    onSelect: (target: SerializedShareTarget, level: number) => void;
    existingSubjectIds: string[];
    disabled?: boolean;
}

export function ShareTargetSearch({
    onSelect,
    existingSubjectIds,
    disabled = false,
}: ShareTargetSearchProps) {
    const [query, setQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [selectedLevel, setSelectedLevel] = useState<number>(PermissionLevel.VIEW);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const { results, loading, search, clear } = useShareTargetSearch();

    // Debounced search
    useEffect(() => {
        const timer = setTimeout(() => {
            search(query);
        }, 300);
        return () => clearTimeout(timer);
    }, [query, search]);

    // Filter out already shared targets
    const filteredResults = results.filter(
        (target) => !existingSubjectIds.includes(target.id)
    );

    // Close on click outside
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node) &&
                inputRef.current &&
                !inputRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelect = useCallback(
        (target: SerializedShareTarget) => {
            onSelect(target, selectedLevel);
            setQuery('');
            setIsOpen(false);
            clear();
        },
        [onSelect, selectedLevel, clear]
    );

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setIsOpen(false);
            setQuery('');
            clear();
        }
    };

    return (
        <div className="relative">
            <div className="flex gap-2">
                {/* Search input */}
                <div className="relative flex-1">
                    <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setIsOpen(true);
                        }}
                        onFocus={() => setIsOpen(true)}
                        onKeyDown={handleKeyDown}
                        placeholder="Search users or groups..."
                        disabled={disabled}
                        className="w-full pl-9 pr-4 py-2 rounded-md bg-muted border border-border
                            text-sm placeholder:text-muted-foreground
                            focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent
                            disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                </div>

                {/* Permission level selector */}
                <div className="w-32">
                    <PermissionLevelSelect
                        value={selectedLevel}
                        onChange={setSelectedLevel}
                        disabled={disabled}
                    />
                </div>
            </div>

            {/* Dropdown */}
            {isOpen && query.length >= 2 && (
                <div
                    ref={dropdownRef}
                    className="absolute z-50 mt-1 w-full max-h-64 overflow-auto rounded-md
                        bg-card border border-border shadow-lg"
                >
                    {loading ? (
                        <div className="px-4 py-3 text-sm text-muted-foreground">
                            Searching...
                        </div>
                    ) : filteredResults.length === 0 ? (
                        <div className="px-4 py-3 text-sm text-muted-foreground">
                            {results.length > 0
                                ? 'All matching users/groups already have access'
                                : 'No users or groups found'}
                        </div>
                    ) : (
                        <ul className="py-1">
                            {filteredResults.map((target) => (
                                <li key={target.id}>
                                    <button
                                        type="button"
                                        onClick={() => handleSelect(target)}
                                        className="w-full px-4 py-2 text-left hover:bg-muted
                                            flex items-center gap-3 transition-colors"
                                    >
                                        {/* Icon */}
                                        <div
                                            className={`
                                                w-8 h-8 rounded-full flex items-center justify-center
                                                ${isUserTarget(target) ? 'bg-emerald-500/10' : 'bg-violet-500/10'}
                                            `}
                                        >
                                            {isUserTarget(target) ? (
                                                <User size={16} className="text-emerald-600 dark:text-emerald-400" />
                                            ) : (
                                                <UsersThree size={16} className="text-violet-600 dark:text-violet-400" />
                                            )}
                                        </div>

                                        {/* Info */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-medium truncate">
                                                {target.name}
                                            </p>
                                            {isUserTarget(target) && target.email && (
                                                <p className="text-xs text-muted-foreground truncate">
                                                    {target.email}
                                                </p>
                                            )}
                                            {!isUserTarget(target) && target.memberCount > 0 && (
                                                <p className="text-xs text-muted-foreground">
                                                    {target.memberCount} member{target.memberCount !== 1 ? 's' : ''}
                                                </p>
                                            )}
                                        </div>

                                        {/* Type badge */}
                                        <span
                                            className={`
                                                text-xs px-2 py-0.5 rounded-full
                                                ${
                                                    isUserTarget(target)
                                                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                                        : 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
                                                }
                                            `}
                                        >
                                            {isUserTarget(target) ? 'User' : 'Group'}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

export default ShareTargetSearch;
