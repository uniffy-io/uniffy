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

export function useApplyFilter() {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const tagsById = useAppSelector((state) => state.tags.byId);

    /** Tag ids that haven't yet been hydrated into the tags slice are skipped; the chip-summary path picks them up once the cache catches up. */
    const buildSearchQuery = useCallback((criteria: SerializedFilterCriteria): string => {
        const parts: string[] = [];

        if (criteria.extensions?.length) {
            parts.push(`ext:${criteria.extensions.join(',')}`);
        }

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

        if (criteria.sizeMinBytes) {
            parts.push(`size:>${formatBytes(criteria.sizeMinBytes)}`);
        }
        if (criteria.sizeMaxBytes) {
            parts.push(`size:<${formatBytes(criteria.sizeMaxBytes)}`);
        }

        return parts.join(' ');
    }, [tagsById]);

    const applyFilter = useCallback(
        (filter: SerializedSavedFilter) => {
            const searchQuery = buildSearchQuery(filter.criteria);
            dispatch(setSearchQuery(searchQuery));

            dispatch(setActiveFilter({
                id: filter.id,
                name: filter.name,
                criteria: filter.criteria,
            }));

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

function formatBytes(bytes: number): string {
    if (bytes >= 1073741824) {
        return `${Math.round(bytes / 1073741824)}gb`;
    }
    if (bytes >= 1048576) {
        return `${Math.round(bytes / 1048576)}mb`;
    }
    if (bytes >= 1024) {
        return `${Math.round(bytes / 1024)}kb`;
    }
    return `${bytes}b`;
}

