/**
 * Saved Filters List Component
 *
 * Displays a grid of saved file filters.
 */

import { Funnel } from '@phosphor-icons/react';
import { FilterCard } from '@/features/files/components/filters/FilterCard';
import type { SerializedSavedFilter } from '@/features/files/store/savedFiltersSlice';

interface SavedFiltersListProps {
    filters: SerializedSavedFilter[];
    loading?: boolean;
    onApply: (filter: SerializedSavedFilter) => void;
    onEdit?: (filter: SerializedSavedFilter) => void;
    onDelete?: (filterId: string) => void;
    deletingId?: string | null;
}

export function SavedFiltersList({
    filters,
    loading = false,
    onApply,
    onEdit,
    onDelete,
    deletingId,
}: SavedFiltersListProps) {
    if (loading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map((i) => (
                    <div
                        key={i}
                        className="bg-card border border-border rounded-lg p-4 animate-pulse"
                    >
                        <div className="flex items-start gap-3">
                            <div className="w-10 h-10 rounded-lg bg-muted" />
                            <div className="flex-1 space-y-2">
                                <div className="h-4 bg-muted rounded w-1/2" />
                                <div className="h-3 bg-muted rounded w-3/4" />
                            </div>
                        </div>
                        <div className="mt-3 flex gap-1.5">
                            <div className="h-5 bg-muted rounded w-20" />
                            <div className="h-5 bg-muted rounded w-16" />
                        </div>
                        <div className="mt-4 h-8 bg-muted rounded" />
                    </div>
                ))}
            </div>
        );
    }

    if (filters.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                    <Funnel size={28} weight="duotone" className="text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium mb-1">No saved filters</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                    Create a filter to quickly find files matching specific criteria.
                </p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filters.map((filter) => (
                <FilterCard
                    key={filter.id}
                    filter={filter}
                    onApply={onApply}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    isDeleting={deletingId === filter.id}
                />
            ))}
        </div>
    );
}
