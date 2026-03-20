/**
 * Saved Filters Redux Slice
 *
 * Manages saved file filter state including CRUD operations.
 */

import { createSlice, createAsyncThunk, createSelector } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { savedFiltersApi } from '@/features/files/api/savedFiltersApi';
import type { RootState } from '@/app/store';
import type { VisibilityScope } from '@uniffy/proto/common/v1/common_pb';

/**
 * Serialized filter criteria for Redux state.
 */
export interface SerializedFilterCriteria {
    extensions?: string[];
    mimeCategories?: string[];
    ownerIds?: string[];
    visibility?: VisibilityScope;
    tags?: string[];
    sizeMinBytes?: number;
    sizeMaxBytes?: number;
    createdAfter?: string; // ISO date string
    createdBefore?: string; // ISO date string
}

/**
 * Serialized icon value for Redux state.
 */
export interface SerializedIconValue {
    type: 'icon' | 'emoji';
    value: string;
}

/**
 * Serialized saved filter for Redux state.
 */
export interface SerializedSavedFilter {
    id: string;
    userId: string;
    organizationId: string;
    name: string;
    description?: string;
    icon?: SerializedIconValue;
    criteria: SerializedFilterCriteria;
    isPreset: boolean;
    sortBy?: string;
    sortOrder?: string;
    createdAt: string;
    updatedAt: string;
}

interface SavedFiltersState {
    filters: Record<string, SerializedSavedFilter>;
    loading: boolean;
    error: string | null;
    savingFilter: boolean;
}

const initialState: SavedFiltersState = {
    filters: {},
    loading: false,
    error: null,
    savingFilter: false,
};

