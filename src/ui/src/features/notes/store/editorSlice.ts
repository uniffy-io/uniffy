import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

// Editor modes:
// - 'crepe': Full WYSIWYG Crepe editor with all features (toolbar, slash commands, etc.)
// - 'markdown': Raw markdown editor with CodeMirror + optional split preview
// - 'readonly': Read-only view for published/shared notes
export type EditorMode = 'crepe' | 'markdown' | 'readonly';

// Metadata panel tabs
export type MetadataPanelTab = 'outline' | 'links' | 'properties' | 'history' | 'comments';

// Visibility of remote collaborator cursors on canvases.
// - 'auto': show when peer count <= AUTO_CURSORS_HIDE_THRESHOLD, hide above.
// - 'on':   always render regardless of peer count.
// - 'off':  never render.
export type CanvasCursorsMode = 'auto' | 'on' | 'off';

/** Peer count above which the canvas suppresses collaborator
 * cursors by default to avoid an arrow swarm. */
export const AUTO_CURSORS_HIDE_THRESHOLD = 10;

interface EditorState {
    settings: {
        editorMode: EditorMode;
        showMarkdownPreview: boolean;
        showMarkdownLineNumbers: boolean;
        fontSize: number;
        lineHeight: number;
        spellCheck: boolean;
        toolbarPinned: boolean;
        titleAlignment: 'left' | 'center';
        // User toggle to hide the canvas note's title metadata block
        // entirely so the canvas surface keeps maximum vertical room.
        canvasTitleHidden: boolean;
        canvasCursorsMode: CanvasCursorsMode;
    };

    isSidebarOpen: boolean;

    isMetadataPanelOpen: boolean;
    metadataPanelWidth: number;
    metadataPanelTab: MetadataPanelTab;
}

const initialState: EditorState = {
    settings: {
        editorMode: 'crepe',
        showMarkdownPreview: true,
        showMarkdownLineNumbers: true,
        fontSize: 16,
        lineHeight: 1.6,
        spellCheck: true,
        toolbarPinned: true,
        titleAlignment: 'left',
        canvasTitleHidden: false,
        canvasCursorsMode: 'auto',
    },
    isSidebarOpen: true,
    isMetadataPanelOpen: false,
    metadataPanelWidth: 320,
    metadataPanelTab: 'outline',
};

export const editorSlice = createSlice({
    name: 'editor',
    initialState,
    reducers: {
        setEditorMode: (state, action: PayloadAction<EditorMode>) => {
            state.settings.editorMode = action.payload;
        },

        toggleMarkdownPreview: (state) => {
            state.settings.showMarkdownPreview = !state.settings.showMarkdownPreview;
        },

        setShowMarkdownPreview: (state, action: PayloadAction<boolean>) => {
            state.settings.showMarkdownPreview = action.payload;
        },

        toggleMarkdownLineNumbers: (state) => {
            state.settings.showMarkdownLineNumbers = !state.settings.showMarkdownLineNumbers;
        },

        setShowMarkdownLineNumbers: (state, action: PayloadAction<boolean>) => {
            state.settings.showMarkdownLineNumbers = action.payload;
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

        toggleToolbarPin: (state) => {
            state.settings.toolbarPinned = !state.settings.toolbarPinned;
        },

        setToolbarPinned: (state, action: PayloadAction<boolean>) => {
            state.settings.toolbarPinned = action.payload;
        },

        setTitleAlignment: (state, action: PayloadAction<'left' | 'center'>) => {
            state.settings.titleAlignment = action.payload;
        },

        toggleCanvasTitleHidden: (state) => {
            state.settings.canvasTitleHidden = !state.settings.canvasTitleHidden;
        },

        setCanvasCursorsMode: (state, action: PayloadAction<CanvasCursorsMode>) => {
            state.settings.canvasCursorsMode = action.payload;
        },

        toggleSidebar: (state) => {
            state.isSidebarOpen = !state.isSidebarOpen;
        },

        setSidebarOpen: (state, action: PayloadAction<boolean>) => {
            state.isSidebarOpen = action.payload;
        },

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
    },
});

export const {
    setEditorMode,
    toggleMarkdownPreview,
    setShowMarkdownPreview,
    toggleMarkdownLineNumbers,
    setShowMarkdownLineNumbers,
    setFontSize,
    setLineHeight,
    setSpellCheck,
    toggleToolbarPin,
    setToolbarPinned,
    setTitleAlignment,
    toggleCanvasTitleHidden,
    setCanvasCursorsMode,
    toggleSidebar,
    setSidebarOpen,
    toggleMetadataPanel,
    setMetadataPanelOpen,
    setMetadataPanelWidth,
    setMetadataPanelTab,
} = editorSlice.actions;

export const editorReducer = editorSlice.reducer;
