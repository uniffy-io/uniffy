/**
 * Tags Redux slice.
 *
 * Holds the per-org tag namespace, the URN -> tag-id assignment cache,
 * the explorer's tag-list page, the per-tag content list, and the
 * saved-filter store. Domain slices (notes, files, calendar, ...)
 * dispatch ``bulkUpsertTags`` whenever their responses surface
 * hydrated ``Tag`` rows so chips render without a follow-up RPC.
 */

import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

import {
    createSavedFilterThunk,
    createTagThunk,
    deleteSavedFilterThunk,
    deleteTagThunk,
    listContentByTagThunk,
    listSavedFiltersThunk,
    listTagsThunk,
    mergeTagsThunk,
    suggestTagsThunk,
    updateSavedFilterThunk,
    updateTagThunk,
    type SerializedSavedTagFilter,
    type SerializedTag,
    type SerializedTaggedContentItem,
} from '@/features/tags/store/tagsThunks';

interface ContentByTagBucket {
    urns: string[];
    items: Record<string, SerializedTaggedContentItem>;
    nextPageToken: string;
    status: 'idle' | 'loading' | 'succeeded' | 'failed';
    error: string | null;
}

export interface TagsState {
    byId: Record<string, SerializedTag>;
    bySlug: Record<string, string>;
    assignmentsByUrn: Record<string, string[]>;

    suggestionIds: string[];
    suggestStatus: 'idle' | 'loading' | 'succeeded' | 'failed';
    suggestError: string | null;

    listIds: string[];
    listStatus: 'idle' | 'loading' | 'succeeded' | 'failed';
    listError: string | null;
    listNextPageToken: string;

    contentByTag: Record<string, ContentByTagBucket>;

    savedFilters: {
        byId: Record<string, SerializedSavedTagFilter>;
        ids: string[];
        status: 'idle' | 'loading' | 'succeeded' | 'failed';
        error: string | null;
    };
}

const initialState: TagsState = {
    byId: {},
    bySlug: {},
    assignmentsByUrn: {},

    suggestionIds: [],
    suggestStatus: 'idle',
    suggestError: null,

    listIds: [],
    listStatus: 'idle',
    listError: null,
    listNextPageToken: '',

    contentByTag: {},

    savedFilters: {
        byId: {},
        ids: [],
        status: 'idle',
        error: null,
    },
};

function indexTag(state: TagsState, tag: SerializedTag): void {
    const previous = state.byId[tag.id];
    if (previous && previous.slug !== tag.slug) {
        delete state.bySlug[previous.slug];
    }
    state.byId[tag.id] = tag;
    state.bySlug[tag.slug] = tag.id;
}

function dropTagId(state: TagsState, tagId: string): void {
    const tag = state.byId[tagId];
    if (tag) {
        delete state.bySlug[tag.slug];
        delete state.byId[tagId];
    }
    state.listIds = state.listIds.filter((id) => id !== tagId);
    state.suggestionIds = state.suggestionIds.filter((id) => id !== tagId);
    delete state.contentByTag[tagId];
    for (const urn of Object.keys(state.assignmentsByUrn)) {
        state.assignmentsByUrn[urn] = state.assignmentsByUrn[urn].filter(
            (id) => id !== tagId
        );
    }
    for (const filterId of state.savedFilters.ids) {
        const filter = state.savedFilters.byId[filterId];
        if (!filter) continue;
        if (filter.criteria.tagIds.includes(tagId)) {
            filter.criteria = {
                ...filter.criteria,
                tagIds: filter.criteria.tagIds.filter((id) => id !== tagId),
            };
            filter.removedTagCount += 1;
        }
    }
}

