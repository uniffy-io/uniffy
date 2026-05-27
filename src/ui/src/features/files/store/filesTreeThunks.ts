import { createAsyncThunk } from '@reduxjs/toolkit';
import { filesApi } from '@/features/files/api/filesApi';
import type { RootState } from '@/app/store';
import type { TreeNode, Folder } from '@uniffy/proto/files/v1/files_pb';
import type { AccessMode } from '@uniffy/proto/common/v1/common_pb';

const getOrganizationId = (state: RootState): string => {
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) {
        throw new Error('No organization selected');
    }
    return orgId;
};

const treeNodeToPlain = (node: TreeNode): SerializedTreeNode => ({
    id: node.id,
    name: node.name,
    isFolder: node.isFolder,
    parentId: node.parentId,
    accessMode: node.accessMode,
    childCount: node.childCount,
    sizeBytes: node.sizeBytes ? (typeof node.sizeBytes === 'bigint' ? Number(node.sizeBytes) : node.sizeBytes) : undefined,
    mimeType: node.mimeType,
    children: node.children?.map(treeNodeToPlain),
});

const folderToPlain = (folder: Folder): SerializedFolder => ({
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    accessMode: folder.accessMode,
    ownerId: folder.ownerId,
    isDeleted: folder.isDeleted,
});

export interface SerializedTreeNode {
    id: string;
    name: string;
    isFolder: boolean;
    parentId?: string;
    accessMode: AccessMode;
    childCount: number;
    sizeBytes?: number;
    mimeType?: string;
    children?: SerializedTreeNode[];
}

export interface SerializedFolder {
    id: string;
    name: string;
    parentId?: string;
    accessMode: AccessMode;
    ownerId: string;
    isDeleted: boolean;
}

export const fetchFilesTree = createAsyncThunk<
    { nodes: SerializedTreeNode[] },
    { rootFolderId?: string; includeFiles?: boolean; personalOnly?: boolean } | void,
    { state: RootState; rejectValue: string }
>('filesTree/fetchFilesTree', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());

        const response = await filesApi.getFilesTree({
            organizationId,
            rootFolderId: params?.rootFolderId,
            includeFiles: params?.includeFiles ?? true,
            personalOnly: params?.personalOnly ?? false,
        });

        return {
            nodes: response.nodes.map(treeNodeToPlain),
        };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to fetch files tree');
    }
});

export const createFolder = createAsyncThunk<
    SerializedFolder,
    {
        name: string;
        parentId?: string;
    },
    { state: RootState; rejectValue: string }
>('filesTree/createFolder', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());

        const response = await filesApi.createFolder({
            organizationId,
            name: params.name,
            parentId: params.parentId,
        });

        if (!response.folder) {
            return rejectWithValue('Failed to create folder');
        }

        return folderToPlain(response.folder);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to create folder');
    }
});

export const updateFolder = createAsyncThunk<
    SerializedFolder,
    {
        folderId: string;
        name?: string;
        parentId?: string;
    },
    { state: RootState; rejectValue: string }
>('filesTree/updateFolder', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());

        const response = await filesApi.updateFolder({
            folderId: params.folderId,
            organizationId,
            name: params.name,
            parentId: params.parentId,
        });

        if (!response.folder) {
            return rejectWithValue('Failed to update folder');
        }

        return folderToPlain(response.folder);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to update folder');
    }
});

export const deleteFolder = createAsyncThunk<
    { folderId: string; filesDeleted: number; foldersDeleted: number },
    { folderId: string; permanent?: boolean; recursive?: boolean },
    { state: RootState; rejectValue: string }
>('filesTree/deleteFolder', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());

        const response = await filesApi.deleteFolder({
            folderId: params.folderId,
            organizationId,
            permanent: params.permanent ?? false,
            recursive: params.recursive ?? true,
        });

        if (!response.success) {
            return rejectWithValue(response.message || 'Failed to delete folder');
        }

        return {
            folderId: params.folderId,
            filesDeleted: response.filesDeleted,
            foldersDeleted: response.foldersDeleted,
        };
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to delete folder');
    }
});
