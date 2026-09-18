import { createSlice } from "@reduxjs/toolkit";
import type { PayloadAction } from "@reduxjs/toolkit";
import { removeFile } from "@/features/files/store/filesSlice";
import { fetchFile, restoreFileVersion } from "@/features/files/store/filesThunks";
import type { SerializedFile } from "@/features/files/store/filesThunks";

interface ViewerState {
  isOpen: boolean;
  isFullscreen: boolean;

  /** Cached so the viewer can open directly from search without the files domain loaded. */
  fileData: SerializedFile | null;

  currentFileId: string | null;
  playlist: string[];
  playlistIndex: number;

  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;

  /** zoom 1 = fit to screen. */
  zoom: number;
  panX: number;
  panY: number;
  rotation: number;

  currentPage: number;
  totalPages: number;
  pdfZoom: number;
  pdfRotation: number;
  pdfFitMode: PdfFitMode;
  /** Session preferences: survive file switches, unlike zoom/rotation/fit. */
  pdfSidebarOpen: boolean;
  pdfInvert: boolean;
  pdfSpread: boolean;
  /** Resets per openViewer but survives nextFile so a folder of decks stays a slideshow. */
  pdfPresentation: boolean;
  /** Page requested by a `?page=` deep link; applies to the opened file only. */
  pdfInitialPage: number | null;
  pdfDocumentInfo: PdfDocumentInfo | null;

  /** Pending watermark; bakes into a saved copy via pdf-lib. */
  pdfWatermark: PdfWatermark | null;

  loading: boolean;
  error: string | null;
}

export interface PdfWatermark {
  text: string;
  /** 0..1 */
  opacity: number;
}

/** `auto` is the opening default: fit-width scaled down for comfortable margins. */
export type PdfFitMode = "auto" | "width" | "page" | "custom";

export interface PdfDocumentInfo {
  title?: string;
  author?: string;
  createdAt?: string;
  producer?: string;
  formatVersion?: string;
}

const initialState: ViewerState = {
  isOpen: false,
  isFullscreen: false,
  fileData: null,
  currentFileId: null,
  playlist: [],
  playlistIndex: 0,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  volume: 1,
  isMuted: false,
  zoom: 1,
  panX: 0,
  panY: 0,
  rotation: 0,
  currentPage: 1,
  totalPages: 0,
  pdfZoom: 1,
  pdfRotation: 0,
  pdfFitMode: "auto",
  pdfSidebarOpen: true,
  pdfInvert: false,
  pdfSpread: false,
  pdfPresentation: false,
  pdfInitialPage: null,
  pdfDocumentInfo: null,
  pdfWatermark: null,
  loading: false,
  error: null,
};

