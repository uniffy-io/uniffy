import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { Note } from '@/gen/notes/v1/notes_pb';
import type { PlainMessage } from '@bufbuild/protobuf';
import { VisibilityScope } from '@/gen/notes/v1/notes_pb';

interface NotesState {
    // All notes indexed by ID
    notes: Record<string, PlainMessage<Note>>;

    // Currently selected note ID
    currentNoteId: string | null;

    // Open tabs (for multi-note editing in future)
    openTabs: string[];

    // Active tab index
    activeTabIndex: number;

    // Loading states
    loading: boolean;
    loadingNoteId: string | null;

    // Error states
    error: string | null;

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
    };
}

const initialState: NotesState = {
    notes: {},
    currentNoteId: null,
    openTabs: [],
    activeTabIndex: 0,
    loading: false,
    loadingNoteId: null,
    error: null,
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
    },
};

export const notesSlice = createSlice({
    name: 'notes',
    initialState,
    reducers: {
        // Set all notes
        setNotes: (state, action: PayloadAction<PlainMessage<Note>[]>) => {
            state.notes = {};
            action.payload.forEach((note) => {
                state.notes[note.id] = note;
            });
        },

        // Add or update a single note
        setNote: (state, action: PayloadAction<PlainMessage<Note>>) => {
            state.notes[action.payload.id] = action.payload;
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
            state.currentNoteId = null;
            state.openTabs = [];
            state.activeTabIndex = 0;
        },
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
    setSearchQuery,
    setVisibilityFilter,
    setSortBy,
    setSortOrder,
    setShowDeleted,
    setPagination,
    clearNotes,
} = notesSlice.actions;

export default notesSlice.reducer;
