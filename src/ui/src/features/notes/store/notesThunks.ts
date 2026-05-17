/**
 * Notes Async Thunks
 *
 * Redux async thunks for notes API operations.
 * All async operations go through these thunks for proper state management.
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import type { Dispatch, UnknownAction } from '@reduxjs/toolkit';
import { timestampDate } from '@bufbuild/protobuf/wkt';
import { notesApi } from '@/features/notes/api/notesApi';
import type { RootState, AppDispatch } from '@/app/store';
import type { Note } from '@uniffy/proto/notes/v1/notes_pb';
import { NodeType } from '@uniffy/proto/notes/v1/notes_pb';
import type { AccessMode, ContentRole } from '@uniffy/proto/common/v1/common_pb';
import { organizeNotesBySection, type OrganizedNotes } from '@/features/notes/utils/notesTreeUtils';
import {
    getCachedNotes,
    setCachedNotes,
    isIndexedDBAvailable,
} from '@/features/notes/utils/notesCache';
import { bulkUpsertTags } from '@/features/tags/store/tagsSlice';
import { tagToPlain } from '@/features/tags/store/tagsThunks';

// Request deduplication - track in-flight requests
let initializeRequestPromise: Promise<{
    notes: SerializedNote[];
    tree: OrganizedNotes;
    totalCount: number;
}> | null = null;
// Helper to get organization ID from state
const getOrganizationId = (state: RootState): string => {
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) {
        throw new Error('No organization selected');
    }
    return orgId;
};

// Helper to convert proto Note to serializable plain object
// Note: bigint values are converted to number for Redux serialization
// Note: Bookmark status is managed separately in the bookmarks store
// Note: hydrated unified tags travel as ids on the note row; the rich
// Tag objects live in the tags slice (hydrated once via dispatch).
const noteToPlain = (note: Note) => ({
    id: note.id,
    organizationId: note.organizationId,
    ownerId: note.ownerId,
    accessMode: note.accessMode,
    baselineRole: note.baselineRole ?? null,
    userRole: note.userRole,
    nodeType: note.nodeType,
    title: note.title,
    content: note.content,
    slug: note.slug,
    isDeleted: note.isDeleted,
    version: typeof note.version === 'bigint' ? Number(note.version) : note.version,
    parentId: note.parentId,
    tagIds: note.tags.map((t) => t.id),
    metadata: { ...note.metadata },
    createdAt: note.createdAt ? {
        seconds: typeof note.createdAt.seconds === 'bigint' ? Number(note.createdAt.seconds) : note.createdAt.seconds,
        nanos: typeof note.createdAt.nanos === 'bigint' ? Number(note.createdAt.nanos) : note.createdAt.nanos
    } : undefined,
    updatedAt: note.updatedAt ? {
        seconds: typeof note.updatedAt.seconds === 'bigint' ? Number(note.updatedAt.seconds) : note.updatedAt.seconds,
        nanos: typeof note.updatedAt.nanos === 'bigint' ? Number(note.updatedAt.nanos) : note.updatedAt.nanos
    } : undefined,
    deletedAt: note.deletedAt ? {
        seconds: typeof note.deletedAt.seconds === 'bigint' ? Number(note.deletedAt.seconds) : note.deletedAt.seconds,
        nanos: typeof note.deletedAt.nanos === 'bigint' ? Number(note.deletedAt.nanos) : note.deletedAt.nanos
    } : undefined,
    outgoingReferences: [...note.outgoingReferences],
    icon: note.icon ? {
        type: note.icon.iconType as 'icon' | 'emoji',
        value: note.icon.value,
    } : undefined,
});

/**
 * Push hydrated unified Tag rows from a note proto into the tags slice
 * cache. Domain thunks call this after every API call that returns a
 * note so chips can render without a follow-up fetch.
 */
function hydrateNoteTags(dispatch: Dispatch<UnknownAction>, notes: ReadonlyArray<Note>): void {
    const seen = new Map<string, ReturnType<typeof tagToPlain>>();
    for (const note of notes) {
        for (const tag of note.tags) {
            if (!seen.has(tag.id)) {
                seen.set(tag.id, tagToPlain(tag));
            }
        }
    }
    if (seen.size === 0) return;
    dispatch(bulkUpsertTags(Array.from(seen.values())));
}

