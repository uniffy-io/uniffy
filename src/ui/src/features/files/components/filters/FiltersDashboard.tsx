import { useState, useCallback } from 'react';
import { Plus, Star, User } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { SavedFiltersList } from '@/features/files/components/filters/SavedFiltersList';
import { FilterBuilder } from '@/features/files/components/filters/FilterBuilder';
import { useSavedFilters } from '@/features/files/hooks/useSavedFilters';
import { useApplyFilter } from '@/features/files/hooks/useApplyFilter';
import type { SerializedSavedFilter, SerializedFilterCriteria, SerializedIconValue } from '@/features/files/store/savedFiltersSlice';

type ViewMode = 'list' | 'create' | 'edit';

export function FiltersDashboard() {
    const {
        userFilters,
        presetFilters,
        loading,
        saving,
        error,
        create,
        update,
        remove,
        dismissError,
    } = useSavedFilters();

    const { applyFilter } = useApplyFilter();

    const [viewMode, setViewMode] = useState<ViewMode>('list');
    const [editingFilter, setEditingFilter] = useState<SerializedSavedFilter | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const handleCreate = useCallback(() => {
        setEditingFilter(null);
        setViewMode('create');
    }, []);

    const handleEdit = useCallback((filter: SerializedSavedFilter) => {
        setEditingFilter(filter);
        setViewMode('edit');
    }, []);

    const handleCancel = useCallback(() => {
        setEditingFilter(null);
        setViewMode('list');
    }, []);

    const handleSave = useCallback(
        async (params: {
            name: string;
            description?: string;
            icon?: SerializedIconValue;
            criteria: SerializedFilterCriteria;
            sortBy?: string;
            sortOrder?: string;
        }) => {
            if (editingFilter) {
                const result = await update({
                    filterId: editingFilter.id,
                    ...params,
                });
                if (result) {
                    setEditingFilter(null);
                    setViewMode('list');
                }
            } else {
                const result = await create(params);
                if (result) {
                    setViewMode('list');
                }
            }
        },
        [editingFilter, create, update]
    );

    const handleDelete = useCallback(
        async (filterId: string) => {
            setDeletingId(filterId);
            await remove(filterId);
            setDeletingId(null);
        },
        [remove]
    );

    const handleApply = useCallback(
        (filter: SerializedSavedFilter) => {
            applyFilter(filter);
        },
        [applyFilter]
    );

    if (viewMode === 'create' || viewMode === 'edit') {
        return (
            <div className="max-w-2xl mx-auto">
                <FilterBuilder
                    initialFilter={editingFilter ?? undefined}
                    onSave={handleSave}
                    onCancel={handleCancel}
                    saving={saving}
                />
            </div>
        );
    }

    return (
        <div className="space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold">File Filters</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Create and manage custom filters to quickly find files.
                    </p>
                </div>
                <Button variant="default" onClick={handleCreate}>
                    <Plus size={16} weight="bold" className="mr-1.5" />
                    New Filter
                </Button>
            </div>

            {/* Error */}
            {error && (
                <div className="flex items-center justify-between p-3 rounded-md bg-destructive/10 border border-destructive/30">
                    <p className="text-sm text-destructive">{error}</p>
                    <button
                        onClick={dismissError}
                        className="text-sm text-destructive hover:underline"
                    >
                        Dismiss
                    </button>
                </div>
            )}

            {/* Preset Filters Section */}
            {presetFilters.length > 0 && (
                <section>
                    <div className="flex items-center gap-2 mb-4">
                        <Star size={18} weight="fill" className="text-primary" />
                        <h2 className="text-lg font-medium">Quick Filters</h2>
                    </div>
                    <SavedFiltersList
                        filters={presetFilters}
                        loading={false}
                        onApply={handleApply}
                    />
                </section>
            )}

            {/* User Filters Section */}
            <section>
                <div className="flex items-center gap-2 mb-4">
                    <User size={18} weight="duotone" className="text-muted-foreground" />
                    <h2 className="text-lg font-medium">My Filters</h2>
                </div>
                <SavedFiltersList
                    filters={userFilters}
                    loading={loading}
                    onApply={handleApply}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    deletingId={deletingId}
                />
            </section>
        </div>
    );
}
