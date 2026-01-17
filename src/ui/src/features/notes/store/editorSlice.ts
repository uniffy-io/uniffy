import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

// Editor modes:
// - 'crepe': Full WYSIWYG Crepe editor with all features (toolbar, slash commands, etc.)
// - 'markdown': Raw markdown editor with CodeMirror + optional split preview
// - 'readonly': Read-only view for published/shared notes
export type EditorMode = 'crepe' | 'markdown' | 'readonly';

// Metadata panel tabs
export type MetadataPanelTab = 'outline' | 'links' | 'properties' | 'ai' | 'history';

interface EditorState {
    // Editor content (draft state, not saved yet)
    draftContent: Record<string, string>;

    // Unsaved changes tracking
    hasUnsavedChanges: Record<string, boolean>;

    // Autosave status
    autosave: {
        lastSaved: Record<string, number>; // timestamp
        isSaving: Record<string, boolean>;
        error: Record<string, string | null>;
    };

    // Editor settings
    settings: {
        editorMode: EditorMode;
        showMarkdownPreview: boolean; // For markdown mode: show split preview
        fontSize: number;
        lineHeight: number;
        spellCheck: boolean;
    };

    // Left sidebar state
    isSidebarOpen: boolean;

    // Right panel state
    isMetadataPanelOpen: boolean;
    metadataPanelWidth: number;
    metadataPanelTab: MetadataPanelTab;

    // Note starred state (favorites)
    starredNotes: Record<string, boolean>;
}

const initialState: EditorState = {
    draftContent: {},
    hasUnsavedChanges: {},
    autosave: {
        lastSaved: {},
        isSaving: {},
        error: {},
    },
    settings: {
        editorMode: 'crepe',
        showMarkdownPreview: true,
        fontSize: 16,
        lineHeight: 1.6,
        spellCheck: true,
    },
    isSidebarOpen: true,
    isMetadataPanelOpen: false,
    metadataPanelWidth: 320,
    metadataPanelTab: 'outline',
    starredNotes: {},
};

export const editorSlice = createSlice({
    name: 'editor',
    initialState,
    reducers: {
        // Draft content
        setDraftContent: (state, action: PayloadAction<{ noteId: string; content: string }>) => {
            const { noteId, content } = action.payload;
            state.draftContent[noteId] = content;
            state.hasUnsavedChanges[noteId] = true;
        },

        clearDraftContent: (state, action: PayloadAction<string>) => {
            delete state.draftContent[action.payload];
            delete state.hasUnsavedChanges[action.payload];
        },

        // Unsaved changes
        markSaved: (state, action: PayloadAction<string>) => {
            state.hasUnsavedChanges[action.payload] = false;
        },

        markUnsaved: (state, action: PayloadAction<string>) => {
            state.hasUnsavedChanges[action.payload] = true;
        },

        // Autosave status
        setAutosaveLastSaved: (state, action: PayloadAction<{ noteId: string; timestamp: number }>) => {
            const { noteId, timestamp } = action.payload;
            state.autosave.lastSaved[noteId] = timestamp;
        },

        setAutosaveSaving: (state, action: PayloadAction<{ noteId: string; isSaving: boolean }>) => {
            const { noteId, isSaving } = action.payload;
            state.autosave.isSaving[noteId] = isSaving;
        },

        setAutosaveError: (state, action: PayloadAction<{ noteId: string; error: string | null }>) => {
            const { noteId, error } = action.payload;
            state.autosave.error[noteId] = error;
        },

        clearAutosaveState: (state, action: PayloadAction<string>) => {
            const noteId = action.payload;
            delete state.autosave.lastSaved[noteId];
            delete state.autosave.isSaving[noteId];
            delete state.autosave.error[noteId];
        },

        // Editor settings
        setEditorMode: (state, action: PayloadAction<EditorMode>) => {
            state.settings.editorMode = action.payload;
        },

        toggleMarkdownPreview: (state) => {
            state.settings.showMarkdownPreview = !state.settings.showMarkdownPreview;
        },

        setShowMarkdownPreview: (state, action: PayloadAction<boolean>) => {
            state.settings.showMarkdownPreview = action.payload;
        },

        setFontSize: (state, action: PayloadAction<number>) => {
            state.settings.fontSize = action.payload;
        },

        setLineHeight: (state, action: PayloadAction<number>) => {
            state.settings.lineHeight = action.payload;
        },

        setSpellCheck: (state, action: PayloadAction<boolean>) => {
            state.settings.spellCheck = action.payload;
        },

        // Sidebar
        toggleSidebar: (state) => {
            state.isSidebarOpen = !state.isSidebarOpen;
        },

        setSidebarOpen: (state, action: PayloadAction<boolean>) => {
            state.isSidebarOpen = action.payload;
        },

        // Metadata panel
        toggleMetadataPanel: (state) => {
            state.isMetadataPanelOpen = !state.isMetadataPanelOpen;
        },

        setMetadataPanelOpen: (state, action: PayloadAction<boolean>) => {
            state.isMetadataPanelOpen = action.payload;
        },

        setMetadataPanelWidth: (state, action: PayloadAction<number>) => {
            state.metadataPanelWidth = action.payload;
        },

        setMetadataPanelTab: (state, action: PayloadAction<MetadataPanelTab>) => {
            state.metadataPanelTab = action.payload;
        },

        // Starred notes
        toggleStarredNote: (state, action: PayloadAction<string>) => {
            state.starredNotes[action.payload] = !state.starredNotes[action.payload];
        },

        setStarredNote: (state, action: PayloadAction<{ noteId: string; starred: boolean }>) => {
            state.starredNotes[action.payload.noteId] = action.payload.starred;
        },
    },
});

export const {
    setDraftContent,
    clearDraftContent,
    markSaved,
    markUnsaved,
    setAutosaveLastSaved,
    setAutosaveSaving,
    setAutosaveError,
    clearAutosaveState,
    setEditorMode,
    toggleMarkdownPreview,
    setShowMarkdownPreview,
    setFontSize,
    setLineHeight,
    setSpellCheck,
    toggleSidebar,
    setSidebarOpen,
    toggleMetadataPanel,
    setMetadataPanelOpen,
    setMetadataPanelWidth,
    setMetadataPanelTab,
    toggleStarredNote,
    setStarredNote,
} = editorSlice.actions;

export default editorSlice.reducer;
