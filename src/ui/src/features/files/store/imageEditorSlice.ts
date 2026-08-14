import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";

export interface EditorHistoryEntry {
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  brightness: number;
  contrast: number;
  cropRect: CropRect | null;
  isCropped: boolean;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ImageEditorState {
  isEditing: boolean;

  originalImageUrl: string | null;

  /** 0, 90, 180, 270 */
  rotation: number;
  flipH: boolean;
  flipV: boolean;

  /** -100..100 */
  brightness: number;
  /** -100..100 */
  contrast: number;

  cropActive: boolean;
  cropRect: CropRect | null;
  isCropped: boolean;

  history: EditorHistoryEntry[];
  historyIndex: number;

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

const MAX_HISTORY_SIZE = 20;

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

function pushHistory(state: ImageEditorState) {
  // Discard any future-history past the current cursor before recording.
  const newHistory = state.history.slice(0, state.historyIndex + 1);

  newHistory.push(createHistoryEntry(state));

  if (newHistory.length > MAX_HISTORY_SIZE) {
    newHistory.shift();
  }

  state.history = newHistory;
  state.historyIndex = newHistory.length - 1;
}

export const imageEditorSlice = createSlice({
  name: "imageEditor",
  initialState,
  reducers: {
    enterEditMode: (
      state,
      action: PayloadAction<{ imageUrl: string; initialRotation?: number }>,
    ) => {
      state.isEditing = true;
      state.originalImageUrl = action.payload.imageUrl;
      state.rotation = action.payload.initialRotation || 0;
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
      pushHistory(state);
    },

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

    rotateRight: (state) => {
      state.rotation = (state.rotation + 90) % 360;
      pushHistory(state);
    },

    rotateLeft: (state) => {
      state.rotation = (state.rotation - 90 + 360) % 360;
      pushHistory(state);
    },

    toggleFlipH: (state) => {
      state.flipH = !state.flipH;
      pushHistory(state);
    },

    toggleFlipV: (state) => {
      state.flipV = !state.flipV;
      pushHistory(state);
    },

    setBrightness: (state, action: PayloadAction<number>) => {
      state.brightness = Math.max(-100, Math.min(100, action.payload));
    },

    commitBrightness: (state) => {
      pushHistory(state);
    },

    setContrast: (state, action: PayloadAction<number>) => {
      state.contrast = Math.max(-100, Math.min(100, action.payload));
    },

    commitContrast: (state) => {
      pushHistory(state);
    },

    toggleCropTool: (state) => {
      state.cropActive = !state.cropActive;
      if (!state.cropActive) {
        state.cropRect = null;
      }
    },

    setCropActive: (state, action: PayloadAction<boolean>) => {
      state.cropActive = action.payload;
      if (!action.payload) {
        state.cropRect = null;
      }
    },

    setCropRect: (state, action: PayloadAction<CropRect | null>) => {
      state.cropRect = action.payload;
    },

    applyCrop: (state) => {
      if (state.cropRect) {
        state.isCropped = true;
        state.cropActive = false;
        pushHistory(state);
      }
    },

    cancelCrop: (state) => {
      state.cropActive = false;
      state.cropRect = null;
    },

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
        pushHistory(state);
      }
    },

    openSaveDialog: (state) => {
      state.showSaveDialog = true;
    },

    closeSaveDialog: (state) => {
      state.showSaveDialog = false;
    },

    setSaving: (state, action: PayloadAction<boolean>) => {
      state.isSaving = action.payload;
      if (action.payload) {
        state.saveError = null;
      }
    },

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

export const selectIsEditing = (state: { imageEditor: ImageEditorState }) =>
  state.imageEditor.isEditing;

export const selectCanUndo = (state: { imageEditor: ImageEditorState }) =>
  state.imageEditor.historyIndex > 0;

export const selectCanRedo = (state: { imageEditor: ImageEditorState }) =>
  state.imageEditor.historyIndex < state.imageEditor.history.length - 1;

export const selectHasChanges = (state: { imageEditor: ImageEditorState }) =>
  state.imageEditor.historyIndex > 0;

export const imageEditorReducer = imageEditorSlice.reducer;
