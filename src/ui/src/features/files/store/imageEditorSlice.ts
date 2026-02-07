/**
 * Image Editor Redux Slice
 *
 * Manages state for the image editor including:
 * - Edit mode toggle
 * - Transform state (rotation, flip)
 * - Adjustment state (brightness, contrast)
 * - Crop state
 * - Undo/redo history
 * - Save state
 */

import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

/**
 * A single history entry capturing the editor state at a point in time.
 */
export interface EditorHistoryEntry {
    rotation: number;
    flipH: boolean;
    flipV: boolean;
    brightness: number;
    contrast: number;
    cropRect: CropRect | null;
    isCropped: boolean;
}

/**
 * Crop rectangle coordinates and dimensions.
 */
export interface CropRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Image editor state shape.
 */
interface ImageEditorState {
    // Mode
    isEditing: boolean;

    // Original image data (blob URL or base64)
    originalImageUrl: string | null;

    // Transform state
    rotation: number; // 0, 90, 180, 270
    flipH: boolean;
    flipV: boolean;

    // Adjustments (-100 to 100)
    brightness: number;
    contrast: number;

    // Crop state
    cropActive: boolean;
    cropRect: CropRect | null;
    isCropped: boolean; // Whether crop has been applied

    // History (for undo/redo)
    history: EditorHistoryEntry[];
    historyIndex: number;

    // Save state
    isSaving: boolean;
    saveError: string | null;
    showSaveDialog: boolean;
}

const initialState: ImageEditorState = {
    isEditing: false,
    originalImageUrl: null,
    rotation: 0,
    flipH: false,
    flipV: false,
    brightness: 0,
    contrast: 0,
    cropActive: false,
    cropRect: null,
    isCropped: false,
    history: [],
    historyIndex: -1,
    isSaving: false,
    saveError: null,
    showSaveDialog: false,
};

/**
 * Max history entries to keep (for memory management).
 */
const MAX_HISTORY_SIZE = 20;

/**
 * Create a snapshot of current editor state for history.
 */
function createHistoryEntry(state: ImageEditorState): EditorHistoryEntry {
    return {
        rotation: state.rotation,
        flipH: state.flipH,
        flipV: state.flipV,
        brightness: state.brightness,
        contrast: state.contrast,
        cropRect: state.cropRect,
        isCropped: state.isCropped,
    };
}

/**
 * Push a new history entry, trimming if needed.
 */
function pushHistory(state: ImageEditorState) {
    // Remove any "future" history if we're in the middle of the stack
    const newHistory = state.history.slice(0, state.historyIndex + 1);

    // Add current state
    newHistory.push(createHistoryEntry(state));

    // Trim to max size
    if (newHistory.length > MAX_HISTORY_SIZE) {
        newHistory.shift();
    }

    state.history = newHistory;
    state.historyIndex = newHistory.length - 1;
}