export const viewerSlice = createSlice({
  name: "fileViewer",
  initialState,
  reducers: {
    openViewer: (
      state,
      action: PayloadAction<{
        fileId: string;
        playlist?: string[];
        fileData?: SerializedFile;
        initialPage?: number;
      }>,
    ) => {
      const { fileId, playlist = [], fileData, initialPage } = action.payload;
      state.isOpen = true;
      state.currentFileId = fileId;
      state.playlist = playlist;
      state.playlistIndex = playlist.length > 0 ? playlist.indexOf(fileId) : 0;
      state.fileData = fileData ?? null;
      state.loading = !fileData;
      state.error = null;
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      state.rotation = 0;
      state.currentPage = 1;
      state.totalPages = 0;
      state.pdfZoom = 1;
      state.pdfRotation = 0;
      state.pdfFitMode = "auto";
      state.pdfPresentation = false;
      state.pdfInitialPage = initialPage && initialPage > 0 ? initialPage : null;
      state.pdfDocumentInfo = null;
      state.pdfWatermark = null;
      state.isPlaying = false;
      state.currentTime = 0;
    },

    setFileData: (state, action: PayloadAction<SerializedFile>) => {
      state.fileData = action.payload;
      state.loading = false;
    },

    /** Only flips `isOpen`; file data is kept until the next openViewer overwrites it so the Dialog leave-transition can run. */
    closeViewer: (state) => {
      state.isOpen = false;
      state.isFullscreen = false;
    },

    nextFile: (state) => {
      if (state.playlistIndex < state.playlist.length - 1) {
        state.playlistIndex += 1;
        state.currentFileId = state.playlist[state.playlistIndex];
        state.loading = true;
        state.zoom = 1;
        state.panX = 0;
        state.panY = 0;
        state.rotation = 0;
        state.currentPage = 1;
        state.totalPages = 0;
        state.pdfZoom = 1;
        state.pdfRotation = 0;
        state.pdfFitMode = "auto";
        state.pdfInitialPage = null;
        state.pdfDocumentInfo = null;
        state.pdfWatermark = null;
        state.isPlaying = false;
        state.currentTime = 0;
      }
    },

    previousFile: (state) => {
      if (state.playlistIndex > 0) {
        state.playlistIndex -= 1;
        state.currentFileId = state.playlist[state.playlistIndex];
        state.loading = true;
        state.zoom = 1;
        state.panX = 0;
        state.panY = 0;
        state.rotation = 0;
        state.currentPage = 1;
        state.totalPages = 0;
        state.pdfZoom = 1;
        state.pdfRotation = 0;
        state.pdfFitMode = "auto";
        state.pdfInitialPage = null;
        state.pdfDocumentInfo = null;
        state.pdfWatermark = null;
        state.isPlaying = false;
        state.currentTime = 0;
      }
    },

    toggleFullscreen: (state) => {
      state.isFullscreen = !state.isFullscreen;
    },

    setFullscreen: (state, action: PayloadAction<boolean>) => {
      state.isFullscreen = action.payload;
    },

    setPlaying: (state, action: PayloadAction<boolean>) => {
      state.isPlaying = action.payload;
    },

    togglePlay: (state) => {
      state.isPlaying = !state.isPlaying;
    },

    setCurrentTime: (state, action: PayloadAction<number>) => {
      state.currentTime = action.payload;
    },

    setDuration: (state, action: PayloadAction<number>) => {
      state.duration = action.payload;
    },

    setVolume: (state, action: PayloadAction<number>) => {
      state.volume = Math.max(0, Math.min(1, action.payload));
    },

    setMuted: (state, action: PayloadAction<boolean>) => {
      state.isMuted = action.payload;
    },

    toggleMute: (state) => {
      state.isMuted = !state.isMuted;
    },

    setZoom: (state, action: PayloadAction<number>) => {
      state.zoom = Math.max(0.1, Math.min(10, action.payload));
    },

    setPan: (state, action: PayloadAction<{ x: number; y: number }>) => {
      state.panX = action.payload.x;
      state.panY = action.payload.y;
    },

    setRotation: (state, action: PayloadAction<number>) => {
      state.rotation = action.payload % 360;
    },

    resetImageView: (state) => {
      state.zoom = 1;
      state.panX = 0;
      state.panY = 0;
      state.rotation = 0;
    },

    setPage: (state, action: PayloadAction<number>) => {
      const page = action.payload;
      if (page >= 1 && page <= state.totalPages) {
        state.currentPage = page;
      }
    },

    setTotalPages: (state, action: PayloadAction<number>) => {
      state.totalPages = action.payload;
    },

    setPdfZoom: (state, action: PayloadAction<number>) => {
      state.pdfZoom = Math.max(0.25, Math.min(4, action.payload));
    },

    setPdfRotation: (state, action: PayloadAction<number>) => {
      state.pdfRotation = action.payload % 360;
    },

    setPdfFitMode: (state, action: PayloadAction<PdfFitMode>) => {
      state.pdfFitMode = action.payload;
    },

    togglePdfSidebar: (state) => {
      state.pdfSidebarOpen = !state.pdfSidebarOpen;
    },

    setPdfSidebarOpen: (state, action: PayloadAction<boolean>) => {
      state.pdfSidebarOpen = action.payload;
    },

    togglePdfInvert: (state) => {
      state.pdfInvert = !state.pdfInvert;
    },

    togglePdfSpread: (state) => {
      state.pdfSpread = !state.pdfSpread;
    },

    togglePdfPresentation: (state) => {
      state.pdfPresentation = !state.pdfPresentation;
    },

    setPdfPresentation: (state, action: PayloadAction<boolean>) => {
      state.pdfPresentation = action.payload;
    },

    setPdfDocumentInfo: (state, action: PayloadAction<PdfDocumentInfo | null>) => {
      state.pdfDocumentInfo = action.payload;
    },

    setPdfWatermark: (state, action: PayloadAction<PdfWatermark | null>) => {
      state.pdfWatermark = action.payload;
    },

    setLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },

    setError: (state, action: PayloadAction<string | null>) => {
      state.error = action.payload;
      state.loading = false;
    },
  },
  extraReducers: (builder) => {
    // The viewer-owned snapshot wins over the files store, so single-file
    // refetches and restores must sync it or the open viewer goes stale.
    builder
      .addCase(fetchFile.fulfilled, (state, action) => {
        if (state.currentFileId === action.payload.id && state.fileData) {
          state.fileData = action.payload;
        }
      })
      .addCase(restoreFileVersion.fulfilled, (state, action) => {
        if (state.currentFileId === action.payload.id && state.fileData) {
          state.fileData = action.payload;
        }
      })
      // An access revocation removes the row; a viewer left open on it would
      // keep showing content the user can no longer read.
      .addCase(removeFile, (state, action) => {
        state.playlist = state.playlist.filter((id) => id !== action.payload);
        state.playlistIndex = state.currentFileId ? state.playlist.indexOf(state.currentFileId) : 0;
        if (state.currentFileId === action.payload) {
          state.isOpen = false;
          state.isFullscreen = false;
          state.fileData = null;
          state.currentFileId = null;
          state.isPlaying = false;
        }
      });
  },
});

export const {
  openViewer,
  closeViewer,
  setFileData,
  nextFile,
  previousFile,
  toggleFullscreen,
  setFullscreen,
  setPlaying,
  togglePlay,
  setCurrentTime,
  setDuration,
  setVolume,
  setMuted,
  toggleMute,
  setZoom,
  setPan,
  setRotation,
  resetImageView,
  setPage,
  setTotalPages,
  setPdfZoom,
  setPdfRotation,
  setPdfFitMode,
  togglePdfSidebar,
  setPdfSidebarOpen,
  togglePdfInvert,
  togglePdfSpread,
  togglePdfPresentation,
  setPdfPresentation,
  setPdfDocumentInfo,
  setPdfWatermark,
  setLoading,
  setError,
} = viewerSlice.actions;

export const setViewerLoading = setLoading;
export const setViewerError = setError;

export const viewerReducer = viewerSlice.reducer;
