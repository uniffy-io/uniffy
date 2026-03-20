/**
 * Viewer Async Thunks
 *
 * Redux async thunks for file viewer operations.
 * Enables opening the viewer from anywhere (search, mentions, etc.)
 * without requiring the files domain to be loaded first.
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import { filesApi } from '@/features/files/api/filesApi';
import { openViewer, setFileData, setError } from '@/features/files/store/viewerSlice';
import type { RootState, AppDispatch } from '@/app/store';
import type { SerializedFile } from '@/features/files/store/filesThunks';
import type { File } from '@uniffy/proto/files/v1/files_pb';

// Helper to convert proto File to serializable plain object
// (duplicated from filesThunks to avoid circular dependency)
const fileToPlain = (file: File): SerializedFile => ({
    id: file.id,
    urn: file.urn,
    organizationId: file.organizationId,
    ownerId: file.ownerId,
    visibility: file.visibility,
    filename: file.filename,
    originalFilename: file.originalFilename,
    mimeType: file.mimeType,
    sizeBytes: typeof file.sizeBytes === 'bigint' ? Number(file.sizeBytes) : file.sizeBytes,
    folderId: file.folderId,
    tags: [...file.tags],
    description: file.description,
    version: file.version,
    extractionStatus: file.extractionStatus,
    isDeleted: file.isDeleted,
    createdAt: file.createdAt ? {
        seconds: typeof file.createdAt.seconds === 'bigint' ? Number(file.createdAt.seconds) : file.createdAt.seconds,
        nanos: typeof file.createdAt.nanos === 'bigint' ? Number(file.createdAt.nanos) : file.createdAt.nanos,
    } : undefined,
    updatedAt: file.updatedAt ? {
        seconds: typeof file.updatedAt.seconds === 'bigint' ? Number(file.updatedAt.seconds) : file.updatedAt.seconds,
        nanos: typeof file.updatedAt.nanos === 'bigint' ? Number(file.updatedAt.nanos) : file.updatedAt.nanos,
    } : undefined,
    deletedAt: file.deletedAt ? {
        seconds: typeof file.deletedAt.seconds === 'bigint' ? Number(file.deletedAt.seconds) : file.deletedAt.seconds,
        nanos: typeof file.deletedAt.nanos === 'bigint' ? Number(file.deletedAt.nanos) : file.deletedAt.nanos,
    } : undefined,
    groupIds: [...file.groupIds],
    userPermission: file.userPermission,
    ownerInfo: file.ownerInfo ? {
        id: file.ownerInfo.id,
        name: file.ownerInfo.name,
        email: file.ownerInfo.email,
    } : undefined,
    metadata: file.metadata ? {
        hasThumbnail: file.metadata.hasThumbnail,
        width: file.metadata.width,
        height: file.metadata.height,
        format: file.metadata.format,
        colorMode: file.metadata.colorMode,
        durationSeconds: file.metadata.durationSeconds,
        pageCount: file.metadata.pageCount,
        bitrate: file.metadata.bitrate,
        sampleRate: file.metadata.sampleRate,
        channels: file.metadata.channels,
        exif: { ...file.metadata.exif },
        error: file.metadata.error,
    } : undefined,
});

/**
 * Open the file viewer and fetch file data if not already in store.
 *
 * This thunk enables opening files from search, mentions, or other contexts
 * without navigating to the files domain. It:
 * 1. Opens the viewer modal immediately (shows loading state)
 * 2. Checks if file data exists in files.files store
 * 3. If not, fetches the file data from the API
 * 4. Updates the viewer with the file data
 */
export const openViewerWithFetch = createAsyncThunk<
    void,
    { fileId: string },
    { state: RootState; dispatch: AppDispatch; rejectValue: string }
>('fileViewer/openWithFetch', async ({ fileId }, { getState, dispatch, rejectWithValue }) => {
    const state = getState();
    const organizationId = state.auth.currentOrganizationId;

    if (!organizationId) {
        return rejectWithValue('No organization selected');
    }

    // Check if file already exists in files store
    const existingFile = state.files.files[fileId];

    if (existingFile) {
        // File exists in store - open viewer with it directly
        dispatch(openViewer({ fileId, fileData: existingFile }));
        return;
    }

    // File not in store - open viewer (loading state) and fetch
    dispatch(openViewer({ fileId }));

    try {
        const response = await filesApi.getFile({
            fileId,
            organizationId,
        });

        if (!response.file) {
            dispatch(setError('File not found'));
            return rejectWithValue('File not found');
        }

        const fileData = fileToPlain(response.file);
        dispatch(setFileData(fileData));
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to fetch file';
        dispatch(setError(message));
        return rejectWithValue(message);
    }
});
