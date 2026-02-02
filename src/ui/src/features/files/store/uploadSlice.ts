/**
 * Upload Redux Slice
 *
 * Manages file upload state including queue, progress, and streaming.
 */

import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

export interface UploadItem {
    // Unique ID for this upload
    id: string;

    // File info
    filename: string;
    mimeType: string;
    totalSize: number;

    // Upload session info (from initiateUpload)
    uploadId?: string;
    chunkSize?: number;
    totalChunks?: number;

    // Progress tracking
    status: 'queued' | 'initializing' | 'uploading' | 'completing' | 'completed' | 'failed' | 'aborted';
    uploadedChunks: number;
    uploadedBytes: number;
    progress: number; // 0-100

    // Target location
    folderId?: string;
    visibility?: number;

    // Error info
    error?: string;

    // Timestamps
    startedAt?: number;
    completedAt?: number;

    // Result
    fileId?: string;
}

export interface DownloadItem {
    // Unique ID for this download
    id: string;

    // File info
    filename: string;
    fileCount: number; // Number of files being downloaded (1 for single, >1 for archive)

    // Progress tracking
    status: 'downloading' | 'archiving' | 'completed' | 'failed';
    currentFile: number; // Current file being downloaded (1-indexed)
    currentFilename: string;
    progress: number; // 0-100

    // Error info
    error?: string;

    // Timestamps
    startedAt: number;
    completedAt?: number;
}

interface UploadState {
    // Upload queue
    queue: UploadItem[];

    // Active uploads (by upload item ID)
    activeUploads: Record<string, UploadItem>;

    // Completed uploads (recent)
    completedUploads: UploadItem[];

    // Failed uploads
    failedUploads: UploadItem[];

    // Download state
    activeDownloads: Record<string, DownloadItem>;
    completedDownloads: DownloadItem[];

    // Global state
    isUploading: boolean;
    isDownloading: boolean;
    totalQueuedSize: number;
    totalUploadedSize: number;

    // Settings
    maxConcurrentUploads: number;

    // UI state
    showUploadPanel: boolean;
}

const initialState: UploadState = {
    queue: [],
    activeUploads: {},
    completedUploads: [],
    failedUploads: [],
    activeDownloads: {},
    completedDownloads: [],
    isUploading: false,
    isDownloading: false,
    totalQueuedSize: 0,
    totalUploadedSize: 0,
    maxConcurrentUploads: 3,
    showUploadPanel: false,
};

