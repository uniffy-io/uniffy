/**
 * Files Selectors
 *
 * Memoized selectors for files state to prevent unnecessary re-renders.
 */

import { createSelector } from '@reduxjs/toolkit';
import type { RootState } from '@/app/store';
import type { SerializedTreeNode } from '@/features/files/store/filesTreeThunks';
import type { SerializedFilterCriteria } from '@/features/files/store/savedFiltersSlice';
import type { SerializedFile } from '@/features/files/store/filesThunks';
import { bucketForContent } from '@/shared/utils/contentRoles';

// MIME category mappings for filter matching
const MIME_CATEGORY_PATTERNS: Record<string, RegExp> = {
    document: /^(application\/(pdf|msword|vnd\.(ms-|openxmlformats-))|text\/)/,
    image: /^image\//,
    video: /^video\//,
    audio: /^audio\//,
    archive: /(zip|compressed|archive|tar|gz|rar|7z)/,
};

/**
 * Check if a file matches the filter criteria.
 */
function matchesFilterCriteria(file: SerializedFile, criteria: SerializedFilterCriteria): boolean {
    // Check extensions
    if (criteria.extensions && criteria.extensions.length > 0) {
        const fileExt = file.filename.split('.').pop()?.toLowerCase() ?? '';
        if (!criteria.extensions.some(ext => ext.toLowerCase() === fileExt)) {
            return false;
        }
    }

    // Check MIME categories
    if (criteria.mimeCategories && criteria.mimeCategories.length > 0) {
        const mimeType = file.mimeType.toLowerCase();
        const matchesCategory = criteria.mimeCategories.some(category => {
            const pattern = MIME_CATEGORY_PATTERNS[category];
            return pattern ? pattern.test(mimeType) : false;
        });
        if (!matchesCategory) {
            return false;
        }
    }

    // Check tags
    if (criteria.tags && criteria.tags.length > 0) {
        const fileTags = file.tags.map(t => t.toLowerCase());
        const matchesTags = criteria.tags.some(tag =>
            fileTags.includes(tag.toLowerCase())
        );
        if (!matchesTags) {
            return false;
        }
    }

    // Check size
    if (criteria.sizeMinBytes !== undefined && file.sizeBytes < criteria.sizeMinBytes) {
        return false;
    }
    if (criteria.sizeMaxBytes !== undefined && file.sizeBytes > criteria.sizeMaxBytes) {
        return false;
    }

    // Check owner IDs
    if (criteria.ownerIds && criteria.ownerIds.length > 0) {
        if (!criteria.ownerIds.includes(file.ownerId)) {
            return false;
        }
    }

    // Check created date range
    if (criteria.createdAfter) {
        const createdAt = file.createdAt?.seconds ?? 0;
        const afterDate = new Date(criteria.createdAfter).getTime() / 1000;
        if (createdAt < afterDate) {
            return false;
        }
    }
    if (criteria.createdBefore) {
        const createdAt = file.createdAt?.seconds ?? 0;
        const beforeDate = new Date(criteria.createdBefore).getTime() / 1000;
        if (createdAt > beforeDate) {
            return false;
        }
    }

    return true;
}

// Base selectors (not memoized - return primitives or stable references)
const selectFilesMap = (state: RootState) => state.files.files;
const selectCurrentFolderId = (state: RootState) => state.files.filters.folderId;
const selectViewScope = (state: RootState) => state.files.filters.viewScope;
const selectActiveFilterCriteria = (state: RootState) => state.files.activeFilter.criteria;
const selectCurrentUserId = (state: RootState) => state.auth.user?.id;
const selectFilesTreePersonal = (state: RootState) => state.filesTree.tree.personal;
const selectFilesTreeOrganization = (state: RootState) => state.filesTree.tree.organization;
const selectFilesTreeShared = (state: RootState) => state.filesTree.tree.shared;
const selectUploadQueue = (state: RootState) => state.upload.queue;
const selectUploadActive = (state: RootState) => state.upload.activeUploads;

/**
 * Select all files as an array (memoized).
 */
export const selectAllFiles = createSelector(
    [selectFilesMap],
    (filesMap) => Object.values(filesMap)
);

/**
 * Select files for the current folder (memoized).
 * When folderId is null (root), returns only files without a folderId.
 * When folderId is set, returns only files in that specific folder.
 */
export const selectFilesForCurrentFolder = createSelector(
    [selectAllFiles, selectCurrentFolderId],
    (files, folderId) => {
        if (folderId) {
            // Show files in the specific folder
            return files.filter((f) => f.folderId === folderId);
        }
        // Root level - only show files without a folderId
        return files.filter((f) => !f.folderId);
    }
);

/**
 * Select files for the current folder AND viewScope (memoized).
 * Applies folder filter, visibility/ownership filter based on viewScope,
 * and active filter criteria from saved filters.
 *
 * - personal: Only user's own PRIVATE files
 * - organization: Only ORGANIZATION visibility files
 * - shared: Only files NOT owned by current user
 * - all: All accessible files (no additional filter)
 */
