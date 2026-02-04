/**
 * Folder Download Utility
 *
 * Recursively collects files from folders and builds path mappings
 * for preserving folder structure in zip archives.
 */

import type { SerializedTreeNode } from '@/features/files/store/filesTreeThunks';

export interface FileWithPath {
    fileId: string;
    path: string; // Full path including filename (e.g., "FolderA/SubFolder/file.txt")
}

export interface FolderContents {
    files: FileWithPath[];
    totalCount: number;
}

/**
 * Find a node by ID in the tree structure.
 */
function findNodeById(
    nodes: SerializedTreeNode[],
    nodeId: string
): SerializedTreeNode | null {
    for (const node of nodes) {
        if (node.id === nodeId) {
            return node;
        }
        if (node.children) {
            const found = findNodeById(node.children, nodeId);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Recursively collect all subfolder IDs from a folder node.
 */
function collectSubfolderIds(node: SerializedTreeNode): string[] {
    const ids: string[] = [];
    if (node.isFolder) {
        ids.push(node.id);
        if (node.children) {
            for (const child of node.children) {
                if (child.isFolder) {
                    ids.push(...collectSubfolderIds(child));
                }
            }
        }
    }
    return ids;
}

/**
 * Build a path mapping for folders: folderId -> "ParentFolder/ChildFolder"
 */
function buildFolderPathMap(
    nodes: SerializedTreeNode[],
    basePath: string = ''
): Record<string, string> {
    const pathMap: Record<string, string> = {};

    for (const node of nodes) {
        if (node.isFolder) {
            const currentPath = basePath ? `${basePath}/${node.name}` : node.name;
            pathMap[node.id] = currentPath;

            if (node.children) {
                const childPaths = buildFolderPathMap(node.children, currentPath);
                Object.assign(pathMap, childPaths);
            }
        }
    }

    return pathMap;
}

/**
 * Interface for file data (minimal for path building).
 */
interface FileInfo {
    id: string;
    filename: string;
    folderId?: string;
}

/**
 * Collect all files from selected folders recursively.
 * Uses the folder tree structure and files store to build proper paths.
 *
 * @param folderIds - Array of selected folder IDs
 * @param tree - The full folder tree structure
 * @param allFiles - All files from the store
 * @returns Files with their paths relative to folder structure
 */
export function collectFilesFromFolders(
    folderIds: string[],
    tree: {
        personal: SerializedTreeNode[];
        shared: SerializedTreeNode[];
        organization: SerializedTreeNode[];
    },
    allFiles: FileInfo[]
): FileWithPath[] {
    const result: FileWithPath[] = [];
    const allNodes = [...tree.personal, ...tree.shared, ...tree.organization];

    // For each selected folder, collect all files
    for (const folderId of folderIds) {
        const folderNode = findNodeById(allNodes, folderId);
        if (!folderNode || !folderNode.isFolder) continue;

        // Get all subfolder IDs (including the folder itself)
        const allFolderIds = new Set(collectSubfolderIds(folderNode));

        // Build path map starting from this folder
        const pathMap: Record<string, string> = {};
        pathMap[folderNode.id] = folderNode.name;

        // Build paths for subfolders
        if (folderNode.children) {
            const childPaths = buildFolderPathMap(folderNode.children, folderNode.name);
            Object.assign(pathMap, childPaths);
        }

        // Find files in any of these folders
        for (const file of allFiles) {
            if (file.folderId && allFolderIds.has(file.folderId)) {
                const folderPath = pathMap[file.folderId] || folderNode.name;
                result.push({
                    fileId: file.id,
                    path: `${folderPath}/${file.filename}`,
                });
            }
        }
    }

    return result;
}

/**
 * Collect files from both selected files and folders.
 * Selected files are placed at the root level.
 * Folder contents preserve their hierarchy.
 *
 * @param fileIds - Directly selected file IDs
 * @param folderIds - Selected folder IDs to expand
 * @param tree - The full folder tree structure
 * @param allFiles - All files from the store (for folder contents and filename lookup)
 * @returns All files with their paths
 */
export function collectAllDownloadFiles(
    fileIds: string[],
    folderIds: string[],
    tree: {
        personal: SerializedTreeNode[];
        shared: SerializedTreeNode[];
        organization: SerializedTreeNode[];
    },
    allFiles: FileInfo[]
): FileWithPath[] {
    const result: FileWithPath[] = [];
    const addedFileIds = new Set<string>();

    // Add directly selected files at root level
    for (const fileId of fileIds) {
        const file = allFiles.find(f => f.id === fileId);
        if (file) {
            result.push({
                fileId,
                path: file.filename,
            });
            addedFileIds.add(fileId);
        }
    }

    // Add files from selected folders with their paths
    const folderFiles = collectFilesFromFolders(folderIds, tree, allFiles);
    for (const file of folderFiles) {
        // Avoid duplicates if a file was also directly selected
        if (!addedFileIds.has(file.fileId)) {
            result.push(file);
            addedFileIds.add(file.fileId);
        }
    }

    return result;
}

/**
 * Create a file info array from the files store.
 */
export function createFileInfoArray(
    files: Record<string, { id: string; filename: string; folderId?: string }>
): FileInfo[] {
    return Object.values(files);
}
