/**
 * Notes Async Thunks
 *
 * Redux async thunks for notes API operations.
 * All async operations go through these thunks for proper state management.
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import { notesApi } from '../api/notesApi';
import type { RootState } from '@/app/store';
import type { Note } from '@/gen/notes/v1/notes_pb';
import { NodeType, type VisibilityScope } from '@/gen/notes/v1/notes_pb';
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
const noteToPlain = (note: Note) => ({
    id: note.id,
    organizationId: note.organizationId,
    ownerId: note.ownerId,
    visibility: note.visibility,
    nodeType: note.nodeType,
    title: note.title,
    content: note.content,
    slug: note.slug,
    isDeleted: note.isDeleted,
    version: typeof note.version === 'bigint' ? Number(note.version) : note.version,
    parentId: note.parentId,
    tags: [...note.tags],
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
    groupIds: [...note.groupIds],
    userPermission: note.userPermission,
    outgoingReferences: [...note.outgoingReferences],
    // Custom icon (heroicon name or emoji)
    icon: note.icon ? {
        type: note.icon.iconType as 'heroicon' | 'emoji',
        value: note.icon.value,
    } : undefined,
});

/** Serialized note type for Redux storage (bigints converted to numbers) */
export type SerializedNote = ReturnType<typeof noteToPlain>;

/**
 * Fetch all notes for the current organization.
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
        visibility?: VisibilityScope;
        personalOnly?: boolean;
        includeDeleted?: boolean;
        groupId?: string;
        tags?: string[];
        sortBy?: string;
        sortOrder?: string;
        excludeContent?: boolean;
    } | void,
    { state: RootState; rejectValue: string }
>('notes/fetchNotes', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.listNotes({
            organizationId,
            page: params?.page ?? 1,
            pageSize: params?.pageSize ?? 500,
            parentId: params?.parentId,
            visibility: params?.visibility,
            personalOnly: params?.personalOnly ?? false,
            includeDeleted: params?.includeDeleted ?? true,
            groupId: params?.groupId,
            tags: params?.tags ?? [],
            sortBy: params?.sortBy ?? 'updated_at',
            sortOrder: params?.sortOrder ?? 'desc',
            excludeContent: params?.excludeContent ?? true,
        });

        return {
            notes: response.notes.map(noteToPlain),
            totalCount: response.totalCount,
            page: response.page,
            pageSize: response.pageSize,
            totalPages: response.totalPages,
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
>('notes/fetchDeletedNotes', async (_, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.listNotes({
            organizationId,
            includeDeleted: true,
            pageSize: 100,
        });
        // Filter to only deleted notes
        return response.notes.filter(n => n.isDeleted).map(noteToPlain);
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
>('notes/fetchNote', async (noteId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.getNote({
            noteId,
            organizationId,
        });
        if (!response.note) {
            return rejectWithValue('Note not found');
        }
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
        visibility?: VisibilityScope;
        parentId?: string;
        tags?: string[];
        groupIds?: string[];
        nodeType?: NodeType;
    },
    { state: RootState; rejectValue: string }
>('notes/createNote', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.createNote({
            organizationId,
            title: params.title,
            content: params.content ?? '',
            visibility: params.visibility,
            parentId: params.parentId,
            tags: params.tags ?? [],
            groupIds: params.groupIds ?? [],
            nodeType: params.nodeType ?? NodeType.NOTE,
        });
        if (!response.note) {
            return rejectWithValue('Failed to create note');
        }
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
        tags?: string[];
        parentId?: string;
    },
    { state: RootState; rejectValue: string }
>('notes/updateNote', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.updateNote({
            noteId: params.noteId,
            organizationId,
            title: params.title,
            content: params.content,
            tags: params.tags,
            parentId: params.parentId,
        });
        if (!response.note) {
            return rejectWithValue('Failed to update note');
        }
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
        icon: { type: 'heroicon' | 'emoji'; value: string } | null;
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
 */
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
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.autosaveNote({
            noteId: params.noteId,
            organizationId,
            content: params.content,
            title: params.title,
            clientTimestamp: BigInt(Date.now()),
        });
        if (!response.success) {
            return rejectWithValue('Autosave failed');
        }
        return {
            noteId: params.noteId,
            // Convert BigInt to Number for Redux serialization
            version: typeof response.version === 'bigint' ? Number(response.version) : response.version,
            // Convert Date to ISO string for Redux serialization
            savedAt: (response.savedAt?.toDate() ?? new Date()).toISOString(),
        };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Autosave failed');
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
>('notes/restoreNote', async (noteId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.restoreNote({
            noteId,
            organizationId,
        });
        if (!response.note) {
            return rejectWithValue('Failed to restore note');
        }
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
    { query: string; tags?: string[]; includeDeleted?: boolean },
    { state: RootState; rejectValue: string }
>('notes/searchNotes', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.searchNotes({
            organizationId,
            query: params.query,
            tags: params.tags ?? [],
            includeDeleted: params.includeDeleted ?? false,
            pageSize: 50,
        });
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
    { noteId: string; targetVisibility: VisibilityScope; targetGroupIds?: string[] },
    { state: RootState; rejectValue: string }
>('notes/moveNote', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.moveNote({
            noteId: params.noteId,
            organizationId,
            targetVisibility: params.targetVisibility,
            targetGroupIds: params.targetGroupIds ?? [],
        });
        if (!response.note) {
            return rejectWithValue('Failed to move note');
        }
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
    { noteId: string; targetVisibility: VisibilityScope; targetGroupIds?: string[]; title?: string },
    { state: RootState; rejectValue: string }
>('notes/copyNote', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await notesApi.copyNote({
            noteId: params.noteId,
            organizationId,
            targetVisibility: params.targetVisibility,
            targetGroupIds: params.targetGroupIds ?? [],
            title: params.title,
        });
        if (!response.note) {
            return rejectWithValue('Failed to copy note');
        }
        return noteToPlain(response.note);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to copy note');
    }
});