export const uploadSlice = createSlice({
    name: 'upload',
    initialState,
    reducers: {
        // Add files to upload queue
        addToQueue: (state, action: PayloadAction<Omit<UploadItem, 'status' | 'uploadedChunks' | 'uploadedBytes' | 'progress'>[]>) => {
            const newItems: UploadItem[] = action.payload.map(item => ({
                ...item,
                status: 'queued',
                uploadedChunks: 0,
                uploadedBytes: 0,
                progress: 0,
            }));

            state.queue.push(...newItems);
            state.totalQueuedSize += newItems.reduce((sum, item) => sum + item.totalSize, 0);

            // Show upload panel when items are added
            if (newItems.length > 0) {
                state.showUploadPanel = true;
            }
        },

        // Remove item from queue (before upload starts)
        removeFromQueue: (state, action: PayloadAction<string>) => {
            const index = state.queue.findIndex(item => item.id === action.payload);
            if (index >= 0) {
                const item = state.queue[index];
                state.totalQueuedSize -= item.totalSize;
                state.queue.splice(index, 1);
            }
        },

        // Start upload for a queued item
        startUpload: (state, action: PayloadAction<{ itemId: string; uploadId: string; chunkSize: number; totalChunks: number }>) => {
            const { itemId, uploadId, chunkSize, totalChunks } = action.payload;

            // Find in queue
            const queueIndex = state.queue.findIndex(item => item.id === itemId);
            if (queueIndex >= 0) {
                const item = state.queue[queueIndex];
                const activeItem: UploadItem = {
                    ...item,
                    uploadId,
                    chunkSize,
                    totalChunks,
                    status: 'uploading',
                    startedAt: Date.now(),
                };

                // Move from queue to active
                state.queue.splice(queueIndex, 1);
                state.activeUploads[itemId] = activeItem;
                state.isUploading = true;
            }
        },

        // Update upload progress
        updateProgress: (state, action: PayloadAction<{ itemId: string; uploadedChunks: number; uploadedBytes: number }>) => {
            const { itemId, uploadedChunks, uploadedBytes } = action.payload;
            const item = state.activeUploads[itemId];
            if (item) {
                item.uploadedChunks = uploadedChunks;
                item.uploadedBytes = uploadedBytes;
                item.progress = Math.round((uploadedBytes / item.totalSize) * 100);
                state.totalUploadedSize = Object.values(state.activeUploads)
                    .reduce((sum, i) => sum + i.uploadedBytes, 0);
            }
        },

        // Mark upload as completing (final chunk sent, waiting for server)
        setCompleting: (state, action: PayloadAction<string>) => {
            const item = state.activeUploads[action.payload];
            if (item) {
                item.status = 'completing';
            }
        },

        // Complete an upload
        completeUpload: (state, action: PayloadAction<{ itemId: string; fileId: string }>) => {
            const { itemId, fileId } = action.payload;
            const item = state.activeUploads[itemId];
            if (item) {
                const completedItem: UploadItem = {
                    ...item,
                    status: 'completed',
                    fileId,
                    completedAt: Date.now(),
                    progress: 100,
                };

                delete state.activeUploads[itemId];
                state.completedUploads.unshift(completedItem);

                // Keep only last 20 completed
                if (state.completedUploads.length > 20) {
                    state.completedUploads = state.completedUploads.slice(0, 20);
                }

                // Check if all uploads done
                if (Object.keys(state.activeUploads).length === 0 && state.queue.length === 0) {
                    state.isUploading = false;
                }
            }
        },

        // Fail an upload
        failUpload: (state, action: PayloadAction<{ itemId: string; error: string }>) => {
            const { itemId, error } = action.payload;

            // Check queue first
            const queueIndex = state.queue.findIndex(item => item.id === itemId);
            if (queueIndex >= 0) {
                const item = state.queue[queueIndex];
                const failedItem: UploadItem = {
                    ...item,
                    status: 'failed',
                    error,
                    completedAt: Date.now(),
                };
                state.queue.splice(queueIndex, 1);
                state.failedUploads.unshift(failedItem);
            } else {
                // Check active uploads
                const item = state.activeUploads[itemId];
                if (item) {
                    const failedItem: UploadItem = {
                        ...item,
                        status: 'failed',
                        error,
                        completedAt: Date.now(),
                    };
                    delete state.activeUploads[itemId];
                    state.failedUploads.unshift(failedItem);
                }
            }

            // Keep only last 10 failed
            if (state.failedUploads.length > 10) {
                state.failedUploads = state.failedUploads.slice(0, 10);
            }

            // Check if all uploads done
            if (Object.keys(state.activeUploads).length === 0 && state.queue.length === 0) {
                state.isUploading = false;
            }
        },

        // Abort an upload
        abortUpload: (state, action: PayloadAction<string>) => {
            const itemId = action.payload;
            const item = state.activeUploads[itemId];
            if (item) {
                const abortedItem: UploadItem = {
                    ...item,
                    status: 'aborted',
                    completedAt: Date.now(),
                };
                delete state.activeUploads[itemId];
                state.failedUploads.unshift(abortedItem);
            }

            // Check if all uploads done
            if (Object.keys(state.activeUploads).length === 0 && state.queue.length === 0) {
                state.isUploading = false;
            }
        },

        // Retry a failed upload
        retryUpload: (state, action: PayloadAction<string>) => {
            const itemId = action.payload;
            const index = state.failedUploads.findIndex(item => item.id === itemId);
            if (index >= 0) {
                const item = state.failedUploads[index];
                const retryItem: UploadItem = {
                    ...item,
                    status: 'queued',
                    uploadedChunks: 0,
                    uploadedBytes: 0,
                    progress: 0,
                    error: undefined,
                    startedAt: undefined,
                    completedAt: undefined,
                    fileId: undefined,
                };
                state.failedUploads.splice(index, 1);
                state.queue.push(retryItem);
            }
        },

        // Clear completed uploads
        clearCompleted: (state) => {
            state.completedUploads = [];
        },

        // Clear failed uploads
        clearFailed: (state) => {
            state.failedUploads = [];
        },

        // Toggle upload panel visibility
        toggleUploadPanel: (state) => {
            state.showUploadPanel = !state.showUploadPanel;
        },

        // Set upload panel visibility
        setShowUploadPanel: (state, action: PayloadAction<boolean>) => {
            state.showUploadPanel = action.payload;
        },

        // Clear all upload state (for logout)
        clearUploads: (state) => {
            state.queue = [];
            state.activeUploads = {};
            state.completedUploads = [];
            state.failedUploads = [];
            state.activeDownloads = {};
            state.completedDownloads = [];
            state.isUploading = false;
            state.isDownloading = false;
            state.totalQueuedSize = 0;
            state.totalUploadedSize = 0;
        },

        // ─────────────────────────────────────────────────────────────
        // Download actions
        // ─────────────────────────────────────────────────────────────

        // Start a download (single or archive)
        startDownload: (state, action: PayloadAction<{ id: string; filename: string; fileCount: number }>) => {
            const { id, filename, fileCount } = action.payload;
            state.activeDownloads[id] = {
                id,
                filename,
                fileCount,
                status: 'downloading',
                currentFile: 0,
                currentFilename: '',
                progress: 0,
                startedAt: Date.now(),
            };
            state.isDownloading = true;
            state.showUploadPanel = true;
        },

        // Update download progress
        updateDownloadProgress: (state, action: PayloadAction<{ id: string; currentFile: number; currentFilename: string; progress: number }>) => {
            const { id, currentFile, currentFilename, progress } = action.payload;
            const item = state.activeDownloads[id];
            if (item) {
                item.currentFile = currentFile;
                item.currentFilename = currentFilename;
                item.progress = progress;
            }
        },

        // Set download to archiving state
        setDownloadArchiving: (state, action: PayloadAction<string>) => {
            const item = state.activeDownloads[action.payload];
            if (item) {
                item.status = 'archiving';
            }
        },

        // Complete a download
        completeDownload: (state, action: PayloadAction<string>) => {
            const id = action.payload;
            const item = state.activeDownloads[id];
            if (item) {
                const completedItem: DownloadItem = {
                    ...item,
                    status: 'completed',
                    progress: 100,
                    completedAt: Date.now(),
                };
                delete state.activeDownloads[id];
                state.completedDownloads.unshift(completedItem);

                // Keep only last 10 completed downloads
                if (state.completedDownloads.length > 10) {
                    state.completedDownloads = state.completedDownloads.slice(0, 10);
                }

                // Check if all downloads done
                if (Object.keys(state.activeDownloads).length === 0) {
                    state.isDownloading = false;
                }
            }
        },

        // Fail a download
        failDownload: (state, action: PayloadAction<{ id: string; error: string }>) => {
            const { id, error } = action.payload;
            const item = state.activeDownloads[id];
            if (item) {
                item.status = 'failed';
                item.error = error;
                item.completedAt = Date.now();
                delete state.activeDownloads[id];

                // Check if all downloads done
                if (Object.keys(state.activeDownloads).length === 0) {
                    state.isDownloading = false;
                }
            }
        },

        // Clear completed downloads
        clearCompletedDownloads: (state) => {
            state.completedDownloads = [];
        },
    },
});

export const {
    addToQueue,
    removeFromQueue,
    startUpload,
    updateProgress,
    setCompleting,
    completeUpload,
    failUpload,
    abortUpload,
    retryUpload,
    clearCompleted,
    clearFailed,
    toggleUploadPanel,
    setShowUploadPanel,
    clearUploads,
    // Download actions
    startDownload,
    updateDownloadProgress,
    setDownloadArchiving,
    completeDownload,
    failDownload,
    clearCompletedDownloads,
} = uploadSlice.actions;

export default uploadSlice.reducer;
