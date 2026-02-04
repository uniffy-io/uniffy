import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import { VisibilityScope } from '@/gen/notes/v1/notes_pb';
import {
    fetchNotes,
    fetchDeletedNotes,
    fetchNote,
    createNote,
    updateNote,
    updateNoteIcon,
    autosaveNote,
    deleteNote,
    restoreNote,
    searchNotes,
    moveNote,
    copyNote,
    initializeNotesData,
    type SerializedNote,
} from '@/features/notes/store/notesThunks';

// LocalStorage key for last opened note
const LAST_NOTE_STORAGE_KEY = 'uniffy-last-note';

export function loadLastOpenedNote(): string | null {
    try {
        return localStorage.getItem(LAST_NOTE_STORAGE_KEY);
    } catch {
        return null;
    }
}

function saveLastOpenedNote(noteId: string | null): void {
    try {
        if (noteId) {
            localStorage.setItem(LAST_NOTE_STORAGE_KEY, noteId);
        } else {
            localStorage.removeItem(LAST_NOTE_STORAGE_KEY);
        }
    } catch {
        // Ignore errors
    }
}

/**
 * Normalize a note to ensure all values are serializable for Redux.
 * The note is already serialized from the thunk, just return it.
 */
function normalizeNote(note: SerializedNote): SerializedNote {
    return note;
}

interface NotesState {
    // All notes indexed by ID
    notes: Record<string, SerializedNote>;

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
        setNotes: (state, action: PayloadAction<SerializedNote[]>) => {
            state.notes = {};
            action.payload.forEach((note) => {
                state.notes[note.id] = normalizeNote(note);
            });
        },

        // Add or update a single note
        setNote: (state, action: PayloadAction<SerializedNote>) => {
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
            // Only persist when opening a note, not when clearing
            if (action.payload) {
                saveLastOpenedNote(action.payload);
            }
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

        // Clear all notes (bookmarks are managed separately in bookmarks store)
        clearNotes: (state) => {
            state.notes = {};
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

        // updateNoteIcon
        builder
            .addCase(updateNoteIcon.pending, (state) => {
                state.savingNote = true;
            })
            .addCase(updateNoteIcon.fulfilled, (state, action) => {
                state.savingNote = false;
                state.notes[action.payload.id] = normalizeNote(action.payload);
            })
            .addCase(updateNoteIcon.rejected, (state, action) => {
                state.savingNote = false;
                state.error = action.payload ?? 'Failed to update note icon';
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
                    note.version = action.payload.version;
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

        // initializeNotesData - unified fetch for both flat store and tree
        builder
            .addCase(initializeNotesData.pending, (state, action) => {
                // Only show loading if not from cache (prevents flash)
                if (!action.meta.arg?.forceRefresh) {
                    const hasNotes = Object.keys(state.notes).length > 0;
                    if (!hasNotes) {
                        state.loading = true;
                    }
                } else {
                    state.loading = true;
                }
                state.error = null;
            })
            .addCase(initializeNotesData.fulfilled, (state, action) => {
                state.loading = false;
                // Add/update notes in the store
                action.payload.notes.forEach((note) => {
                    state.notes[note.id] = normalizeNote(note);
                });
                state.pagination = {
                    page: 1,
                    pageSize: action.payload.notes.length,
                    totalCount: action.payload.totalCount,
                    totalPages: 1,
                };
            })
            .addCase(initializeNotesData.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Failed to initialize notes';
            })
            // Handle background refresh (stale-while-revalidate pattern)
            .addMatcher(
                (action): action is PayloadAction<{ notes: ReturnType<typeof normalizeNote>[]; totalCount: number }> =>
                    action.type === 'notes/backgroundRefreshComplete',
                (state, action) => {
                    // Update notes silently (no loading state change)
                    action.payload.notes.forEach((note) => {
                        state.notes[note.id] = normalizeNote(note);
                    });
                    state.pagination.totalCount = action.payload.totalCount;
                }
            );
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
// Note: Bookmark functionality is now in the bookmarks feature
export {
    fetchNotes,
    fetchDeletedNotes,
    fetchNote,
    createNote,
    updateNote,
    autosaveNote,
    deleteNote,
    restoreNote,
    searchNotes,
    moveNote,
    copyNote,
    initializeNotesData,
} from '@/features/notes/store/notesThunks';
