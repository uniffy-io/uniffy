import { createAsyncThunk } from '@reduxjs/toolkit';
import { filesApi } from '@/features/files/api/filesApi';
import { removeCachedBlob } from '@/features/files/components/viewer/hooks/blobCache';
import { bulkUpsertTags, tagToPlain } from '@/features/tags';
import type { RootState } from '@/app/store';
import type { File, FileVersion } from '@uniffy/proto/files/v1/files_pb';
import type { AccessMode } from '@uniffy/proto/common/v1/common_pb';

const getOrganizationId = (state: RootState): string => {
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) {
        throw new Error('No organization selected');
    }
    return orgId;
};

export const fileToPlain = (file: File) => ({
    id: file.id,
    urn: file.urn,
    organizationId: file.organizationId,
    ownerId: file.ownerId,
    accessMode: file.accessMode,
    baselineRole: file.baselineRole ?? null,
    userRole: file.userRole,
    filename: file.filename,
    originalFilename: file.originalFilename,
    mimeType: file.mimeType,
    sizeBytes: typeof file.sizeBytes === 'bigint' ? Number(file.sizeBytes) : file.sizeBytes,
    folderId: file.folderId,
    tagIds: file.tags.map((tag) => tag.id),
    description: file.description,
    version: file.version,
    extractionStatus: file.extractionStatus,
    transcodeStatus: file.transcodeStatus,
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

export type SerializedFile = ReturnType<typeof fileToPlain>;

export const hydrateFileTags = (file: File, dispatch: (action: unknown) => void): void => {
    if (!file.tags.length) return;
    dispatch(bulkUpsertTags(file.tags.map(tagToPlain)));
};

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
        accessMode?: AccessMode;
        personalOnly?: boolean;
        sharedOnly?: boolean;
        includeDeleted?: boolean;
        groupId?: string;
        tagIds?: string[];
        sortBy?: string;
        sortOrder?: string;
    } | void,
    { state: RootState; rejectValue: string }
>('files/fetchFiles', async (params, { dispatch, getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());

        const response = await filesApi.listFiles({
            organizationId,
            page: params?.page ?? 1,
            pageSize: params?.pageSize ?? 50,
            folderId: params?.folderId ?? undefined,
            accessMode: params?.accessMode,
            personalOnly: params?.personalOnly ?? false,
            sharedOnly: params?.sharedOnly ?? false,
            includeDeleted: params?.includeDeleted ?? false,
            groupId: params?.groupId,
            tagIds: params?.tagIds ?? [],
            sortBy: params?.sortBy ?? 'updated_at',
            sortOrder: params?.sortOrder ?? 'desc',
        });

        const upserts = response.files
            .flatMap((file) => file.tags)
            .map(tagToPlain);
        if (upserts.length > 0) {
            dispatch(bulkUpsertTags(upserts));
        }

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

export const fetchFile = createAsyncThunk<
    SerializedFile,
    string,
    { state: RootState; rejectValue: string }
>('files/fetchFile', async (fileId, { dispatch, getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await filesApi.getFile({
            fileId,
            organizationId,
        });
        if (!response.file) {
            return rejectWithValue('File not found');
        }
        hydrateFileTags(response.file, dispatch);
        return fileToPlain(response.file);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch file');
    }
});

/** `tagIds` is the replacement set of manual tag ids; `undefined` leaves them untouched, `[]` clears every assignment. */
export const updateFile = createAsyncThunk<
    SerializedFile,
    {
        fileId: string;
        filename?: string;
        tagIds?: string[];
        description?: string;
    },
    { state: RootState; rejectValue: string }
>('files/updateFile', async (params, { dispatch, getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await filesApi.updateFile({
            fileId: params.fileId,
            organizationId,
            filename: params.filename,
            tagIds: params.tagIds !== undefined ? { ids: params.tagIds } : undefined,
            description: params.description,
        });
        if (!response.file) {
            return rejectWithValue('Failed to update file');
        }
        hydrateFileTags(response.file, dispatch);
        return fileToPlain(response.file);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to update file');
    }
});

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

export const restoreFile = createAsyncThunk<
    SerializedFile,
    string,
    { state: RootState; rejectValue: string }
>('files/restoreFile', async (fileId, { dispatch, getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await filesApi.restoreFile({
            fileId,
            organizationId,
        });
        if (!response.file) {
            return rejectWithValue('Failed to restore file');
        }
        hydrateFileTags(response.file, dispatch);
        return fileToPlain(response.file);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to restore file');
    }
});

export const fileVersionToPlain = (version: FileVersion) => ({
    id: version.id,
    fileId: version.fileId,
    versionNumber: version.versionNumber,
    sizeBytes: typeof version.sizeBytes === 'bigint' ? Number(version.sizeBytes) : version.sizeBytes,
    uploadedBy: version.uploadedBy,
    createdAt: version.createdAt ? {
        seconds: typeof version.createdAt.seconds === 'bigint' ? Number(version.createdAt.seconds) : version.createdAt.seconds,
        nanos: typeof version.createdAt.nanos === 'bigint' ? Number(version.createdAt.nanos) : version.createdAt.nanos,
    } : undefined,
});

export type SerializedFileVersion = ReturnType<typeof fileVersionToPlain>;

export const fetchFileVersions = createAsyncThunk<
    { fileId: string; versions: SerializedFileVersion[] },
    string,
    { state: RootState; rejectValue: string }
>('files/fetchFileVersions', async (fileId, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await filesApi.listFileVersions({ fileId, organizationId });
        return { fileId, versions: response.versions.map(fileVersionToPlain) };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch file versions');
    }
});

export const restoreFileVersion = createAsyncThunk<
    SerializedFile,
    { fileId: string; versionId: string },
    { state: RootState; rejectValue: string }
>('files/restoreFileVersion', async (params, { dispatch, getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());
        const response = await filesApi.restoreFileVersion({
            fileId: params.fileId,
            organizationId,
            versionId: params.versionId,
        });
        if (!response.file) {
            return rejectWithValue('Failed to restore version');
        }
        // The current-version cache entry now holds superseded bytes.
        removeCachedBlob(params.fileId);
        hydrateFileTags(response.file, dispatch);
        void dispatch(fetchFileVersions(params.fileId));
        return fileToPlain(response.file);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to restore version');
    }
});

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
        targetAccessMode?: AccessMode;
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
            targetAccessMode: params.targetAccessMode,
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

export const initializeFilesData = createAsyncThunk<
    {
        files: SerializedFile[];
        totalCount: number;
    },
    { forceRefresh?: boolean } | void,
    { state: RootState; rejectValue: string }
>('files/initializeFilesData', async (params, { dispatch, getState, rejectWithValue }) => {
    try {
        const state = getState();
        const organizationId = state.auth.currentOrganizationId;

        if (!organizationId) {
            return rejectWithValue('No organization selected');
        }

        const forceRefresh = params?.forceRefresh ?? false;

        const existingFilesCount = Object.keys(state.files.files).length;
        if (existingFilesCount > 0 && !forceRefresh) {
            return {
                files: Object.values(state.files.files),
                totalCount: existingFilesCount,
            };
        }

        const pageSize = 100;
        const firstResponse = await filesApi.listFiles({
            organizationId,
            page: 1,
            pageSize,
            folderId: "all",
            includeDeleted: true,
        });

        const allFiles = [...firstResponse.files];

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

        const upserts = allFiles.flatMap((file) => file.tags).map(tagToPlain);
        if (upserts.length > 0) {
            dispatch(bulkUpsertTags(upserts));
        }

        return {
            files: allFiles.map(fileToPlain),
            totalCount: firstResponse.totalCount,
        };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to initialize files');
    }
});
