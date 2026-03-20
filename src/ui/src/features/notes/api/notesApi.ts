/**
 * Notes API Service
 *
 * Centralized ConnectRPC client for notes operations.
 * All API calls go through this service for consistent error handling.
 */

import { createClient } from '@connectrpc/connect';
import { transport } from '@/config/api';
import { NotesService } from '@uniffy/proto/notes/v1/notes_connect';
import type {
    CreateNoteRequest,
    GetNoteRequest,
    UpdateNoteRequest,
    DeleteNoteRequest,
    ListNotesRequest,
    SearchNotesRequest,
    GetBacklinksRequest,
    RestoreNoteRequest,
    AutosaveNoteRequest,
    MoveNoteRequest,
    CopyNoteRequest,
    ShareNoteWithGroupRequest,
    UnshareNoteFromGroupRequest,
    GetNoteSharingRequest,
    EmptyTrashRequest,
} from '@uniffy/proto/notes/v1/notes_pb';
import type { PartialMessage } from '@bufbuild/protobuf';

/**
 * Create a notes service client with the shared transport.
 */
const notesClient = createClient(NotesService, transport);

/**
 * Notes API service with typed methods.
 */
export const notesApi = {
    /**
     * Create a new note.
     */
    createNote: async (request: PartialMessage<CreateNoteRequest>) => {
        return notesClient.createNote(request);
    },

    /**
     * Get a note by ID.
     */
    getNote: async (request: PartialMessage<GetNoteRequest>) => {
        return notesClient.getNote(request);
    },

    /**
     * Update an existing note.
     */
    updateNote: async (request: PartialMessage<UpdateNoteRequest>) => {
        return notesClient.updateNote(request);
    },

    /**
     * Delete a note (soft delete by default).
     */
    deleteNote: async (request: PartialMessage<DeleteNoteRequest>) => {
        return notesClient.deleteNote(request);
    },

    /**
     * List notes with filters and pagination.
     */
    listNotes: async (request: PartialMessage<ListNotesRequest>) => {
        return notesClient.listNotes(request);
    },

    /**
     * Search notes using full-text search.
     */
    searchNotes: async (request: PartialMessage<SearchNotesRequest>) => {
        return notesClient.searchNotes(request);
    },

    /**
     * Get backlinks for a note.
     */
    getBacklinks: async (request: PartialMessage<GetBacklinksRequest>) => {
        return notesClient.getBacklinks(request);
    },

    /**
     * Restore a deleted note.
     */
    restoreNote: async (request: PartialMessage<RestoreNoteRequest>) => {
        return notesClient.restoreNote(request);
    },

    /**
     * Autosave note content (optimized for frequent updates).
     */
    autosaveNote: async (request: PartialMessage<AutosaveNoteRequest>) => {
        return notesClient.autosaveNote(request);
    },

    /**
     * Move note between spaces.
     */
    moveNote: async (request: PartialMessage<MoveNoteRequest>) => {
        return notesClient.moveNote(request);
    },

    /**
     * Copy note to another space.
     */
    copyNote: async (request: PartialMessage<CopyNoteRequest>) => {
        return notesClient.copyNote(request);
    },

    /**
     * Share note with a group.
     */
    shareNoteWithGroup: async (request: PartialMessage<ShareNoteWithGroupRequest>) => {
        return notesClient.shareNoteWithGroup(request);
    },

    /**
     * Unshare note from a group.
     */
    unshareNoteFromGroup: async (request: PartialMessage<UnshareNoteFromGroupRequest>) => {
        return notesClient.unshareNoteFromGroup(request);
    },

    /**
     * Get sharing information for a note.
     */
    getNoteSharing: async (request: PartialMessage<GetNoteSharingRequest>) => {
        return notesClient.getNoteSharing(request);
    },

    /**
     * Empty trash (permanently delete all soft-deleted notes).
     */
    emptyTrash: async (request: PartialMessage<EmptyTrashRequest>) => {
        return notesClient.emptyTrash(request);
    },
};

