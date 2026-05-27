import { useEffect, useRef, useState } from 'react';
import { CaretDown, FloppyDisk, ArrowsClockwise, Star } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { renderIcon, type IconValue } from '@/components/icon-picker';
import { cn } from '@/shared/utils/cn';
import type { SerializedSavedTagFilter } from '@/features/tags/store/tagsThunks';

interface SavedFiltersDropdownProps {
    filters: SerializedSavedTagFilter[];
    activeFilterId: string | null;
    isDirty: boolean;
    onLoad: (filter: SerializedSavedTagFilter) => void;
    onSaveAs: () => void;
    onReset: () => void;
}

export function SavedFiltersDropdown({
    filters,
    activeFilterId,
    isDirty,
    onLoad,
    onSaveAs,
    onReset,
}: SavedFiltersDropdownProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return undefined;
        const onClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onClick);
        return () => document.removeEventListener('mousedown', onClick);
    }, [open]);

    const active = activeFilterId
        ? filters.find((f) => f.id === activeFilterId)
        : null;

    return (
        <div className="flex items-center gap-2">
            <div className="relative" ref={ref}>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setOpen((v) => !v)}
                    className="gap-1.5"
                >
                    {active?.icon
                        ? renderIcon(active.icon as IconValue, undefined, 14)
                        : <Star size={14} weight="duotone" />}
                    <span className="max-w-[12rem] truncate">
                        {active ? active.name : 'Saved filters'}
                    </span>
                    <CaretDown size={12} weight="bold" />
                </Button>
                {open && (
                    <div className="absolute right-0 z-50 mt-1 w-72 origin-top-right rounded-md border border-border bg-card shadow-lg">
                        <ul className="max-h-80 overflow-y-auto py-1">
                            {filters.length === 0 ? (
                                <li className="px-3 py-3 text-xs text-muted-foreground">
                                    No saved filters yet.
                                </li>
                            ) : (
                                filters.map((filter) => (
                                    <li key={filter.id}>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                onLoad(filter);
                                                setOpen(false);
                                            }}
                                            className={cn(
                                                'flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted',
                                                filter.id === activeFilterId && 'bg-primary/5'
                                            )}
                                        >
                                            <span className="grid h-6 w-6 place-items-center rounded-md bg-muted text-muted-foreground">
                                                {filter.icon
                                                    ? renderIcon(filter.icon as IconValue, undefined, 14)
                                                    : <Star size={12} weight="duotone" />}
                                            </span>
                                            <span className="flex-1 truncate">{filter.name}</span>
                                            {filter.isPreset && (
                                                <Star size={10} weight="fill" className="text-primary" />
                                            )}
                                        </button>
                                    </li>
                                ))
                            )}
                        </ul>
                    </div>
                )}
            </div>
            {isDirty && (
                <Button
                    variant="outline"
                    size="sm"
                    onClick={onSaveAs}
                    className="gap-1.5"
                >
                    <FloppyDisk size={14} weight="duotone" />
                    Save as...
                </Button>
            )}
            <Button
                variant="ghost"
                size="sm"
                onClick={onReset}
                className="gap-1.5 text-muted-foreground"
            >
                <ArrowsClockwise size={14} weight="duotone" />
                Reset
            </Button>
        </div>
    );
}