export const imageEditorSlice = createSlice({
    name: 'imageEditor',
    initialState,
    reducers: {
        /**
         * Enter edit mode for an image.
         */
        enterEditMode: (state, action: PayloadAction<{ imageUrl: string }>) => {
            state.isEditing = true;
            state.originalImageUrl = action.payload.imageUrl;
            // Reset all editing state
            state.rotation = 0;
            state.flipH = false;
            state.flipV = false;
            state.brightness = 0;
            state.contrast = 0;
            state.cropActive = false;
            state.cropRect = null;
            state.isCropped = false;
            state.history = [];
            state.historyIndex = -1;
            state.isSaving = false;
            state.saveError = null;
            state.showSaveDialog = false;
            // Push initial state to history
            pushHistory(state);
        },

        /**
         * Exit edit mode without saving.
         */
        exitEditMode: (state) => {
            state.isEditing = false;
            state.originalImageUrl = null;
            state.rotation = 0;
            state.flipH = false;
            state.flipV = false;
            state.brightness = 0;
            state.contrast = 0;
            state.cropActive = false;
            state.cropRect = null;
            state.isCropped = false;
            state.history = [];
            state.historyIndex = -1;
            state.isSaving = false;
            state.saveError = null;
            state.showSaveDialog = false;
        },

        // ─────────────────────────────────────────────────────────────
        // Transform actions
        // ─────────────────────────────────────────────────────────────

        /**
         * Rotate image by 90 degrees clockwise.
         */
        rotateRight: (state) => {
            state.rotation = (state.rotation + 90) % 360;
            pushHistory(state);
        },

        /**
         * Rotate image by 90 degrees counter-clockwise.
         */
        rotateLeft: (state) => {
            state.rotation = (state.rotation - 90 + 360) % 360;
            pushHistory(state);
        },

        /**
         * Flip image horizontally.
         */
        toggleFlipH: (state) => {
            state.flipH = !state.flipH;
            pushHistory(state);
        },

        /**
         * Flip image vertically.
         */
        toggleFlipV: (state) => {
            state.flipV = !state.flipV;
            pushHistory(state);
        },

        // ─────────────────────────────────────────────────────────────
        // Adjustment actions
        // ─────────────────────────────────────────────────────────────

        /**
         * Set brightness value (-100 to 100).
         */
        setBrightness: (state, action: PayloadAction<number>) => {
            state.brightness = Math.max(-100, Math.min(100, action.payload));
        },

        /**
         * Commit brightness change to history.
         */
        commitBrightness: (state) => {
            pushHistory(state);
        },

        /**
         * Set contrast value (-100 to 100).
         */
        setContrast: (state, action: PayloadAction<number>) => {
            state.contrast = Math.max(-100, Math.min(100, action.payload));
        },

        /**
         * Commit contrast change to history.
         */
        commitContrast: (state) => {
            pushHistory(state);
        },

        // ─────────────────────────────────────────────────────────────
        // Crop actions
        // ─────────────────────────────────────────────────────────────

        /**
         * Toggle crop tool active state.
         */
        toggleCropTool: (state) => {
            state.cropActive = !state.cropActive;
            if (!state.cropActive) {
                // Reset crop rect when deactivating without applying
                state.cropRect = null;
            }
        },

        /**
         * Set crop tool active state.
         */
        setCropActive: (state, action: PayloadAction<boolean>) => {
            state.cropActive = action.payload;
            if (!action.payload) {
                state.cropRect = null;
            }
        },

        /**
         * Update crop rectangle (during drag).
         */
        setCropRect: (state, action: PayloadAction<CropRect | null>) => {
            state.cropRect = action.payload;
        },

        /**
         * Apply crop (mark as cropped and exit crop mode).
         */
        applyCrop: (state) => {
            if (state.cropRect) {
                state.isCropped = true;
                state.cropActive = false;
                pushHistory(state);
            }
        },

        /**
         * Cancel crop without applying.
         */
        cancelCrop: (state) => {
            state.cropActive = false;
            state.cropRect = null;
        },

        // ─────────────────────────────────────────────────────────────
        // History actions
        // ─────────────────────────────────────────────────────────────

        /**
         * Undo to previous state.
         */
        undo: (state) => {
            if (state.historyIndex > 0) {
                state.historyIndex -= 1;
                const entry = state.history[state.historyIndex];
                state.rotation = entry.rotation;
                state.flipH = entry.flipH;
                state.flipV = entry.flipV;
                state.brightness = entry.brightness;
                state.contrast = entry.contrast;
                state.cropRect = entry.cropRect;
                state.isCropped = entry.isCropped;
            }
        },

        /**
         * Redo to next state.
         */
        redo: (state) => {
            if (state.historyIndex < state.history.length - 1) {
                state.historyIndex += 1;
                const entry = state.history[state.historyIndex];
                state.rotation = entry.rotation;
                state.flipH = entry.flipH;
                state.flipV = entry.flipV;
                state.brightness = entry.brightness;
                state.contrast = entry.contrast;
                state.cropRect = entry.cropRect;
                state.isCropped = entry.isCropped;
            }
        },

        /**
         * Reset to original image (first history entry).
         */
        resetToOriginal: (state) => {
            if (state.history.length > 0) {
                const entry = state.history[0];
                state.rotation = entry.rotation;
                state.flipH = entry.flipH;
                state.flipV = entry.flipV;
                state.brightness = entry.brightness;
                state.contrast = entry.contrast;
                state.cropRect = entry.cropRect;
                state.isCropped = entry.isCropped;
                // Push reset as new history entry
                pushHistory(state);
            }
        },

        // ─────────────────────────────────────────────────────────────
        // Save actions
        // ─────────────────────────────────────────────────────────────

        /**
         * Show save dialog.
         */
        openSaveDialog: (state) => {
            state.showSaveDialog = true;
        },

        /**
         * Hide save dialog.
         */
        closeSaveDialog: (state) => {
            state.showSaveDialog = false;
        },

        /**
         * Start saving.
         */
        setSaving: (state, action: PayloadAction<boolean>) => {
            state.isSaving = action.payload;
            if (action.payload) {
                state.saveError = null;
            }
        },

        /**
         * Set save error.
         */
        setSaveError: (state, action: PayloadAction<string | null>) => {
            state.saveError = action.payload;
            state.isSaving = false;
        },
    },
});

export const {
    enterEditMode,
    exitEditMode,
    rotateRight,
    rotateLeft,
    toggleFlipH,
    toggleFlipV,
    setBrightness,
    commitBrightness,
    setContrast,
    commitContrast,
    toggleCropTool,
    setCropActive,
    setCropRect,
    applyCrop,
    cancelCrop,
    undo,
    redo,
    resetToOriginal,
    openSaveDialog,
    closeSaveDialog,
    setSaving,
    setSaveError,
} = imageEditorSlice.actions;

// Selectors
export const selectIsEditing = (state: { imageEditor: ImageEditorState }) =>
    state.imageEditor.isEditing;

export const selectCanUndo = (state: { imageEditor: ImageEditorState }) =>
    state.imageEditor.historyIndex > 0;

export const selectCanRedo = (state: { imageEditor: ImageEditorState }) =>
    state.imageEditor.historyIndex < state.imageEditor.history.length - 1;

export const selectHasChanges = (state: { imageEditor: ImageEditorState }) =>
    state.imageEditor.historyIndex > 0;

export const imageEditorReducer = imageEditorSlice.reducer;
