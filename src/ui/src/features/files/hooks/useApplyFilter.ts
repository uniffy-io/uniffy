/**
 * Apply Filter Hook
 *
 * Applies a saved filter and navigates to the files list.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
    setSearchQuery,
    setSortBy,
    setSortOrder,
    setFolderId,
    setActiveFilter,
    clearActiveFilter,
} from '@/features/files/store/filesSlice';
import type { SerializedSavedFilter, SerializedFilterCriteria } from '@/features/files/store/savedFiltersSlice';

/**
 * Hook for applying a saved filter to the files list.
 */
export function useApplyFilter() {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const tagsById = useAppSelector((state) => state.tags.byId);

    /**
     * Build a search query string from filter criteria.
     * This converts structured criteria into the search query format.
     * Tag criteria resolve to slugs via the tags-slice cache; ids that
     * have not yet been hydrated are skipped (the chip-summary path
     * shows them once the cache catches up).
     */
    const buildSearchQuery = useCallback((criteria: SerializedFilterCriteria): string => {
        const parts: string[] = [];

        // Extensions: ext:pdf,docx
        if (criteria.extensions?.length) {
            parts.push(`ext:${criteria.extensions.join(',')}`);
        }

        // MIME categories: type:image,document
        if (criteria.mimeCategories?.length) {
            parts.push(`type:${criteria.mimeCategories.join(',')}`);
        }

        if (criteria.tagIds?.length) {
            const slugs = criteria.tagIds
                .map((id) => tagsById[id]?.slug)
                .filter((slug): slug is string => Boolean(slug));
            if (slugs.length > 0) {
                parts.push(`tag:${slugs.join(',')}`);
            }
        }

        // Size: size:>1mb size:<100mb
        if (criteria.sizeMinBytes) {
            parts.push(`size:>${formatBytes(criteria.sizeMinBytes)}`);
        }
        if (criteria.sizeMaxBytes) {
            parts.push(`size:<${formatBytes(criteria.sizeMaxBytes)}`);
        }

        return parts.join(' ');
    }, [tagsById]);

    /**
     * Apply a saved filter and navigate to files list.
     */
    const applyFilter = useCallback(
        (filter: SerializedSavedFilter) => {
            // Build search query from criteria (for display)
            const searchQuery = buildSearchQuery(filter.criteria);
            dispatch(setSearchQuery(searchQuery));

            // Set the active filter with its criteria for filtering
            dispatch(setActiveFilter({
                id: filter.id,
                name: filter.name,
                criteria: filter.criteria,
            }));

            // Apply sort settings
            if (filter.sortBy) {
                const sortBy = filter.sortBy as 'filename' | 'updated_at' | 'created_at' | 'size_bytes';
                dispatch(setSortBy(sortBy));
            }
            if (filter.sortOrder) {
                const sortOrder = filter.sortOrder as 'asc' | 'desc';
                dispatch(setSortOrder(sortOrder));
            }

        },
        [dispatch, buildSearchQuery]
    );

    /**
     * Apply filter criteria directly (without a saved filter).
     */
    const applyCriteria = useCallback(
        (criteria: SerializedFilterCriteria, options?: { sortBy?: string; sortOrder?: string }) => {
            const searchQuery = buildSearchQuery(criteria);
            dispatch(setSearchQuery(searchQuery));

            if (options?.sortBy) {
                const sortBy = options.sortBy as 'filename' | 'updated_at' | 'created_at' | 'size_bytes';
                dispatch(setSortBy(sortBy));
            }
            if (options?.sortOrder) {
                const sortOrder = options.sortOrder as 'asc' | 'desc';
                dispatch(setSortOrder(sortOrder));
            }

        },
        [dispatch, buildSearchQuery]
    );

    /**
     * Clear all active filters and navigate to files.
     */
    const clearFilters = useCallback(() => {
        dispatch(setSearchQuery(''));
        dispatch(clearActiveFilter());
        dispatch(setSortBy('updated_at'));
        dispatch(setSortOrder('desc'));
        dispatch(setFolderId(null));
        navigate('/files');
    }, [dispatch, navigate]);

    return {
        applyFilter,
        applyCriteria,
        clearFilters,
    };
}

/**
 * Format bytes to human-readable string for search query.
 */
function formatBytes(bytes: number): string {
    if (bytes >= 1073741824) { // 1 GB
        return `${Math.round(bytes / 1073741824)}gb`;
    }
    if (bytes >= 1048576) { // 1 MB
        return `${Math.round(bytes / 1048576)}mb`;
    }
    if (bytes >= 1024) { // 1 KB
        return `${Math.round(bytes / 1024)}kb`;
    }
    return `${bytes}b`;
}

