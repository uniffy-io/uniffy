import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import {
    fetchNotes,
    fetchDeletedNotes,
    fetchNote,
    createNote,
    updateNote,
    updateNoteIcon,
    deleteNote,
    restoreNote,
    searchNotes,
    moveNote,
    copyNote,
    initializeNotesData,
    type SerializedNote,
} from '@/features/notes/store/notesThunks';
import { setContentAccessMode } from '@/features/permissions/store/permissionsThunks';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';

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

function normalizeNote(note: SerializedNote): SerializedNote {
    return note;
}

/** Preserve existing `content` when incoming note was fetched with `excludeContent: true`. */
function mergeNote(existing: SerializedNote | undefined, incoming: SerializedNote): SerializedNote {
    if (!existing || incoming.content) {
        return normalizeNote(incoming);
    }
    return normalizeNote({ ...incoming, content: existing.content });
}

interface NotesState {
    notes: Record<string, SerializedNote>;
    deletedNoteIds: string[];
    currentNoteId: string | null;
    openTabs: string[];
    activeTabIndex: number;
    loading: boolean;
    loadingNoteId: string | null;
    creatingNote: boolean;
    savingNote: boolean;
    error: string | null;
    searchResults: string[];
    searchLoading: boolean;
    filters: {
        searchQuery: string;
        sortBy: 'title' | 'updated' | 'created';
        sortOrder: 'asc' | 'desc';
        showDeleted: boolean;
    };
    pagination: {
        page: number;
        pageSize: number;
        totalCount: number;
        totalPages: number;
    };
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
        setNotes: (state, action: PayloadAction<SerializedNote[]>) => {
            state.notes = {};
            action.payload.forEach((note) => {
                state.notes[note.id] = normalizeNote(note);
            });
        },

        setNote: (state, action: PayloadAction<SerializedNote>) => {
            state.notes[action.payload.id] = normalizeNote(action.payload);
        },

        removeNote: (state, action: PayloadAction<string>) => {
            delete state.notes[action.payload];
            if (state.currentNoteId === action.payload) {
                state.currentNoteId = null;
            }
            state.openTabs = state.openTabs.filter(id => id !== action.payload);
        },

        setCurrentNote: (state, action: PayloadAction<string | null>) => {
            state.currentNoteId = action.payload;
            if (action.payload) {
                saveLastOpenedNote(action.payload);
            }
        },

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

        setLoading: (state, action: PayloadAction<boolean>) => {
            state.loading = action.payload;
        },

        setLoadingNoteId: (state, action: PayloadAction<string | null>) => {
            state.loadingNoteId = action.payload;
        },

        setError: (state, action: PayloadAction<string | null>) => {
            state.error = action.payload;
        },

        setSearchQuery: (state, action: PayloadAction<string>) => {
            state.filters.searchQuery = action.payload;
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

        setPagination: (state, action: PayloadAction<Partial<NotesState['pagination']>>) => {
            state.pagination = { ...state.pagination, ...action.payload };
        },

        clearNotes: (state) => {
            state.notes = {};
            state.deletedNoteIds = [];
            state.currentNoteId = null;
            state.openTabs = [];
            state.activeTabIndex = 0;
            state.searchResults = [];
            state.backlinks = {};
        },

        clearError: (state) => {
            state.error = null;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchNotes.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchNotes.fulfilled, (state, action) => {
                state.loading = false;
                action.payload.notes.forEach((note) => {
                    state.notes[note.id] = mergeNote(state.notes[note.id], note);
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

        builder
            .addCase(fetchDeletedNotes.fulfilled, (state, action) => {
                state.deletedNoteIds = action.payload.map(n => n.id);
                action.payload.forEach((note) => {
                    state.notes[note.id] = normalizeNote(note);
                });
            });

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

        builder
            .addCase(deleteNote.fulfilled, (state, action) => {
                const { noteId, permanent } = action.payload;
                if (permanent) {
                    delete state.notes[noteId];
                } else {
                    const note = state.notes[noteId];
                    if (note) {
                        note.isDeleted = true;
                        state.deletedNoteIds.push(noteId);
                    }
                }
                if (state.currentNoteId === noteId) {
                    state.currentNoteId = null;
                }
                state.openTabs = state.openTabs.filter(id => id !== noteId);
            });

        builder
            .addCase(restoreNote.fulfilled, (state, action) => {
                state.notes[action.payload.id] = normalizeNote(action.payload);
                state.deletedNoteIds = state.deletedNoteIds.filter(id => id !== action.payload.id);
            });

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

        builder
            .addCase(moveNote.fulfilled, (state, action) => {
                state.notes[action.payload.id] = normalizeNote(action.payload);
            });

        // Keep the in-memory note row in sync with new policy so accessMode-driven UI updates without refetch.
        builder
            .addCase(setContentAccessMode.fulfilled, (state, action) => {
                if (action.meta.arg.contentType !== ContentType.NOTE) return;
                const note = state.notes[action.meta.arg.contentId];
                if (!note) return;
                note.accessMode = action.payload.policy.accessMode;
                note.baselineRole = action.payload.policy.baselineRole;
            });

        builder
            .addCase(copyNote.fulfilled, (state, action) => {
                state.notes[action.payload.id] = normalizeNote(action.payload);
            });

        builder
            .addCase(initializeNotesData.pending, (state, action) => {
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
                action.payload.notes.forEach((note) => {
                    state.notes[note.id] = mergeNote(state.notes[note.id], note);
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
            // Stale-while-revalidate background refresh.
            .addMatcher(
                (action): action is PayloadAction<{ notes: ReturnType<typeof normalizeNote>[]; totalCount: number }> =>
                    action.type === 'notes/backgroundRefreshComplete',
                (state, action) => {
                    action.payload.notes.forEach((note) => {
                        state.notes[note.id] = mergeNote(state.notes[note.id], note);
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
    setSortBy,
    setSortOrder,
    setShowDeleted,
    setPagination,
    clearNotes,
} = notesSlice.actions;

export const notesReducer = notesSlice.reducer;

export {
    fetchNotes,
    fetchDeletedNotes,
    fetchNote,
    createNote,
    updateNote,
    deleteNote,
    restoreNote,
    searchNotes,
    moveNote,
    copyNote,
    initializeNotesData,
} from '@/features/notes/store/notesThunks';
