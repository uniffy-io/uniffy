/**
 * Files Async Thunks
 *
 * Redux async thunks for files API operations.
 * All async operations go through these thunks for proper state management.
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import { filesApi } from '@/features/files/api/filesApi';
import type { RootState } from '@/app/store';
import type { File } from '@/gen/files/v1/files_pb';
import { VisibilityScope } from '@/gen/common/v1/common_pb';

// Helper to get organization ID from state
const getOrganizationId = (state: RootState): string => {
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) {
        throw new Error('No organization selected');
    }
    return orgId;
};

// Helper to convert proto File to serializable plain object
const fileToPlain = (file: File) => ({
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
        exif: { ...file.metadata.exif },
        error: file.metadata.error,
    } : undefined,
});

/** Serialized file type for Redux storage (bigints converted to numbers) */
export type SerializedFile = ReturnType<typeof fileToPlain>;

/**
 * Fetch files with pagination and filters.
 */
export const fetchFiles = createAsyncThunk<
    {
        files: SerializedFile[];
        totalCount: number;
        page: number;
        pageSize: number;
        totalPages: number;
    },
    {
        page?: number;
        pageSize?: number;
        folderId?: string | null;
        visibility?: VisibilityScope;
        personalOnly?: boolean;
        sharedOnly?: boolean;
        includeDeleted?: boolean;
        groupId?: string;
        tags?: string[];
        sortBy?: string;
        sortOrder?: string;
    } | void,
    { state: RootState; rejectValue: string }
>('files/fetchFiles', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());

        const response = await filesApi.listFiles({
            organizationId,
            page: params?.page ?? 1,
            pageSize: params?.pageSize ?? 50,
            folderId: params?.folderId ?? undefined,
            visibility: params?.visibility,
            personalOnly: params?.personalOnly ?? false,
            sharedOnly: params?.sharedOnly ?? false,
            includeDeleted: params?.includeDeleted ?? false,
            groupId: params?.groupId,
            tags: params?.tags ?? [],
            sortBy: params?.sortBy ?? 'updated_at',
            sortOrder: params?.sortOrder ?? 'desc',
        });

        return {
            files: response.files.map(fileToPlain),
            totalCount: response.totalCount,
            page: response.page,
            pageSize: response.pageSize,
            totalPages: response.totalPages,
        };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch files');
    }
});

/**
 * Fetch a single file by ID.
 */
export const fetchFile = createAsyncThunk<
    SerializedFile,
    string,
    { state: RootState; rejectValue: string }
>('files/fetchFile', async (fileId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await filesApi.getFile({
            fileId,
            organizationId,
        });
        if (!response.file) {
            return rejectWithValue('File not found');
        }
        return fileToPlain(response.file);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch file');
    }
});

/**
 * Update file metadata.
 */
export const updateFile = createAsyncThunk<
    SerializedFile,
    {
        fileId: string;
        filename?: string;
        tags?: string[];
        description?: string;
        visibility?: VisibilityScope;
    },
    { state: RootState; rejectValue: string }
>('files/updateFile', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await filesApi.updateFile({
            fileId: params.fileId,
            organizationId,
            filename: params.filename,
            tags: params.tags,
            description: params.description,
            visibility: params.visibility,
        });
        if (!response.file) {
            return rejectWithValue('Failed to update file');
        }
        return fileToPlain(response.file);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to update file');
    }
});

/**
 * Delete a file (soft delete by default).
 */
export const deleteFile = createAsyncThunk<
    { fileId: string; permanent: boolean },
    { fileId: string; permanent?: boolean },
    { state: RootState; rejectValue: string }
>('files/deleteFile', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await filesApi.deleteFile({
            fileId: params.fileId,
            organizationId,
            permanent: params.permanent ?? false,
        });
        if (!response.success) {
            return rejectWithValue(response.message || 'Failed to delete file');
        }
        return { fileId: params.fileId, permanent: params.permanent ?? false };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to delete file');
    }
});

/**
 * Restore a deleted file.
 */
export const restoreFile = createAsyncThunk<
    SerializedFile,
    string,
    { state: RootState; rejectValue: string }
>('files/restoreFile', async (fileId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await filesApi.restoreFile({
            fileId,
            organizationId,
        });
        if (!response.file) {
            return rejectWithValue('Failed to restore file');
        }
        return fileToPlain(response.file);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to restore file');
    }
});

/**
 * Move files and/or folders to a different location and/or visibility scope.
 */
export const moveItems = createAsyncThunk<
    {
        success: boolean;
        message: string;
        filesMoved: number;
        foldersMoved: number;
    },
    {
        fileIds?: string[];
        folderIds?: string[];
        targetFolderId?: string | null;
        targetVisibility?: VisibilityScope;
    },
    { state: RootState; rejectValue: string }
>('files/moveItems', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());

        const response = await filesApi.moveItems({
            organizationId,
            fileIds: params.fileIds ?? [],
            folderIds: params.folderIds ?? [],
            targetFolderId: params.targetFolderId ?? undefined,
            targetVisibility: params.targetVisibility,
        });

        return {
            success: response.success,
            message: response.message,
            filesMoved: response.filesMoved,
            foldersMoved: response.foldersMoved,
        };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to move items');
    }
});

/**
 * Initialize files data.
 * Load all files for the current organization.
 */
export const initializeFilesData = createAsyncThunk<
    {
        files: SerializedFile[];
        totalCount: number;
    },
    { forceRefresh?: boolean } | void,
    { state: RootState; rejectValue: string }
>('files/initializeFilesData', async (params, { getState, rejectWithValue }) => {
    try {
        const state = getState();
        const organizationId = state.auth.currentOrganizationId;

        if (!organizationId) {
            return rejectWithValue('No organization selected');
        }

        const forceRefresh = params?.forceRefresh ?? false;

        // Check if we already have files loaded
        const existingFilesCount = Object.keys(state.files.files).length;
        if (existingFilesCount > 0 && !forceRefresh) {
            return {
                files: Object.values(state.files.files),
                totalCount: existingFilesCount,
            };
        }

        // Fetch all files (paginated, get all pages)
        const pageSize = 100;
        const firstResponse = await filesApi.listFiles({
            organizationId,
            page: 1,
            pageSize,
            folderId: "all",
            includeDeleted: true,
        });

        const allFiles = [...firstResponse.files];

        // Fetch remaining pages if needed
        if (firstResponse.totalPages > 1) {
            const remainingPages = Array.from(
                { length: firstResponse.totalPages - 1 },
                (_, i) => i + 2
            );

            const pageResponses = await Promise.all(
                remainingPages.map(page =>
                    filesApi.listFiles({
                        organizationId,
                        page,
                        pageSize,
                        folderId: "all",
                        includeDeleted: true,
                    })
                )
            );

            for (const response of pageResponses) {
                allFiles.push(...response.files);
            }
        }

        return {
            files: allFiles.map(fileToPlain),
            totalCount: firstResponse.totalCount,
        };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to initialize files');
    }
});
