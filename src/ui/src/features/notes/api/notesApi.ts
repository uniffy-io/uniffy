/**
 * Notes API Service
 *
 * Centralized ConnectRPC client for notes operations.
 * All API calls go through this service for consistent error handling.
 */

import { createClient } from '@connectrpc/connect';
import { unaryTransport } from '@/config/api';
import { NotesService, CopyNoteRequestSchema, CreateNoteRequestSchema, DeleteNoteRequestSchema, EmptyTrashRequestSchema, GetBacklinksRequestSchema, GetNoteRequestSchema, ListNotesRequestSchema, MoveNoteRequestSchema, RestoreNoteRequestSchema, SearchNotesRequestSchema, UpdateNoteRequestSchema } from '@uniffy/proto/notes/v1/notes_pb';
import type { MessageInitShape } from '@bufbuild/protobuf';

/**
 * Create a notes service client with the shared transport.
 */
const notesClient = createClient(NotesService, unaryTransport);

/**
 * Notes API service with typed methods.
 */
export const notesApi = {
    /**
     * Create a new note.
     */
    createNote: async (request: MessageInitShape<typeof CreateNoteRequestSchema>) => {
        return notesClient.createNote(request);
    },

    /**
     * Get a note by ID.
     */
    getNote: async (request: MessageInitShape<typeof GetNoteRequestSchema>) => {
        return notesClient.getNote(request);
    },

    /**
     * Update an existing note.
     */
    updateNote: async (request: MessageInitShape<typeof UpdateNoteRequestSchema>) => {
        return notesClient.updateNote(request);
    },

    /**
     * Delete a note (soft delete by default).
     */
    deleteNote: async (request: MessageInitShape<typeof DeleteNoteRequestSchema>) => {
        return notesClient.deleteNote(request);
    },

    /**
     * List notes with filters and pagination.
     */
    listNotes: async (request: MessageInitShape<typeof ListNotesRequestSchema>) => {
        return notesClient.listNotes(request);
    },

    /**
     * Search notes using full-text search.
     */
    searchNotes: async (request: MessageInitShape<typeof SearchNotesRequestSchema>) => {
        return notesClient.searchNotes(request);
    },

    /**
     * Get backlinks for a note.
     */
    getBacklinks: async (request: MessageInitShape<typeof GetBacklinksRequestSchema>) => {
        return notesClient.getBacklinks(request);
    },

    /**
     * Restore a deleted note.
     */
    restoreNote: async (request: MessageInitShape<typeof RestoreNoteRequestSchema>) => {
        return notesClient.restoreNote(request);
    },

    /**
     * Move note between spaces.
     */
    moveNote: async (request: MessageInitShape<typeof MoveNoteRequestSchema>) => {
        return notesClient.moveNote(request);
    },

    /**
     * Copy note to another space.
     */
    copyNote: async (request: MessageInitShape<typeof CopyNoteRequestSchema>) => {
        return notesClient.copyNote(request);
    },

    /**
     * Empty trash (permanently delete all soft-deleted notes).
     */
    emptyTrash: async (request: MessageInitShape<typeof EmptyTrashRequestSchema>) => {
        return notesClient.emptyTrash(request);
    },
};