const tagsSlice = createSlice({
    name: 'tags',
    initialState,
    reducers: {
        bulkUpsertTags(state, action: PayloadAction<SerializedTag[]>) {
            for (const tag of action.payload) {
                indexTag(state, tag);
            }
        },
        setAssignmentsForUrn(
            state,
            action: PayloadAction<{ urn: string; tagIds: string[] }>
        ) {
            const { urn, tagIds } = action.payload;
            state.assignmentsByUrn[urn] = tagIds;
        },
        applyAssignmentChange(
            state,
            action: PayloadAction<{
                urn: string;
                added: string[];
                removed: string[];
            }>
        ) {
            const { urn, added, removed } = action.payload;
            const current = new Set(state.assignmentsByUrn[urn] ?? []);
            for (const id of removed) current.delete(id);
            for (const id of added) current.add(id);
            state.assignmentsByUrn[urn] = Array.from(current);
        },
        patchTag(
            state,
            action: PayloadAction<{ id: string } & Partial<SerializedTag>>
        ) {
            const existing = state.byId[action.payload.id];
            if (!existing) return;
            state.byId[action.payload.id] = { ...existing, ...action.payload };
        },
        removeTagLocal(state, action: PayloadAction<string>) {
            dropTagId(state, action.payload);
        },
        clearTags() {
            return { ...initialState, savedFilters: { ...initialState.savedFilters } };
        },
    },
    extraReducers: (builder) => {
        builder.addCase(suggestTagsThunk.pending, (state) => {
            state.suggestStatus = 'loading';
            state.suggestError = null;
        });
        builder.addCase(suggestTagsThunk.fulfilled, (state, action) => {
            state.suggestStatus = 'succeeded';
            state.suggestionIds = action.payload.map((t) => t.id);
            for (const tag of action.payload) indexTag(state, tag);
        });
        builder.addCase(suggestTagsThunk.rejected, (state, action) => {
            state.suggestStatus = 'failed';
            state.suggestError = action.payload ?? action.error.message ?? 'Suggest failed';
        });

        builder.addCase(createTagThunk.fulfilled, (state, action) => {
            indexTag(state, action.payload);
        });

        builder.addCase(updateTagThunk.fulfilled, (state, action) => {
            indexTag(state, action.payload);
        });

        builder.addCase(deleteTagThunk.fulfilled, (state, action) => {
            dropTagId(state, action.payload);
        });

        builder.addCase(mergeTagsThunk.fulfilled, (state, action) => {
            indexTag(state, action.payload.target);
            dropTagId(state, action.payload.sourceTagId);
            for (const urn of Object.keys(state.assignmentsByUrn)) {
                const ids = state.assignmentsByUrn[urn];
                if (ids.includes(action.payload.sourceTagId)) {
                    state.assignmentsByUrn[urn] = Array.from(
                        new Set(
                            ids
                                .filter((id) => id !== action.payload.sourceTagId)
                                .concat(action.payload.target.id)
                        )
                    );
                }
            }
        });

        builder.addCase(listTagsThunk.pending, (state, action) => {
            state.listStatus = 'loading';
            state.listError = null;
            if (!action.meta.arg?.pageToken) {
                state.listIds = [];
                state.listNextPageToken = '';
            }
        });
        builder.addCase(listTagsThunk.fulfilled, (state, action) => {
            state.listStatus = 'succeeded';
            const newIds = action.payload.tags.map((t) => t.id);
            const merged = action.meta.arg?.pageToken
                ? Array.from(new Set([...state.listIds, ...newIds]))
                : newIds;
            state.listIds = merged;
            state.listNextPageToken = action.payload.nextPageToken;
            for (const tag of action.payload.tags) indexTag(state, tag);
        });
        builder.addCase(listTagsThunk.rejected, (state, action) => {
            state.listStatus = 'failed';
            state.listError = action.payload ?? action.error.message ?? 'List failed';
        });

        builder.addCase(listContentByTagThunk.pending, (state, action) => {
            const key = action.meta.arg.tag;
            const bucket: ContentByTagBucket = state.contentByTag[key] ?? {
                urns: [],
                items: {},
                nextPageToken: '',
                status: 'idle',
                error: null,
            };
            bucket.status = 'loading';
            bucket.error = null;
            if (!action.meta.arg.pageToken) {
                bucket.urns = [];
                bucket.items = {};
                bucket.nextPageToken = '';
            }
            state.contentByTag[key] = bucket;
        });
        builder.addCase(listContentByTagThunk.fulfilled, (state, action) => {
            const key = action.meta.arg.tag;
            const bucket: ContentByTagBucket = state.contentByTag[key] ?? {
                urns: [],
                items: {},
                nextPageToken: '',
                status: 'idle',
                error: null,
            };
            bucket.status = 'succeeded';
            const newUrns = action.payload.items.map((item) => item.urn);
            bucket.urns = action.payload.appended
                ? Array.from(new Set([...bucket.urns, ...newUrns]))
                : newUrns;
            for (const item of action.payload.items) bucket.items[item.urn] = item;
            bucket.nextPageToken = action.payload.nextPageToken;
            state.contentByTag[key] = bucket;
        });
        builder.addCase(listContentByTagThunk.rejected, (state, action) => {
            const key = action.meta.arg.tag;
            const bucket = state.contentByTag[key];
            if (bucket) {
                bucket.status = 'failed';
                bucket.error = action.payload ?? action.error.message ?? 'Failed';
            }
        });

        builder.addCase(listSavedFiltersThunk.pending, (state) => {
            state.savedFilters.status = 'loading';
            state.savedFilters.error = null;
        });
        builder.addCase(listSavedFiltersThunk.fulfilled, (state, action) => {
            state.savedFilters.status = 'succeeded';
            state.savedFilters.byId = {};
            state.savedFilters.ids = [];
            for (const filter of action.payload) {
                state.savedFilters.byId[filter.id] = filter;
                state.savedFilters.ids.push(filter.id);
            }
        });
        builder.addCase(listSavedFiltersThunk.rejected, (state, action) => {
            state.savedFilters.status = 'failed';
            state.savedFilters.error =
                action.payload ?? action.error.message ?? 'List failed';
        });

        builder.addCase(createSavedFilterThunk.fulfilled, (state, action) => {
            state.savedFilters.byId[action.payload.id] = action.payload;
            if (!state.savedFilters.ids.includes(action.payload.id)) {
                state.savedFilters.ids.push(action.payload.id);
            }
        });
        builder.addCase(updateSavedFilterThunk.fulfilled, (state, action) => {
            state.savedFilters.byId[action.payload.id] = action.payload;
            if (!state.savedFilters.ids.includes(action.payload.id)) {
                state.savedFilters.ids.push(action.payload.id);
            }
        });
        builder.addCase(deleteSavedFilterThunk.fulfilled, (state, action) => {
            delete state.savedFilters.byId[action.payload];
            state.savedFilters.ids = state.savedFilters.ids.filter(
                (id) => id !== action.payload
            );
        });
    },
});

export const {
    bulkUpsertTags,
    setAssignmentsForUrn,
    applyAssignmentChange,
    patchTag,
    removeTagLocal,
    clearTags,
} = tagsSlice.actions;
export const tagsReducer = tagsSlice.reducer;
export type { SerializedTag, SerializedSavedTagFilter, SerializedTaggedContentItem };