/** Serialized note type for Redux storage (bigints converted to numbers) */
export type SerializedNote = ReturnType<typeof noteToPlain>;

/**
 * Fetch all notes for the current organization.
 * When fetchAllPages is true, automatically fetches all pages and combines results.
 */
export const fetchNotes = createAsyncThunk<
    {
        notes: SerializedNote[];
        totalCount: number;
        page: number;
        pageSize: number;
        totalPages: number;
    },
    {
        page?: number;
        pageSize?: number;
        parentId?: string;
        accessMode?: AccessMode;
        personalOnly?: boolean;
        includeDeleted?: boolean;
        groupId?: string;
        tagIds?: string[];
        sortBy?: string;
        sortOrder?: string;
        excludeContent?: boolean;
        /** When true, fetches all pages automatically */
        fetchAllPages?: boolean;
    } | void,
    { state: RootState; rejectValue: string; dispatch: AppDispatch }
>('notes/fetchNotes', async (params, { getState, rejectWithValue, dispatch }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const pageSize = params?.pageSize ?? 100;

        // Fetch first page
        const firstResponse = await notesApi.listNotes({
            organizationId,
            page: params?.page ?? 1,
            pageSize,
            parentId: params?.parentId,
            accessMode: params?.accessMode,
            personalOnly: params?.personalOnly ?? false,
            includeDeleted: params?.includeDeleted ?? true,
            groupId: params?.groupId,
            tagIds: params?.tagIds ?? [],
            sortBy: params?.sortBy ?? 'updated_at',
            sortOrder: params?.sortOrder ?? 'desc',
            excludeContent: params?.excludeContent ?? true,
        });

        // If not fetching all pages or only one page exists, return first response
        if (!params?.fetchAllPages || firstResponse.totalPages <= 1) {
            hydrateNoteTags(dispatch, firstResponse.notes);
            return {
                notes: firstResponse.notes.map(noteToPlain),
                totalCount: firstResponse.totalCount,
                page: firstResponse.page,
                pageSize: firstResponse.pageSize,
                totalPages: firstResponse.totalPages,
            };
        }

        // Fetch remaining pages in parallel
        const allNotes = [...firstResponse.notes];
        const remainingPages = Array.from(
            { length: firstResponse.totalPages - 1 },
            (_, i) => i + 2
        );

        const pageResponses = await Promise.all(
            remainingPages.map(page =>
                notesApi.listNotes({
                    organizationId,
                    page,
                    pageSize,
                    parentId: params?.parentId,
                    accessMode: params?.accessMode,
                    personalOnly: params?.personalOnly ?? false,
                    includeDeleted: params?.includeDeleted ?? true,
                    groupId: params?.groupId,
                    tagIds: params?.tagIds ?? [],
                    sortBy: params?.sortBy ?? 'updated_at',
                    sortOrder: params?.sortOrder ?? 'desc',
                    excludeContent: params?.excludeContent ?? true,
                })
            )
        );

        for (const response of pageResponses) {
            allNotes.push(...response.notes);
        }

        hydrateNoteTags(dispatch, allNotes);
        return {
            notes: allNotes.map(noteToPlain),
            totalCount: firstResponse.totalCount,
            page: 1,
            pageSize: allNotes.length,
            totalPages: 1,
        };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch notes');
    }
});

/**
 * Fetch deleted notes (trash).
 */
export const fetchDeletedNotes = createAsyncThunk<
    SerializedNote[],
    void,
    { state: RootState; rejectValue: string }
>('notes/fetchDeletedNotes', async (_, { getState, rejectWithValue, dispatch }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.listNotes({
            organizationId,
            includeDeleted: true,
            pageSize: 100,
        });
        const deleted = response.notes.filter((n) => n.isDeleted);
        hydrateNoteTags(dispatch, deleted);
        return deleted.map(noteToPlain);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch deleted notes');
    }
});

/**
 * Fetch a single note by ID.
 */
export const fetchNote = createAsyncThunk<
    SerializedNote,
    string,
    { state: RootState; rejectValue: string }
>('notes/fetchNote', async (noteId, { getState, rejectWithValue, dispatch }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.getNote({
            noteId,
            organizationId,
        });
        if (!response.note) {
            return rejectWithValue('Note not found');
        }
        hydrateNoteTags(dispatch, [response.note]);
        return noteToPlain(response.note);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch note');
    }
});

/**
 * Create a new note or folder.
 */
