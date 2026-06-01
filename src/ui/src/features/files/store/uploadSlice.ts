import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { UploadRecord } from '@/features/files/upload/uploadTypes';

export type TrayView = 'expanded' | 'minimized' | 'hidden';

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
    /** Read-only projection of the engine's non-chat uploads, mirrored by reduxMirror. */
    records: UploadRecord[];
    trayView: TrayView;

    activeDownloads: Record<string, DownloadItem>;
    completedDownloads: DownloadItem[];
    isDownloading: boolean;
}

const initialState: UploadState = {
    records: [],
    // Default to minimized; the tray renders nothing until there is content to show. Once the user
    // hides it, the mirror never re-surfaces it - new uploads stay silent (failures still toast).
    trayView: 'minimized',
    activeDownloads: {},
    completedDownloads: [],
    isDownloading: false,
};

export const uploadSlice = createSlice({
    name: 'upload',
    initialState,
    reducers: {
        setUploadRecords: (state, action: PayloadAction<UploadRecord[]>) => {
            state.records = action.payload;
        },

        setTrayView: (state, action: PayloadAction<TrayView>) => {
            state.trayView = action.payload;
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
            // A download is a deliberate action, so surface the tray even if it was hidden.
            if (state.trayView === 'hidden') {
                state.trayView = 'minimized';
            }
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

        /** Reset the tray projection on logout / org switch. The engine itself is cancelled separately. */
        clearUploads: (state) => {
            state.records = [];
            state.activeDownloads = {};
            state.completedDownloads = [];
            state.isDownloading = false;
            state.trayView = 'minimized';
        },
    },
});

export const {
    setUploadRecords,
    setTrayView,
    startDownload,
    updateDownloadProgress,
    setDownloadArchiving,
    completeDownload,
    failDownload,
    clearCompletedDownloads,
    clearUploads,
} = uploadSlice.actions;

export const uploadReducer = uploadSlice.reducer;
