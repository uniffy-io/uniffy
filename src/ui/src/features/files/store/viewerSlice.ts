/**
 * File Viewer Redux Slice
 *
 * Manages state for the file viewer modal including:
 * - Modal open/close state
 * - Playlist navigation (prev/next file)
 * - Media playback state (play, pause, time, volume)
 * - Image viewer state (zoom, pan, rotation)
 * - PDF viewer state (current page, zoom)
 */

import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

interface ViewerState {
    // Modal state
    isOpen: boolean;
    isFullscreen: boolean;

    // Playlist state
    currentFileId: string | null;
    playlist: string[];  // File IDs in current view
    playlistIndex: number;

    // Media state (video/audio)
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    isMuted: boolean;

    // Image viewer state
    zoom: number;
    panX: number;
    panY: number;
    rotation: number;

    // PDF state
    currentPage: number;
    totalPages: number;
    pdfZoom: number;
    pdfRotation: number;

    // Loading state
    loading: boolean;
    error: string | null;
}

const initialState: ViewerState = {
    isOpen: false,
    isFullscreen: false,
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
    loading: false,
    error: null,
};

export const viewerSlice = createSlice({
    name: 'fileViewer',
    initialState,
    reducers: {
        // Open viewer with a file and playlist
        openViewer: (
            state,
            action: PayloadAction<{ fileId: string; playlist: string[] }>
        ) => {
            const { fileId, playlist } = action.payload;
            state.isOpen = true;
            state.currentFileId = fileId;
            state.playlist = playlist;
            state.playlistIndex = playlist.indexOf(fileId);
            state.loading = true;
            state.error = null;
            // Reset viewer state
            state.zoom = 1;
            state.panX = 0;
            state.panY = 0;
            state.rotation = 0;
            state.currentPage = 1;
            state.totalPages = 0;
            state.pdfZoom = 1;
            state.pdfRotation = 0;
            state.isPlaying = false;
            state.currentTime = 0;
        },

        // Close viewer
        closeViewer: (state) => {
            state.isOpen = false;
            state.isFullscreen = false;
            state.currentFileId = null;
            state.playlist = [];
            state.playlistIndex = 0;
            state.loading = false;
            state.error = null;
        },

        // Navigate to next file in playlist
        nextFile: (state) => {
            if (state.playlistIndex < state.playlist.length - 1) {
                state.playlistIndex += 1;
                state.currentFileId = state.playlist[state.playlistIndex];
                state.loading = true;
                // Reset viewer state for new file
                state.zoom = 1;
                state.panX = 0;
                state.panY = 0;
                state.rotation = 0;
                state.currentPage = 1;
                state.isPlaying = false;
                state.currentTime = 0;
            }
        },

        // Navigate to previous file in playlist
        previousFile: (state) => {
            if (state.playlistIndex > 0) {
                state.playlistIndex -= 1;
                state.currentFileId = state.playlist[state.playlistIndex];
                state.loading = true;
                // Reset viewer state for new file
                state.zoom = 1;
                state.panX = 0;
                state.panY = 0;
                state.rotation = 0;
                state.currentPage = 1;
                state.isPlaying = false;
                state.currentTime = 0;
            }
        },

        // Toggle fullscreen
        toggleFullscreen: (state) => {
            state.isFullscreen = !state.isFullscreen;
        },

        setFullscreen: (state, action: PayloadAction<boolean>) => {
            state.isFullscreen = action.payload;
        },

        // Media controls
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

        // Image viewer controls
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

        // PDF controls
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

        // Loading state
        setLoading: (state, action: PayloadAction<boolean>) => {
            state.loading = action.payload;
        },

        setError: (state, action: PayloadAction<string | null>) => {
            state.error = action.payload;
            state.loading = false;
        },
    },
});

export const {
    openViewer,
    closeViewer,
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
    setLoading,
    setError,
} = viewerSlice.actions;

// Aliases for clearer naming in viewer components
export const setViewerLoading = setLoading;
export const setViewerError = setError;

export const viewerReducer = viewerSlice.reducer;
