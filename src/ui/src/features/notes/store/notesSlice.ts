import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { Note } from '@/gen/notes/v1/notes_pb';
import type { PlainMessage } from '@bufbuild/protobuf';
import { VisibilityScope } from '@/gen/notes/v1/notes_pb';
import {
    fetchNotes,
    fetchPinnedNotes,
    fetchDeletedNotes,
    fetchNote,
    createNote,
    updateNote,
    autosaveNote,
    deleteNote,
    restoreNote,
    togglePinNote,
    searchNotes,
    moveNote,
    copyNote,
} from './notesThunks';

/**
 * Normalize a note to ensure all values are serializable for Redux.
 * Converts BigInt values to numbers.
 */
function normalizeNote(note: PlainMessage<Note>): PlainMessage<Note> {
    return {
        ...note,
        version: (typeof note.version === 'bigint' ? Number(note.version) : note.version) as any,
    } as PlainMessage<Note>;
}

interface NotesState {
    // All notes indexed by ID
    notes: Record<string, PlainMessage<Note>>;

    // Pinned notes IDs (for quick access)
    pinnedNoteIds: string[];

    // Deleted notes IDs (trash)
    deletedNoteIds: string[];

    // Currently selected note ID
    currentNoteId: string | null;

    // Open tabs (for multi-note editing in future)
    openTabs: string[];

    // Active tab index
    activeTabIndex: number;

    // Loading states
    loading: boolean;
    loadingNoteId: string | null;
    creatingNote: boolean;
    savingNote: boolean;

    // Error states
    error: string | null;

    // Search state
    searchResults: string[];
    searchLoading: boolean;

    // Filters
    filters: {
        searchQuery: string;
        visibility: VisibilityScope | 'all';
        sortBy: 'title' | 'updated' | 'created';
        sortOrder: 'asc' | 'desc';
        showDeleted: boolean;
    };

    // Pagination
    pagination: {
        page: number;
        pageSize: number;
        totalCount: number;
        totalPages: number;
    };

    // Backlinks cache
    backlinks: Record<string, Array<{ id: string; title: string; slug: string }>>;
}

const initialState: NotesState = {
    notes: {},
    pinnedNoteIds: [],
    deletedNoteIds: [],
    currentNoteId: null,
    openTabs: [],
    activeTabIndex: 0,
    loading: false,
    loadingNoteId: null,
    creatingNote: false,
    savingNote: false,
    error: null,
    searchResults: [],
    searchLoading: false,
    filters: {
        searchQuery: '',
        visibility: 'all',
        sortBy: 'updated',
        sortOrder: 'desc',
        showDeleted: false,
    },
    pagination: {
        page: 1,
        pageSize: 100,
        totalCount: 0,
        totalPages: 0,
    },
    backlinks: {},
};

