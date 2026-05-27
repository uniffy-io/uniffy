import { createSlice, createSelector } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import type { AccessMode } from '@uniffy/proto/common/v1/common_pb';

export interface UploadItem {
    id: string;

    filename: string;
    mimeType: string;
    totalSize: number;

    uploadId?: string;
    chunkSize?: number;
    totalChunks?: number;

    status: 'queued' | 'initializing' | 'uploading' | 'completing' | 'completed' | 'failed' | 'aborted';
    uploadedChunks: number;
    uploadedBytes: number;
    /** 0..100 */
    progress: number;

    folderId?: string;
    accessMode?: AccessMode;

    error?: string;

    startedAt?: number;
    completedAt?: number;

    fileId?: string;
}

export interface DownloadItem {
    id: string;

    filename: string;
    /** 1 for single file, >1 for an archive download. */
    fileCount: number;

    status: 'downloading' | 'archiving' | 'completed' | 'failed';
    /** 1-indexed. */
    currentFile: number;
    currentFilename: string;
    /** 0..100 */
    progress: number;

    error?: string;

    startedAt: number;
    completedAt?: number;
}

interface UploadState {
    queue: UploadItem[];
    activeUploads: Record<string, UploadItem>;
    completedUploads: UploadItem[];
    failedUploads: UploadItem[];

    activeDownloads: Record<string, DownloadItem>;
    completedDownloads: DownloadItem[];

    isUploading: boolean;
    isDownloading: boolean;
    totalQueuedSize: number;
    totalUploadedSize: number;

    maxConcurrentUploads: number;

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

            if (newItems.length > 0) {
                state.showUploadPanel = true;
            }
        },

        removeFromQueue: (state, action: PayloadAction<string>) => {
            const index = state.queue.findIndex(item => item.id === action.payload);
            if (index >= 0) {
                const item = state.queue[index];
                state.totalQueuedSize -= item.totalSize;
                state.queue.splice(index, 1);
            }
        },

        startUpload: (state, action: PayloadAction<{ itemId: string; uploadId: string; chunkSize: number; totalChunks: number }>) => {
            const { itemId, uploadId, chunkSize, totalChunks } = action.payload;

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

                state.queue.splice(queueIndex, 1);
                state.activeUploads[itemId] = activeItem;
                state.isUploading = true;
            }
        },

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

        /** Final chunk sent, awaiting server CompleteUpload. */
        setCompleting: (state, action: PayloadAction<string>) => {
            const item = state.activeUploads[action.payload];
            if (item) {
                item.status = 'completing';
            }
        },

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

                if (state.completedUploads.length > 20) {
                    state.completedUploads = state.completedUploads.slice(0, 20);
                }

                if (Object.keys(state.activeUploads).length === 0 && state.queue.length === 0) {
                    state.isUploading = false;
                }
            }
        },

        failUpload: (state, action: PayloadAction<{ itemId: string; error: string }>) => {
            const { itemId, error } = action.payload;

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

            if (state.failedUploads.length > 10) {
                state.failedUploads = state.failedUploads.slice(0, 10);
            }

            if (Object.keys(state.activeUploads).length === 0 && state.queue.length === 0) {
                state.isUploading = false;
            }
        },

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

            if (Object.keys(state.activeUploads).length === 0 && state.queue.length === 0) {
                state.isUploading = false;
            }
        },

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

        clearCompleted: (state) => {
            state.completedUploads = [];
        },

        clearFailed: (state) => {
            state.failedUploads = [];
        },

        toggleUploadPanel: (state) => {
            state.showUploadPanel = !state.showUploadPanel;
        },

        setShowUploadPanel: (state, action: PayloadAction<boolean>) => {
            state.showUploadPanel = action.payload;
        },

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

        updateDownloadProgress: (state, action: PayloadAction<{ id: string; currentFile: number; currentFilename: string; progress: number }>) => {
            const { id, currentFile, currentFilename, progress } = action.payload;
            const item = state.activeDownloads[id];
            if (item) {
                item.currentFile = currentFile;
                item.currentFilename = currentFilename;
                item.progress = progress;
            }
        },

        setDownloadArchiving: (state, action: PayloadAction<string>) => {
            const item = state.activeDownloads[action.payload];
            if (item) {
                item.status = 'archiving';
            }
        },

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

                if (state.completedDownloads.length > 10) {
                    state.completedDownloads = state.completedDownloads.slice(0, 10);
                }

                if (Object.keys(state.activeDownloads).length === 0) {
                    state.isDownloading = false;
                }
            }
        },

        failDownload: (state, action: PayloadAction<{ id: string; error: string }>) => {
            const { id, error } = action.payload;
            const item = state.activeDownloads[id];
            if (item) {
                item.status = 'failed';
                item.error = error;
                item.completedAt = Date.now();
                delete state.activeDownloads[id];

                if (Object.keys(state.activeDownloads).length === 0) {
                    state.isDownloading = false;
                }
            }
        },

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
    startDownload,
    updateDownloadProgress,
    setDownloadArchiving,
    completeDownload,
    failDownload,
    clearCompletedDownloads,
} = uploadSlice.actions;

const selectFailedUploads = (state: RootState) => state.upload.failedUploads;

export const selectAbortedUploads = createSelector(
    [selectFailedUploads],
    (failedUploads) => failedUploads.filter((item) => item.status === 'aborted')
);

export const uploadReducer = uploadSlice.reducer;