/**
 * Serialize a proto saved filter to plain object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeSavedFilter(filter: any): SerializedSavedFilter {
    const criteria: SerializedFilterCriteria = {};

    if (filter.criteria) {
        if (filter.criteria.extensions?.length) {
            criteria.extensions = [...filter.criteria.extensions];
        }
        if (filter.criteria.mimeCategories?.length) {
            criteria.mimeCategories = [...filter.criteria.mimeCategories];
        }
        if (filter.criteria.ownerIds?.length) {
            criteria.ownerIds = [...filter.criteria.ownerIds];
        }
        if (filter.criteria.visibility !== undefined) {
            criteria.visibility = filter.criteria.visibility;
        }
        if (filter.criteria.tags?.length) {
            criteria.tags = [...filter.criteria.tags];
        }
        if (filter.criteria.sizeMinBytes !== undefined) {
            criteria.sizeMinBytes = Number(filter.criteria.sizeMinBytes);
        }
        if (filter.criteria.sizeMaxBytes !== undefined) {
            criteria.sizeMaxBytes = Number(filter.criteria.sizeMaxBytes);
        }
        if (filter.criteria.createdAfter) {
            criteria.createdAfter = filter.criteria.createdAfter.toDate?.()?.toISOString()
                ?? filter.criteria.createdAfter;
        }
        if (filter.criteria.createdBefore) {
            criteria.createdBefore = filter.criteria.createdBefore.toDate?.()?.toISOString()
                ?? filter.criteria.createdBefore;
        }
    }

    // Handle icon
    let icon: SerializedIconValue | undefined;
    if (filter.icon) {
        icon = {
            type: filter.icon.type as 'icon' | 'emoji',
            value: filter.icon.value,
        };
    }

    return {
        id: filter.id,
        userId: filter.userId,
        organizationId: filter.organizationId,
        name: filter.name,
        description: filter.description,
        icon,
        criteria,
        isPreset: filter.isPreset,
        sortBy: filter.sortBy,
        sortOrder: filter.sortOrder,
        createdAt: filter.createdAt?.toDate?.()?.toISOString() ?? '',
        updatedAt: filter.updatedAt?.toDate?.()?.toISOString() ?? '',
    };
}

// ─────────────────────────────────────────────────────────────
// Async Thunks
// ─────────────────────────────────────────────────────────────

export const fetchSavedFilters = createAsyncThunk(
    'savedFilters/fetchSavedFilters',
    async (
        { organizationId, includePresets = true }: { organizationId: string; includePresets?: boolean },
        { rejectWithValue }
    ) => {
        try {
            const response = await savedFiltersApi.listSavedFilters({
                organizationId,
                includePresets,
            });
            return response.filters.map(serializeSavedFilter);
        } catch (error) {
            return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch filters');
        }
    }
);

export const createSavedFilter = createAsyncThunk(
    'savedFilters/createSavedFilter',
    async (
        {
            organizationId,
            name,
            description,
            icon,
            criteria,
            sortBy,
            sortOrder,
        }: {
            organizationId: string;
            name: string;
            description?: string;
            icon?: SerializedIconValue;
            criteria: SerializedFilterCriteria;
            sortBy?: string;
            sortOrder?: string;
        },
        { rejectWithValue }
    ) => {
        try {
            const response = await savedFiltersApi.createSavedFilter({
                organizationId,
                name,
                description,
                icon: icon ? { type: icon.type, value: icon.value } : undefined,
                criteria: {
                    extensions: criteria.extensions,
                    mimeCategories: criteria.mimeCategories,
                    ownerIds: criteria.ownerIds,
                    visibility: criteria.visibility,
                    tags: criteria.tags,
                    sizeMinBytes: criteria.sizeMinBytes ? BigInt(criteria.sizeMinBytes) : undefined,
                    sizeMaxBytes: criteria.sizeMaxBytes ? BigInt(criteria.sizeMaxBytes) : undefined,
                    // Date handling is done in the proto conversion
                },
                sortBy,
                sortOrder,
            });
            return serializeSavedFilter(response.filter);
        } catch (error) {
            return rejectWithValue(error instanceof Error ? error.message : 'Failed to create filter');
        }
    }
);

export const updateSavedFilter = createAsyncThunk(
    'savedFilters/updateSavedFilter',
    async (
        {
            organizationId,
            filterId,
            name,
            description,
            icon,
            criteria,
            sortBy,
            sortOrder,
        }: {
            organizationId: string;
            filterId: string;
            name?: string;
            description?: string;
            icon?: SerializedIconValue;
            criteria?: SerializedFilterCriteria;
            sortBy?: string;
            sortOrder?: string;
        },
        { rejectWithValue }
    ) => {
        try {
            const response = await savedFiltersApi.updateSavedFilter({
                organizationId,
                filterId,
                name,
                description,
                icon: icon ? { type: icon.type, value: icon.value } : undefined,
                criteria: criteria ? {
                    extensions: criteria.extensions,
                    mimeCategories: criteria.mimeCategories,
                    ownerIds: criteria.ownerIds,
                    visibility: criteria.visibility,
                    tags: criteria.tags,
                    sizeMinBytes: criteria.sizeMinBytes ? BigInt(criteria.sizeMinBytes) : undefined,
                    sizeMaxBytes: criteria.sizeMaxBytes ? BigInt(criteria.sizeMaxBytes) : undefined,
                } : undefined,
                sortBy,
                sortOrder,
            });
            return serializeSavedFilter(response.filter);
        } catch (error) {
            return rejectWithValue(error instanceof Error ? error.message : 'Failed to update filter');
        }
    }
);

export const deleteSavedFilter = createAsyncThunk(
    'savedFilters/deleteSavedFilter',
    async (
        { organizationId, filterId }: { organizationId: string; filterId: string },
        { rejectWithValue }
    ) => {
        try {
            await savedFiltersApi.deleteSavedFilter({
                organizationId,
                filterId,
            });
            return filterId;
        } catch (error) {
            return rejectWithValue(error instanceof Error ? error.message : 'Failed to delete filter');
        }
    }
);

// ─────────────────────────────────────────────────────────────
// Slice
// ─────────────────────────────────────────────────────────────

const savedFiltersSlice = createSlice({
    name: 'savedFilters',
    initialState,
    reducers: {
        clearSavedFilters(state) {
            state.filters = {};
            state.error = null;
        },
        clearError(state) {
            state.error = null;
        },
        setFilter(state, action: PayloadAction<SerializedSavedFilter>) {
            state.filters[action.payload.id] = action.payload;
        },
        removeFilter(state, action: PayloadAction<string>) {
            delete state.filters[action.payload];
        },
    },
    extraReducers: (builder) => {
        // Fetch filters
        builder
            .addCase(fetchSavedFilters.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchSavedFilters.fulfilled, (state, action) => {
                state.loading = false;
                state.filters = {};
                for (const filter of action.payload) {
                    state.filters[filter.id] = filter;
                }
            })
            .addCase(fetchSavedFilters.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload as string;
            });

        // Create filter
        builder
            .addCase(createSavedFilter.pending, (state) => {
                state.savingFilter = true;
                state.error = null;
            })
            .addCase(createSavedFilter.fulfilled, (state, action) => {
                state.savingFilter = false;
                state.filters[action.payload.id] = action.payload;
            })
            .addCase(createSavedFilter.rejected, (state, action) => {
                state.savingFilter = false;
                state.error = action.payload as string;
            });

        // Update filter
        builder
            .addCase(updateSavedFilter.pending, (state) => {
                state.savingFilter = true;
                state.error = null;
            })
            .addCase(updateSavedFilter.fulfilled, (state, action) => {
                state.savingFilter = false;
                state.filters[action.payload.id] = action.payload;
            })
            .addCase(updateSavedFilter.rejected, (state, action) => {
                state.savingFilter = false;
                state.error = action.payload as string;
            });

        // Delete filter
        builder
            .addCase(deleteSavedFilter.pending, (state) => {
                state.savingFilter = true;
                state.error = null;
            })
            .addCase(deleteSavedFilter.fulfilled, (state, action) => {
                state.savingFilter = false;
                delete state.filters[action.payload];
            })
            .addCase(deleteSavedFilter.rejected, (state, action) => {
                state.savingFilter = false;
                state.error = action.payload as string;
            });
    },
});

export const { clearSavedFilters, clearError, setFilter, removeFilter } = savedFiltersSlice.actions;

// Selectors
export const selectSavedFilters = (state: RootState) => state.savedFilters?.filters ?? {};
export const selectSavedFiltersLoading = (state: RootState) => state.savedFilters?.loading ?? false;
export const selectSavedFiltersError = (state: RootState) => state.savedFilters?.error ?? null;
export const selectSavingFilter = (state: RootState) => state.savedFilters?.savingFilter ?? false;

// Memoized selectors to prevent unnecessary re-renders
export const selectSavedFiltersArray = createSelector(
    [selectSavedFilters],
    (filters): SerializedSavedFilter[] => {
        return Object.values(filters).sort((a, b) => {
            // Presets first
            if (a.isPreset && !b.isPreset) return -1;
            if (!a.isPreset && b.isPreset) return 1;
            // Then by name
            return a.name.localeCompare(b.name);
        });
    }
);

export const selectUserFilters = createSelector(
    [selectSavedFiltersArray],
    (filters): SerializedSavedFilter[] => filters.filter((f) => !f.isPreset)
);

export const selectPresetFilters = createSelector(
    [selectSavedFiltersArray],
    (filters): SerializedSavedFilter[] => filters.filter((f) => f.isPreset)
);

export const savedFiltersReducer = savedFiltersSlice.reducer;