export const createNote = createAsyncThunk<
    SerializedNote,
    {
        title: string;
        content?: string;
        accessMode?: AccessMode;
        baselineRole?: ContentRole;
        parentId?: string;
        tagIds?: string[];
        nodeType?: NodeType;
    },
    { state: RootState; rejectValue: string; dispatch: AppDispatch }
>('notes/createNote', async (params, { getState, rejectWithValue, dispatch }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.createNote({
            organizationId,
            title: params.title,
            content: params.content ?? '',
            accessMode: params.accessMode,
            baselineRole: params.baselineRole,
            parentId: params.parentId,
            tagIds: params.tagIds ?? [],
            nodeType: params.nodeType ?? NodeType.NOTE,
        });
        if (!response.note) {
            return rejectWithValue('Failed to create note');
        }
        hydrateNoteTags(dispatch, [response.note]);
        return noteToPlain(response.note);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to create note');
    }
});

/**
 * Update a note.
 */
export const updateNote = createAsyncThunk<
    SerializedNote,
    {
        noteId: string;
        title?: string;
        content?: string;
        tagIds?: string[];
        parentId?: string;
    },
    { state: RootState; rejectValue: string; dispatch: AppDispatch }
>('notes/updateNote', async (params, { getState, rejectWithValue, dispatch }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.updateNote({
            noteId: params.noteId,
            organizationId,
            title: params.title,
            content: params.content,
            tagIds: params.tagIds !== undefined ? { ids: params.tagIds } : undefined,
            parentId: params.parentId,
        });
        if (!response.note) {
            return rejectWithValue('Failed to update note');
        }
        hydrateNoteTags(dispatch, [response.note]);
        return noteToPlain(response.note);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to update note');
    }
});

/**
 * Update note icon.
 */
export const updateNoteIcon = createAsyncThunk<
    SerializedNote,
    {
        noteId: string;
        icon: { type: 'icon' | 'emoji'; value: string } | null;
    },
    { state: RootState; rejectValue: string }
>('notes/updateNoteIcon', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.updateNote({
            noteId: params.noteId,
            organizationId,
            icon: params.icon ? {
                iconType: params.icon.type,
                value: params.icon.value,
            } : undefined,
        });
        if (!response.note) {
            return rejectWithValue('Failed to update note icon');
        }
        return noteToPlain(response.note);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to update note icon');
    }
});

/**
 * Autosave note content (debounced calls should happen at component level).
 *
 * Sends the version the client based the draft on. If another user has
 * advanced the note past that version, the server replies with
 * `[aborted]` and we surface a `versionConflict` rejection so callers
 * can refresh and preserve the user's draft.
 */
export const VERSION_CONFLICT_REJECTION = 'versionConflict';

export const autosaveNote = createAsyncThunk<
    { noteId: string; version: number; savedAt: string },
    {
        noteId: string;
        content: string;
        title?: string;
    },
    { state: RootState; rejectValue: string }
>('notes/autosaveNote', async (params, { getState, rejectWithValue }) => {
    try {
        const state = getState();
        const organizationId = getOrganizationId(state);
        const baseVersion = state.notes.notes[params.noteId]?.version;
        const response = await notesApi.autosaveNote({
            noteId: params.noteId,
            organizationId,
            content: params.content,
            title: params.title,
            clientTimestamp: BigInt(Date.now()),
            expectedVersion: baseVersion != null ? BigInt(baseVersion) : undefined,
        });
        if (!response.success) {
            return rejectWithValue('Autosave failed');
        }
        return {
            noteId: params.noteId,
            // Convert BigInt to Number for Redux serialization
            version: typeof response.version === 'bigint' ? Number(response.version) : response.version,
            // Convert Date to ISO string for Redux serialization
            savedAt: (response.savedAt ? timestampDate(response.savedAt) : new Date()).toISOString(),
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Autosave failed';
        if (/\[aborted\]/i.test(message)) {
            return rejectWithValue(VERSION_CONFLICT_REJECTION);
        }
        return rejectWithValue(message);
    }
});

/**
 * Delete a note (soft delete by default).
 */
export const deleteNote = createAsyncThunk<
    { noteId: string; permanent: boolean },
    { noteId: string; permanent?: boolean },
    { state: RootState; rejectValue: string }
>('notes/deleteNote', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.deleteNote({
            noteId: params.noteId,
            organizationId,
            permanent: params.permanent ?? false,
        });
        if (!response.success) {
            return rejectWithValue(response.message || 'Failed to delete note');
        }
        return { noteId: params.noteId, permanent: params.permanent ?? false };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to delete note');
    }
});

