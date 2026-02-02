/**
 * Saved Filters Hook
 *
 * Provides access to saved file filters state and operations.
 */

import { useCallback, useEffect } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
    fetchSavedFilters,
    createSavedFilter,
    updateSavedFilter,
    deleteSavedFilter,
    selectSavedFiltersArray,
    selectUserFilters,
    selectPresetFilters,
    selectSavedFiltersLoading,
    selectSavedFiltersError,
    selectSavingFilter,
    clearError,
    type SerializedFilterCriteria,
    type SerializedIconValue,
} from '../store/savedFiltersSlice';

/**
 * Hook for accessing and managing saved file filters.
 */
export function useSavedFilters() {
    const dispatch = useAppDispatch();
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const filters = useAppSelector(selectSavedFiltersArray);
    const userFilters = useAppSelector(selectUserFilters);
    const presetFilters = useAppSelector(selectPresetFilters);
    const loading = useAppSelector(selectSavedFiltersLoading);
    const error = useAppSelector(selectSavedFiltersError);
    const saving = useAppSelector(selectSavingFilter);

    // Fetch filters on mount
    useEffect(() => {
        if (organizationId) {
            dispatch(fetchSavedFilters({
                organizationId,
                includePresets: true,
            }));
        }
    }, [dispatch, organizationId]);

    const create = useCallback(
        async (params: {
            name: string;
            description?: string;
            icon?: SerializedIconValue;
            criteria: SerializedFilterCriteria;
            sortBy?: string;
            sortOrder?: string;
        }) => {
            if (!organizationId) return null;

            const result = await dispatch(createSavedFilter({
                organizationId,
                ...params,
            }));

            if (createSavedFilter.fulfilled.match(result)) {
                return result.payload;
            }
            return null;
        },
        [dispatch, organizationId]
    );

    const update = useCallback(
        async (params: {
            filterId: string;
            name?: string;
            description?: string;
            icon?: SerializedIconValue;
            criteria?: SerializedFilterCriteria;
            sortBy?: string;
            sortOrder?: string;
        }) => {
            if (!organizationId) return null;

            const result = await dispatch(updateSavedFilter({
                organizationId,
                ...params,
            }));

            if (updateSavedFilter.fulfilled.match(result)) {
                return result.payload;
            }
            return null;
        },
        [dispatch, organizationId]
    );

    const remove = useCallback(
        async (filterId: string) => {
            if (!organizationId) return false;

            const result = await dispatch(deleteSavedFilter({
                organizationId,
                filterId,
            }));

            return deleteSavedFilter.fulfilled.match(result);
        },
        [dispatch, organizationId]
    );

    const refresh = useCallback(() => {
        if (organizationId) {
            dispatch(fetchSavedFilters({
                organizationId,
                includePresets: true,
            }));
        }
    }, [dispatch, organizationId]);

    const dismissError = useCallback(() => {
        dispatch(clearError());
    }, [dispatch]);

    return {
        filters,
        userFilters,
        presetFilters,
        loading,
        saving,
        error,
        create,
        update,
        remove,
        refresh,
        dismissError,
    };
}