export const notesSlice = createSlice({
    name: 'notes',
    initialState,
    reducers: {
        // Set all notes
        setNotes: (state, action: PayloadAction<PlainMessage<Note>[]>) => {
            state.notes = {};
            action.payload.forEach((note) => {
                state.notes[note.id] = normalizeNote(note);
            });
        },

        // Add or update a single note
        setNote: (state, action: PayloadAction<PlainMessage<Note>>) => {
            state.notes[action.payload.id] = normalizeNote(action.payload);
        },

        // Remove a note
        removeNote: (state, action: PayloadAction<string>) => {
            delete state.notes[action.payload];
            if (state.currentNoteId === action.payload) {
                state.currentNoteId = null;
            }
            state.openTabs = state.openTabs.filter(id => id !== action.payload);
        },

        // Set current note
        setCurrentNote: (state, action: PayloadAction<string | null>) => {
            state.currentNoteId = action.payload;
        },

        // Tab management
        addTab: (state, action: PayloadAction<string>) => {
            if (!state.openTabs.includes(action.payload)) {
                state.openTabs.push(action.payload);
            }
            state.activeTabIndex = state.openTabs.indexOf(action.payload);
        },

        removeTab: (state, action: PayloadAction<string>) => {
            const index = state.openTabs.indexOf(action.payload);
            if (index !== -1) {
                state.openTabs.splice(index, 1);
                if (state.activeTabIndex >= state.openTabs.length) {
                    state.activeTabIndex = Math.max(0, state.openTabs.length - 1);
                }
            }
        },

        setActiveTab: (state, action: PayloadAction<number>) => {
            state.activeTabIndex = action.payload;
        },

        // Loading states
        setLoading: (state, action: PayloadAction<boolean>) => {
            state.loading = action.payload;
        },

        setLoadingNoteId: (state, action: PayloadAction<string | null>) => {
            state.loadingNoteId = action.payload;
        },

        // Error state
        setError: (state, action: PayloadAction<string | null>) => {
            state.error = action.payload;
        },

        // Filters
        setSearchQuery: (state, action: PayloadAction<string>) => {
            state.filters.searchQuery = action.payload;
        },

        setVisibilityFilter: (state, action: PayloadAction<VisibilityScope | 'all'>) => {
            state.filters.visibility = action.payload;
        },

        setSortBy: (state, action: PayloadAction<'title' | 'updated' | 'created'>) => {
            state.filters.sortBy = action.payload;
        },

        setSortOrder: (state, action: PayloadAction<'asc' | 'desc'>) => {
            state.filters.sortOrder = action.payload;
        },

        setShowDeleted: (state, action: PayloadAction<boolean>) => {
            state.filters.showDeleted = action.payload;
        },

        // Pagination
        setPagination: (state, action: PayloadAction<Partial<NotesState['pagination']>>) => {
            state.pagination = { ...state.pagination, ...action.payload };
        },

        // Clear all notes
        clearNotes: (state) => {
            state.notes = {};
            state.pinnedNoteIds = [];
            state.deletedNoteIds = [];
            state.currentNoteId = null;
            state.openTabs = [];
            state.activeTabIndex = 0;
            state.searchResults = [];
            state.backlinks = {};
        },

        // Clear error
        clearError: (state) => {
            state.error = null;
        },
    },
    extraReducers: (builder) => {
        // fetchNotes
        builder
            .addCase(fetchNotes.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchNotes.fulfilled, (state, action) => {
                state.loading = false;
                // Add/update notes in the store
                action.payload.notes.forEach((note) => {
                    state.notes[note.id] = normalizeNote(note);
                });
                state.pagination = {
                    page: action.payload.page,
                    pageSize: action.payload.pageSize,
                    totalCount: action.payload.totalCount,
                    totalPages: action.payload.totalPages,
                };
            })
            .addCase(fetchNotes.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Failed to fetch notes';
            });

        // fetchPinnedNotes
        builder
            .addCase(fetchPinnedNotes.fulfilled, (state, action) => {
                state.pinnedNoteIds = action.payload.map(n => n.id);
                action.payload.forEach((note) => {
                    state.notes[note.id] = normalizeNote(note);
                });
            });

        // fetchDeletedNotes
        builder
            .addCase(fetchDeletedNotes.fulfilled, (state, action) => {
                state.deletedNoteIds = action.payload.map(n => n.id);
                action.payload.forEach((note) => {
                    state.notes[note.id] = normalizeNote(note);
                });
            });

        // fetchNote
        builder
            .addCase(fetchNote.pending, (state, action) => {
                state.loadingNoteId = action.meta.arg;
            })
            .addCase(fetchNote.fulfilled, (state, action) => {
                state.loadingNoteId = null;
                state.notes[action.payload.id] = normalizeNote(action.payload);
            })
            .addCase(fetchNote.rejected, (state, action) => {
                state.loadingNoteId = null;
                state.error = action.payload ?? 'Failed to fetch note';
            });

        // createNote
        builder
            .addCase(createNote.pending, (state) => {
                state.creatingNote = true;
                state.error = null;
            })
            .addCase(createNote.fulfilled, (state, action) => {
                state.creatingNote = false;
                state.notes[action.payload.id] = normalizeNote(action.payload);
                state.currentNoteId = action.payload.id;
            })
            .addCase(createNote.rejected, (state, action) => {
                state.creatingNote = false;
                state.error = action.payload ?? 'Failed to create note';
            });

        // updateNote
        builder
            .addCase(updateNote.pending, (state) => {
                state.savingNote = true;
            })
            .addCase(updateNote.fulfilled, (state, action) => {
                state.savingNote = false;
                state.notes[action.payload.id] = normalizeNote(action.payload);
            })
            .addCase(updateNote.rejected, (state, action) => {
                state.savingNote = false;
                state.error = action.payload ?? 'Failed to update note';
            });

        // autosaveNote
        builder
            .addCase(autosaveNote.pending, (state) => {
                state.savingNote = true;
            })
            .addCase(autosaveNote.fulfilled, (state, action) => {
                state.savingNote = false;
                // Update version in the note if it exists
                const note = state.notes[action.payload.noteId];
                if (note) {
                    note.version = typeof action.payload.version === 'bigint'
                        ? Number(action.payload.version)
                        : action.payload.version;
                }
            })
            .addCase(autosaveNote.rejected, (state, action) => {
                state.savingNote = false;
                state.error = action.payload ?? 'Autosave failed';
            });

        // deleteNote
        builder
            .addCase(deleteNote.fulfilled, (state, action) => {
                const { noteId, permanent } = action.payload;
                if (permanent) {
                    delete state.notes[noteId];
                } else {
                    // Soft delete: mark as deleted
                    const note = state.notes[noteId];
                    if (note) {
                        note.isDeleted = true;
                        state.deletedNoteIds.push(noteId);
                    }
                }
                // Clear current note if deleted
                if (state.currentNoteId === noteId) {
                    state.currentNoteId = null;
                }
                state.openTabs = state.openTabs.filter(id => id !== noteId);
            });

        // restoreNote
        builder
            .addCase(restoreNote.fulfilled, (state, action) => {
                state.notes[action.payload.id] = normalizeNote(action.payload);
                state.deletedNoteIds = state.deletedNoteIds.filter(id => id !== action.payload.id);
            });

        // togglePinNote
        builder
            .addCase(togglePinNote.fulfilled, (state, action) => {
                state.notes[action.payload.id] = normalizeNote(action.payload);
                if (action.payload.isPinned) {
                    if (!state.pinnedNoteIds.includes(action.payload.id)) {
                        state.pinnedNoteIds.push(action.payload.id);
                    }
                } else {
                    state.pinnedNoteIds = state.pinnedNoteIds.filter(id => id !== action.payload.id);
                }
            });

        // searchNotes
        builder
            .addCase(searchNotes.pending, (state) => {
                state.searchLoading = true;
            })
            .addCase(searchNotes.fulfilled, (state, action) => {
                state.searchLoading = false;
                state.searchResults = action.payload.notes.map(n => n.id);
                action.payload.notes.forEach((note) => {
                    state.notes[note.id] = normalizeNote(note);
                });
            })
            .addCase(searchNotes.rejected, (state) => {
                state.searchLoading = false;
                state.searchResults = [];
            });

        // moveNote
        builder
            .addCase(moveNote.fulfilled, (state, action) => {
                state.notes[action.payload.id] = normalizeNote(action.payload);
            });

        // copyNote
        builder
            .addCase(copyNote.fulfilled, (state, action) => {
                state.notes[action.payload.id] = normalizeNote(action.payload);
            });
    },
});

export const {
    setNotes,
    setNote,
    removeNote,
    setCurrentNote,
    addTab,
    removeTab,
    setActiveTab,
    setLoading,
    setLoadingNoteId,
    setError,
    clearError,
    setSearchQuery,
    setVisibilityFilter,
    setSortBy,
    setSortOrder,
    setShowDeleted,
    setPagination,
    clearNotes,
} = notesSlice.actions;

export default notesSlice.reducer;

// Re-export thunks for convenience
export {
    fetchNotes,
    fetchPinnedNotes,
    fetchDeletedNotes,
    fetchNote,
    createNote,
    updateNote,
    autosaveNote,
    deleteNote,
    restoreNote,
    togglePinNote,
    searchNotes,
    moveNote,
    copyNote,
} from './notesThunks';