/**
 * Restore a deleted note.
 */
export const restoreNote = createAsyncThunk<
    SerializedNote,
    string,
    { state: RootState; rejectValue: string }
>('notes/restoreNote', async (noteId, { getState, rejectWithValue, dispatch }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.restoreNote({
            noteId,
            organizationId,
        });
        if (!response.note) {
            return rejectWithValue('Failed to restore note');
        }
        hydrateNoteTags(dispatch, [response.note]);
        return noteToPlain(response.note);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to restore note');
    }
});

/**
 * Search notes.
 */
export const searchNotes = createAsyncThunk<
    { notes: SerializedNote[]; totalCount: number },
    { query: string; includeDeleted?: boolean },
    { state: RootState; rejectValue: string; dispatch: AppDispatch }
>('notes/searchNotes', async (params, { getState, rejectWithValue, dispatch }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.searchNotes({
            organizationId,
            query: params.query,
            includeDeleted: params.includeDeleted ?? false,
            pageSize: 50,
        });
        hydrateNoteTags(dispatch, response.notes);
        return {
            notes: response.notes.map(noteToPlain),
            totalCount: response.totalCount,
        };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Search failed');
    }
});

/**
 * Get backlinks for a note.
 */
export const fetchBacklinks = createAsyncThunk<
    { noteId: string; backlinks: Array<{ id: string; title: string; slug: string }> },
    string,
    { state: RootState; rejectValue: string }
>('notes/fetchBacklinks', async (noteId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.getBacklinks({
            noteId,
            organizationId,
        });
        return {
            noteId,
            backlinks: response.backlinks.map(b => ({
                id: b.id,
                title: b.title,
                slug: b.slug,
            })),
        };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch backlinks');
    }
});

/**
 * Move note to a different space.
 */
export const moveNote = createAsyncThunk<
    SerializedNote,
    { noteId: string; targetAccessMode: AccessMode; targetBaselineRole?: ContentRole },
    { state: RootState; rejectValue: string }
>('notes/moveNote', async (params, { getState, rejectWithValue, dispatch }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.moveNote({
            noteId: params.noteId,
            organizationId,
            targetAccessMode: params.targetAccessMode,
            targetBaselineRole: params.targetBaselineRole,
        });
        if (!response.note) {
            return rejectWithValue('Failed to move note');
        }
        hydrateNoteTags(dispatch, [response.note]);
        return noteToPlain(response.note);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to move note');
    }
});

/**
 * Copy note to another space.
 */
export const copyNote = createAsyncThunk<
    SerializedNote,
    { noteId: string; targetAccessMode: AccessMode; targetBaselineRole?: ContentRole; title?: string },
    { state: RootState; rejectValue: string }
>('notes/copyNote', async (params, { getState, rejectWithValue, dispatch }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.copyNote({
            noteId: params.noteId,
            organizationId,
            targetAccessMode: params.targetAccessMode,
            targetBaselineRole: params.targetBaselineRole,
            title: params.title,
        });
        if (!response.note) {
            return rejectWithValue('Failed to copy note');
        }
        hydrateNoteTags(dispatch, [response.note]);
        return noteToPlain(response.note);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to copy note');
    }
});

/**
 * Fetch notes from API (internal helper).
 * Handles pagination and returns all notes.
 */
async function fetchAllNotesFromAPI(
    organizationId: string,
    currentUserId: string,
    dispatch: Dispatch<UnknownAction>,
): Promise<{
    notes: SerializedNote[];
    tree: OrganizedNotes;
    totalCount: number;
}> {
    const pageSize = 500;

    // Fetch first page
    const firstResponse = await notesApi.listNotes({
        organizationId,
        page: 1,
        pageSize,
        includeDeleted: true,
        excludeContent: true,
    });

    const allNotes = [...firstResponse.notes];

    // Fetch remaining pages in parallel if needed
    if (firstResponse.totalPages > 1) {
        const remainingPages = Array.from(
            { length: firstResponse.totalPages - 1 },
            (_, i) => i + 2
        );

        const pageResponses = await Promise.all(
            remainingPages.map(page =>
                notesApi.listNotes({
                    organizationId,
                    page,
                    pageSize,
                    includeDeleted: true,
                    excludeContent: true,
                })
            )
        );

        for (const response of pageResponses) {
            allNotes.push(...response.notes);
        }
    }

    hydrateNoteTags(dispatch, allNotes);

    // Convert to serializable format
    const serializedNotes = allNotes.map(noteToPlain);

    // Organize into tree structure
    const tree = organizeNotesBySection(serializedNotes, currentUserId);

    return {
        notes: serializedNotes,
        tree,
        totalCount: firstResponse.totalCount,
    };
}

