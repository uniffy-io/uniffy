/**
 * Files Tree Async Thunks
 *
 * Redux async thunks for folder tree operations.
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import { filesApi } from '../api/filesApi';
import type { RootState } from '@/app/store';
import type { TreeNode, Folder } from '@/gen/files/v1/files_pb';
import type { VisibilityScope } from '@/gen/common/v1/common_pb';

// Helper to get organization ID from state
const getOrganizationId = (state: RootState): string => {
    const orgId = state.auth.currentOrganizationId;
    if (!orgId) {
        throw new Error('No organization selected');
    }
    return orgId;
};

// Convert proto TreeNode to serializable format
const treeNodeToPlain = (node: TreeNode): SerializedTreeNode => ({
    id: node.id,
    name: node.name,
    isFolder: node.isFolder,
    parentId: node.parentId,
    visibility: node.visibility,
    childCount: node.childCount,
    sizeBytes: node.sizeBytes ? (typeof node.sizeBytes === 'bigint' ? Number(node.sizeBytes) : node.sizeBytes) : undefined,
    mimeType: node.mimeType,
    children: node.children?.map(treeNodeToPlain),
});

// Convert proto Folder to serializable format
const folderToPlain = (folder: Folder): SerializedFolder => ({
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    visibility: folder.visibility,
    isDeleted: folder.isDeleted,
});

/** Serialized tree node type for Redux storage */
export interface SerializedTreeNode {
    id: string;
    name: string;
    isFolder: boolean;
    parentId?: string;
    visibility: VisibilityScope;
    childCount: number;
    sizeBytes?: number;
    mimeType?: string;
    children?: SerializedTreeNode[];
}

/** Serialized folder type for Redux storage */
export interface SerializedFolder {
    id: string;
    name: string;
    parentId?: string;
    visibility: VisibilityScope;
    isDeleted: boolean;
}

/**
 * Fetch the files tree structure.
 */
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

/**
 * Create a new folder.
 */
export const createFolder = createAsyncThunk<
    SerializedFolder,
    {
        name: string;
        parentId?: string;
        visibility: VisibilityScope;
    },
    { state: RootState; rejectValue: string }
>('filesTree/createFolder', async (params, { getState, rejectWithValue }) => {
    try {
        const organizationId = getOrganizationId(getState());

        const response = await filesApi.createFolder({
            organizationId,
            name: params.name,
            parentId: params.parentId,
            visibility: params.visibility,
        });

        if (!response.folder) {
            return rejectWithValue('Failed to create folder');
        }

        return folderToPlain(response.folder);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to create folder');
    }
});

/**
 * Update a folder.
 */
export const updateFolder = createAsyncThunk<
    SerializedFolder,
    {
        folderId: string;
        name?: string;
        parentId?: string;
        visibility?: VisibilityScope;
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
            visibility: params.visibility,
        });

        if (!response.folder) {
            return rejectWithValue('Failed to update folder');
        }

        return folderToPlain(response.folder);
    } catch (error) {
        return rejectWithValue(error instanceof Error ? error.message : 'Failed to update folder');
    }
});

/**
 * Delete a folder.
 */
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
