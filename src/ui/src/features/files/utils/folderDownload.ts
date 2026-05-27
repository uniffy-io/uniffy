import type { SerializedTreeNode } from '@/features/files/store/filesTreeThunks';

export interface FileWithPath {
    fileId: string;
    /** Full archive path including filename (e.g. "Folder/Sub/file.txt"). */
    path: string;
}

export interface FolderContents {
    files: FileWithPath[];
    totalCount: number;
}

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

interface FileInfo {
    id: string;
    filename: string;
    folderId?: string;
}

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

    for (const folderId of folderIds) {
        const folderNode = findNodeById(allNodes, folderId);
        if (!folderNode || !folderNode.isFolder) continue;

        const allFolderIds = new Set(collectSubfolderIds(folderNode));

        const pathMap: Record<string, string> = {};
        pathMap[folderNode.id] = folderNode.name;

        if (folderNode.children) {
            const childPaths = buildFolderPathMap(folderNode.children, folderNode.name);
            Object.assign(pathMap, childPaths);
        }

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

    const folderFiles = collectFilesFromFolders(folderIds, tree, allFiles);
    for (const file of folderFiles) {
        if (!addedFileIds.has(file.fileId)) {
            result.push(file);
            addedFileIds.add(file.fileId);
        }
    }

    return result;
}

export function createFileInfoArray(
    files: Record<string, { id: string; filename: string; folderId?: string }>
): FileInfo[] {
    return Object.values(files);
}