/**
 * Initialize all notes data with caching support.
 *
 * Load strategy:
 * 1. If cache exists and is fresh (< 5 min) → return cached data, no API call
 * 2. If cache exists but stale → return cached data immediately, revalidate in background
 * 3. If no cache → fetch from API
 *
 * This is the primary entry point for loading notes on page mount.
 * Both notesSlice and notesTreeSlice listen to this action.
 */
export const initializeNotesData = createAsyncThunk<
    {
        notes: SerializedNote[];
        tree: OrganizedNotes;
        totalCount: number;
        fromCache?: boolean;
    },
    {
        /** Force API fetch even if cache is fresh */
        forceRefresh?: boolean;
    } | void,
    { state: RootState; rejectValue: string }
>('notes/initializeNotesData', async (params, { getState, rejectWithValue, dispatch }) => {
    try {
        const state = getState();
        const organizationId = state.auth.currentOrganizationId;
        const currentUserId = state.auth.user?.id || '';

        if (!organizationId) {
            return rejectWithValue('No organization selected');
        }

        const forceRefresh = params?.forceRefresh ?? false;

        // Skip the fetch only if the tree itself has been hydrated.
        // notesCount > 0 is unreliable here: fetchNote / searchNotes can populate
        // state.notes.notes without ever loading the tree, which would otherwise
        // cause this thunk to short-circuit with a partial tree.
        if (state.notesTree.treeLoaded && !forceRefresh) {
            const existingNotes = Object.values(state.notes.notes);
            return {
                notes: existingNotes,
                tree: state.notesTree.tree,
                totalCount: state.notes.pagination.totalCount,
                fromCache: true,
            };
        }

        // Request deduplication - if a fetch is already in progress, wait for it
        if (initializeRequestPromise && !forceRefresh) {
            const result = await initializeRequestPromise;
            return { ...result, fromCache: false };
        }

        // Try to load from IndexedDB cache first (stale-while-revalidate pattern)
        // Always show cached data immediately, then revalidate in background
        if (isIndexedDBAvailable() && !forceRefresh) {
            const cached = await getCachedNotes(organizationId, currentUserId);

            if (cached) {
                // Start background revalidation (fire and forget)
                // This runs regardless of cache freshness - ensures shared notes appear quickly
                fetchAllNotesFromAPI(organizationId, currentUserId, dispatch)
                    .then((freshData) => {
                        // Update cache
                        setCachedNotes(
                            organizationId,
                            currentUserId,
                            freshData.notes,
                            freshData.tree,
                            freshData.totalCount
                        );
                        // Dispatch update to Redux (this will trigger UI update if data changed)
                        dispatch({
                            type: 'notes/backgroundRefreshComplete',
                            payload: freshData,
                        });
                    })
                    .catch((error) => {
                        console.error('[NotesCache] Background revalidation failed:', error);
                    });

                // Return cached data immediately for instant UI
                return {
                    notes: cached.notes,
                    tree: cached.tree,
                    totalCount: cached.totalCount,
                    fromCache: true,
                };
            }
        }

        // No cache - fetch from API with deduplication
        initializeRequestPromise = fetchAllNotesFromAPI(organizationId, currentUserId, dispatch);

        try {
            const result = await initializeRequestPromise;

            // Save to cache for next time
            if (isIndexedDBAvailable()) {
                setCachedNotes(
                    organizationId,
                    currentUserId,
                    result.notes,
                    result.tree,
                    result.totalCount
                ).catch((error) => {
                    console.error('[NotesCache] Failed to save to cache:', error);
                });
            }

            return { ...result, fromCache: false };
        } finally {
            initializeRequestPromise = null;
        }
    } catch (error) {
        initializeRequestPromise = null;
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to initialize notes');
    }
});