export const selectFilesForCurrentFolderAndScope = createSelector(
    [selectAllFiles, selectCurrentFolderId, selectViewScope, selectActiveFilterCriteria, selectCurrentUserId],
    (files, folderId, viewScope, activeFilterCriteria, userId) => {
        // Start with non-deleted files only
        let filtered = files.filter(f => !f.isDeleted);

        // If an active filter is set, apply criteria AND respect folder navigation
        if (activeFilterCriteria) {
            filtered = filtered.filter(f => matchesFilterCriteria(f, activeFilterCriteria));
            // Apply folder filtering (treat "all" as root)
            if (folderId === 'all' || !folderId) {
                filtered = filtered.filter(f => !f.folderId);
            } else {
                filtered = filtered.filter(f => f.folderId === folderId);
            }
        } else {
            // No active filter - apply folder filtering
            // For "Shared With Me", show ALL shared files regardless of folder
            if (viewScope === 'shared') {
                filtered = filtered.filter(
                    (f) => userId ? bucketForContent({ ownerId: f.ownerId, accessMode: f.accessMode, currentUserId: userId }) === 'shared' : false
                );
                return filtered;
            }

            // For other views, filter by folder
            if (folderId === 'all') {
                // Show all files (no folder filter)
            } else if (folderId) {
                // Show files in specific folder
                filtered = filtered.filter((f) => f.folderId === folderId);
            } else {
                // Root level - only files without folder
                filtered = filtered.filter((f) => !f.folderId);
            }
        }

        // Apply viewScope filter
        if (userId) {
            if (viewScope === 'shared') {
                filtered = filtered.filter(
                    (f) => bucketForContent({ ownerId: f.ownerId, accessMode: f.accessMode, currentUserId: userId }) === 'shared'
                );
            } else if (viewScope === 'personal') {
                filtered = filtered.filter(
                    (f) => bucketForContent({ ownerId: f.ownerId, accessMode: f.accessMode, currentUserId: userId }) === 'personal'
                );
            } else if (viewScope === 'organization') {
                filtered = filtered.filter(
                    (f) => bucketForContent({ ownerId: f.ownerId, accessMode: f.accessMode, currentUserId: userId }) === 'organization'
                );
            }
        }
        // viewScope === 'all' shows everything (no additional filter)

        return filtered;
    }
);

/**
 * Select active (non-deleted) files (memoized).
 */
export const selectActiveFiles = createSelector(
    [selectAllFiles],
    (files) => files.filter((f) => !f.isDeleted)
);

/**
 * Select deleted files (trash) (memoized).
 */
export const selectDeletedFiles = createSelector(
    [selectAllFiles],
    (files) => files.filter((f) => f.isDeleted)
);

/**
 * Select all tree nodes combined (memoized).
 */
export const selectAllTreeNodes = createSelector(
    [selectFilesTreePersonal, selectFilesTreeOrganization, selectFilesTreeShared],
    (personal, organization, shared) => [...personal, ...organization, ...shared]
);

/**
 * Build a set of folder IDs that contain matching files at any depth.
 * Walks up from each matching file's folder to root, marking every
 * ancestor folder as "has matching content".
 */
function collectFolderIdsWithMatches(
    matchingFiles: SerializedFile[],
    treeNodes: SerializedTreeNode[],
): Set<string> {
    const result = new Set<string>();

    // Build folder -> parent lookup
    const parentMap = new Map<string, string | null>();
    function buildMap(nodes: SerializedTreeNode[]) {
        for (const node of nodes) {
            if (node.isFolder) {
                parentMap.set(node.id, node.parentId || null);
                if (node.children) buildMap(node.children);
            }
        }
    }
    buildMap(treeNodes);

    for (const file of matchingFiles) {
        let id: string | null = file.folderId || null;
        while (id) {
            if (result.has(id)) break;
            result.add(id);
            id = parentMap.get(id) ?? null;
        }
    }

    return result;
}

/**
 * Helper to find folders from tree nodes recursively.
 */
function findFoldersWithParent(nodes: SerializedTreeNode[], parentId: string | null): SerializedTreeNode[] {
    const result: SerializedTreeNode[] = [];

    for (const node of nodes) {
        if (node.isFolder) {
            // Check if this folder's parent matches
            const nodeParentId = node.parentId || null;
            if (nodeParentId === parentId) {
                result.push(node);
            }
            // Also search children recursively
            if (node.children) {
                result.push(...findFoldersWithParent(node.children, parentId));
            }
        }
    }

    return result;
}

/**
 * Select subfolders for the current folder (memoized).
 * When a filter is active, only returns folders that contain
 * at least one matching file at any depth.
 */
export const selectSubfoldersForCurrentFolder = createSelector(
    [selectAllTreeNodes, selectCurrentFolderId, selectActiveFilterCriteria, selectAllFiles],
    (treeNodes, folderId, activeFilterCriteria, allFiles) => {
        // When filter is active, treat "all" as root
        const parentId = (activeFilterCriteria && folderId === 'all') ? null : folderId;
        const folders = findFoldersWithParent(treeNodes, parentId);

        if (!activeFilterCriteria) {
            return folders;
        }

        // Only keep folders that contain at least one matching file (at any depth)
        const matchingFiles = allFiles.filter(f =>
            !f.isDeleted && matchesFilterCriteria(f, activeFilterCriteria)
        );
        const relevantIds = collectFolderIdsWithMatches(matchingFiles, treeNodes);
        return folders.filter(f => relevantIds.has(f.id));
    }
);

/**
 * Select active uploads as array (memoized).
 */
export const selectActiveUploadsArray = createSelector(
    [selectUploadActive],
    (activeMap) => Object.values(activeMap)
);

/**
 * Select total upload count (queue + active) (memoized).
 */
export const selectTotalPendingUploads = createSelector(
    [selectUploadQueue, selectActiveUploadsArray],
    (queue, active) => queue.length + active.length
);
