import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "@/app/store";
import type { SerializedTreeNode } from "@/features/files/store/filesTreeThunks";
import type { SerializedFilterCriteria } from "@/features/files/store/savedFiltersSlice";
import type { SerializedFile } from "@/features/files/store/filesThunks";
import { bucketForContent } from "@/shared/utils/contentRoles";

const MIME_CATEGORY_PATTERNS: Record<string, RegExp> = {
  document: /^(application\/(pdf|msword|vnd\.(ms-|openxmlformats-))|text\/)/,
  image: /^image\//,
  video: /^video\//,
  audio: /^audio\//,
  archive: /(zip|compressed|archive|tar|gz|rar|7z)/,
};

function matchesFilterCriteria(file: SerializedFile, criteria: SerializedFilterCriteria): boolean {
  if (criteria.extensions && criteria.extensions.length > 0) {
    const fileExt = file.filename.split(".").pop()?.toLowerCase() ?? "";
    if (!criteria.extensions.some((ext) => ext.toLowerCase() === fileExt)) {
      return false;
    }
  }

  if (criteria.mimeCategories && criteria.mimeCategories.length > 0) {
    const mimeType = file.mimeType.toLowerCase();
    const matchesCategory = criteria.mimeCategories.some((category) => {
      const pattern = MIME_CATEGORY_PATTERNS[category];
      return pattern ? pattern.test(mimeType) : false;
    });
    if (!matchesCategory) {
      return false;
    }
  }

  // Logical AND across tag ids, mirroring the backend filter.
  if (criteria.tagIds && criteria.tagIds.length > 0) {
    const fileTagIdSet = new Set(file.tagIds);
    if (!criteria.tagIds.every((tagId) => fileTagIdSet.has(tagId))) {
      return false;
    }
  }

  if (criteria.sizeMinBytes !== undefined && file.sizeBytes < criteria.sizeMinBytes) {
    return false;
  }
  if (criteria.sizeMaxBytes !== undefined && file.sizeBytes > criteria.sizeMaxBytes) {
    return false;
  }

  if (criteria.ownerIds && criteria.ownerIds.length > 0) {
    if (!criteria.ownerIds.includes(file.ownerId)) {
      return false;
    }
  }

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

const selectFilesMap = (state: RootState) => state.files.files;
const selectCurrentFolderId = (state: RootState) => state.files.filters.folderId;
const selectViewScope = (state: RootState) => state.files.filters.viewScope;
const selectActiveFilterCriteria = (state: RootState) => state.files.activeFilter.criteria;
const selectCurrentUserId = (state: RootState) => state.auth.user?.id;
const selectFilesTreePersonal = (state: RootState) => state.filesTree.tree.personal;
const selectFilesTreeOrganization = (state: RootState) => state.filesTree.tree.organization;
const selectFilesTreeShared = (state: RootState) => state.filesTree.tree.shared;

export const selectAllFiles = createSelector([selectFilesMap], (filesMap): SerializedFile[] =>
  Object.values(filesMap),
);

export const selectFilesForCurrentFolder = createSelector(
  [selectAllFiles, selectCurrentFolderId],
  (files, folderId) => {
    if (folderId) {
      return files.filter((f) => f.folderId === folderId);
    }
    return files.filter((f) => !f.folderId);
  },
);

export const selectFilesForCurrentFolderAndScope = createSelector(
  [
    selectAllFiles,
    selectCurrentFolderId,
    selectViewScope,
    selectActiveFilterCriteria,
    selectCurrentUserId,
  ],
  (files, folderId, viewScope, activeFilterCriteria, userId) => {
    let filtered = files.filter((f) => !f.isDeleted);

    if (activeFilterCriteria) {
      filtered = filtered.filter((f) => matchesFilterCriteria(f, activeFilterCriteria));
      // When a filter is active, "all" collapses to root.
      if (folderId === "all" || !folderId) {
        filtered = filtered.filter((f) => !f.folderId);
      } else {
        filtered = filtered.filter((f) => f.folderId === folderId);
      }
    } else {
      // Shared With Me shows every shared file regardless of folder navigation.
      if (viewScope === "shared") {
        filtered = filtered.filter((f) =>
          userId
            ? bucketForContent({
                ownerId: f.ownerId,
                accessMode: f.accessMode,
                currentUserId: userId,
              }) === "shared"
            : false,
        );
        return filtered;
      }

      if (folderId === "all") {
        // no folder filter
      } else if (folderId) {
        filtered = filtered.filter((f) => f.folderId === folderId);
      } else {
        filtered = filtered.filter((f) => !f.folderId);
      }
    }

    if (userId) {
      if (viewScope === "shared") {
        filtered = filtered.filter(
          (f) =>
            bucketForContent({
              ownerId: f.ownerId,
              accessMode: f.accessMode,
              currentUserId: userId,
            }) === "shared",
        );
      } else if (viewScope === "personal") {
        filtered = filtered.filter(
          (f) =>
            bucketForContent({
              ownerId: f.ownerId,
              accessMode: f.accessMode,
              currentUserId: userId,
            }) === "personal",
        );
      } else if (viewScope === "organization") {
        filtered = filtered.filter(
          (f) =>
            bucketForContent({
              ownerId: f.ownerId,
              accessMode: f.accessMode,
              currentUserId: userId,
            }) === "organization",
        );
      }
    }

    return filtered;
  },
);

export const selectActiveFiles = createSelector([selectAllFiles], (files) =>
  files.filter((f) => !f.isDeleted),
);

export const selectDeletedFiles = createSelector([selectAllFiles], (files) =>
  files.filter((f) => f.isDeleted),
);

export const selectAllTreeNodes = createSelector(
  [selectFilesTreePersonal, selectFilesTreeOrganization, selectFilesTreeShared],
  (personal, organization, shared) => [...personal, ...organization, ...shared],
);

/** Walks each matching file's folder chain up to the root and marks every ancestor. */
function collectFolderIdsWithMatches(
  matchingFiles: SerializedFile[],
  treeNodes: SerializedTreeNode[],
): Set<string> {
  const result = new Set<string>();

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

function findFoldersWithParent(
  nodes: SerializedTreeNode[],
  parentId: string | null,
): SerializedTreeNode[] {
  const result: SerializedTreeNode[] = [];

  for (const node of nodes) {
    if (node.isFolder) {
      const nodeParentId = node.parentId || null;
      if (nodeParentId === parentId) {
        result.push(node);
      }
      if (node.children) {
        result.push(...findFoldersWithParent(node.children, parentId));
      }
    }
  }

  return result;
}

export const selectSubfoldersForCurrentFolder = createSelector(
  [selectAllTreeNodes, selectCurrentFolderId, selectActiveFilterCriteria, selectAllFiles],
  (treeNodes, folderId, activeFilterCriteria, allFiles) => {
    const parentId = activeFilterCriteria && folderId === "all" ? null : folderId;
    const folders = findFoldersWithParent(treeNodes, parentId);

    if (!activeFilterCriteria) {
      return folders;
    }

    const matchingFiles = allFiles.filter(
      (f) => !f.isDeleted && matchesFilterCriteria(f, activeFilterCriteria),
    );
    const relevantIds = collectFolderIdsWithMatches(matchingFiles, treeNodes);
    return folders.filter((f) => relevantIds.has(f.id));
  },
);
