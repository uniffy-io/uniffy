import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

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
        previewMode: 'split' | 'preview' | 'edit';
        fontSize: number;
        lineHeight: number;
    };

    // Right panel state
    isMetadataPanelOpen: boolean;
    metadataPanelWidth: number;
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
        previewMode: 'edit',
        fontSize: 16,
        lineHeight: 1.6,
    },
    isMetadataPanelOpen: false,
    metadataPanelWidth: 320,
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
        setPreviewMode: (state, action: PayloadAction<'split' | 'preview' | 'edit'>) => {
            state.settings.previewMode = action.payload;
        },

        setFontSize: (state, action: PayloadAction<number>) => {
            state.settings.fontSize = action.payload;
        },

        setLineHeight: (state, action: PayloadAction<number>) => {
            state.settings.lineHeight = action.payload;
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
    setPreviewMode,
    setFontSize,
    setLineHeight,
    toggleMetadataPanel,
    setMetadataPanelOpen,
    setMetadataPanelWidth,
} = editorSlice.actions;

export default editorSlice.reducer;
