/**
 * SubjectPicker - Search dropdown for selecting users and/or groups
 *
 * Supports single/multi select, portal/inline modes, and type filtering.
 */

import { useState, useRef, useEffect, useCallback, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { MagnifyingGlass, Check } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';
import {
    SUBJECT_TYPE,
    type Subject,
    type SubjectPickerMode,
    type SubjectTypeFilter,
} from '@/components/subject/types';
import { SubjectAvatar } from '@/components/subject/SubjectAvatar';
import { useSubjectSearch } from '@/components/subject/hooks/useSubjectSearch';
import { useSubjectResolver } from '@/components/subject/hooks/useSubjectResolver';

interface SubjectPickerProps {
    mode: SubjectPickerMode;
    /** Which subject types to show. Default: 'all'. */
    subjectTypes?: SubjectTypeFilter;
    /** Currently selected subject IDs. */
    value: string[];
    /** Callback when selection changes. */
    onChange: (ids: string[], subjects: Subject[]) => void;
    /** Additional IDs to hide from results. */
    excludeIds?: string[];
    /** Render as a portal anchored to anchorRef. */
    portal?: boolean;
    /** Anchor element for portal positioning. */
    anchorRef?: RefObject<HTMLElement | null>;
    /** Called when the picker should close. */
    onClose?: () => void;
    placeholder?: string;
    disabled?: boolean;
    autoFocus?: boolean;
    /** Width for the dropdown in px. Default: 240. */
    dropdownWidth?: number;
}

export function SubjectPicker({
    mode,
    subjectTypes = 'all',
    value,
    onChange,
    excludeIds = [],
    portal = false,
    anchorRef,
    onClose,
    placeholder,
    disabled = false,
    autoFocus = false,
    dropdownWidth = 240,
}: SubjectPickerProps) {
    const [query, setQuery] = useState('');
    const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const { results, loading, search } = useSubjectSearch({
        subjectTypes,
        excludeIds,
    });

    // Resolve selected IDs to Subject objects for display
    const { subjects: resolvedSelected } = useSubjectResolver(value);

    // Track selected subjects for onChange callback in multi mode
    const selectedSubjectsRef = useRef<Map<string, Subject>>(new Map());

    // Keep track of query changes for search
    useEffect(() => {
        search(query);
    }, [query, search]);

    // Portal positioning
    useEffect(() => {
        if (!portal || !anchorRef?.current) return;

        const updatePosition = () => {
            const rect = anchorRef.current?.getBoundingClientRect();
            if (rect) {
                setPosition({
                    top: rect.bottom + 4,
                    left: rect.right - dropdownWidth,
                });
            }
        };

        updatePosition();
        window.addEventListener('scroll', updatePosition, true);
        window.addEventListener('resize', updatePosition);
        return () => {
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('resize', updatePosition);
        };
    }, [portal, anchorRef, dropdownWidth]);

    // Auto-focus search input
    useEffect(() => {
        if (autoFocus || portal) {
            const timer = setTimeout(() => inputRef.current?.focus(), 50);
            return () => clearTimeout(timer);
        }
    }, [autoFocus, portal, position]);

    // Close on click outside
    useEffect(() => {
        if (!onClose) return;
        const handleClickOutside = (e: MouseEvent) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(e.target as Node)
            ) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [onClose]);

    // Close on escape or enter
    useEffect(() => {
        if (!onClose) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' || e.key === 'Enter') {
                e.stopPropagation();
                e.preventDefault();
                onClose();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleSelect = useCallback(
        (subject: Subject) => {
            if (mode === 'single') {
                // In single mode, fire callback with the selected subject
                // Callers handle add/remove toggle themselves
                onChange([subject.id], [subject]);
                setQuery('');
                return;
            }

            // Multi mode: toggle
            const isSelected = value.includes(subject.id);
            let nextIds: string[];
            if (isSelected) {
                nextIds = value.filter((id) => id !== subject.id);
                selectedSubjectsRef.current.delete(subject.id);
            } else {
                nextIds = [...value, subject.id];
                selectedSubjectsRef.current.set(subject.id, subject);
            }
            const nextSubjects = nextIds.map(
                (id) => selectedSubjectsRef.current.get(id) || subject
            );
            onChange(nextIds, nextSubjects);
        },
        [mode, value, onChange]
    );

    const defaultPlaceholder = subjectTypes === 'users'
        ? 'Search members...'
        : subjectTypes === 'groups'
            ? 'Search groups...'
            : 'Search users or groups...';

    const dropdownContent = (
        <div
            ref={dropdownRef}
            style={
                portal && position
                    ? { position: 'fixed', top: position.top, left: position.left, width: dropdownWidth }
                    : undefined
            }
            className={cn(
                'rounded-lg border border-border bg-card shadow-xl',
                portal ? 'z-200' : 'absolute z-50 mt-1 w-full'
            )}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Search input */}
            <div className="p-2 border-b border-border">
                <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border bg-background">
                    <MagnifyingGlass size={14} className="text-muted-foreground shrink-0" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                        placeholder={placeholder || defaultPlaceholder}
                        disabled={disabled}
                        className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
                    />
                </div>
            </div>

            {/* Results list */}
            <div className="max-h-48 overflow-y-auto py-1">
                {loading && results.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">Searching...</div>
                ) : query.length >= 2 && results.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">No results found</div>
                ) : query.length < 2 && value.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">Type to search...</div>
                ) : query.length < 2 && value.length > 0 ? (
                    resolvedSelected.map((subject) => {
                        return (
                            <button
                                key={subject.id}
                                type="button"
                                onClick={() => handleSelect(subject)}
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors bg-primary/10"
                            >
                                <SubjectAvatar subject={subject} size="sm" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-foreground truncate">{subject.name}</div>
                                    {subject.type === SUBJECT_TYPE.USER && subject.email && (
                                        <div className="text-xs text-muted-foreground truncate">{subject.email}</div>
                                    )}
                                    {subject.type === SUBJECT_TYPE.GROUP && subject.memberCount != null && subject.memberCount > 0 && (
                                        <div className="text-xs text-muted-foreground">
                                            {subject.memberCount} member{subject.memberCount !== 1 ? 's' : ''}
                                        </div>
                                    )}
                                </div>
                                <Check size={14} className="text-primary shrink-0" />
                            </button>
                        );
                    })
                ) : (
                    results.map((subject) => {
                        const isSelected = value.includes(subject.id);
                        return (
                            <button
                                key={subject.id}
                                type="button"
                                onClick={() => handleSelect(subject)}
                                className={cn(
                                    'flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors',
                                    isSelected ? 'bg-primary/10' : 'hover:bg-muted'
                                )}
                            >
                                <SubjectAvatar subject={subject} size="sm" />
                                <div className="flex-1 min-w-0">
                                    <div className="text-foreground truncate">{subject.name}</div>
                                    {subject.type === SUBJECT_TYPE.USER && subject.email && (
                                        <div className="text-xs text-muted-foreground truncate">{subject.email}</div>
                                    )}
                                    {subject.type === SUBJECT_TYPE.GROUP && subject.memberCount != null && subject.memberCount > 0 && (
                                        <div className="text-xs text-muted-foreground">
                                            {subject.memberCount} member{subject.memberCount !== 1 ? 's' : ''}
                                        </div>
                                    )}
                                </div>
                                {/* Type badge when showing all types */}
                                {subjectTypes === 'all' && (
                                    <span
                                        className={cn(
                                            'text-xs px-2 py-0.5 rounded-full shrink-0',
                                            subject.type === SUBJECT_TYPE.USER
                                                ? 'bg-primary/10 text-primary'
                                                : 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
                                        )}
                                    >
                                        {subject.type === SUBJECT_TYPE.USER ? 'User' : 'Group'}
                                    </span>
                                )}
                                {isSelected && (
                                    <Check size={14} className="text-primary shrink-0" />
                                )}
                            </button>
                        );
                    })
                )}
            </div>

        </div>
    );

    if (portal) {
        return (
            <>
                {position && createPortal(dropdownContent, document.body)}
            </>
        );
    }

    return <div className="relative">{dropdownContent}</div>;
}
