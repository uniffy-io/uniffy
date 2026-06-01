import { useState, useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { filesApi } from '@/features/files/api/filesApi';
import { enqueueFileUploads } from '@/features/files/upload/enqueueFileUploads';
import { fetchFilesTree } from '@/features/files/store/filesTreeSlice';
import { resolveUploadAccessMode } from '@/features/files/utils/resolveUploadAccessMode';
import type { ScanResult, FolderTreeStructure } from '@/features/files/utils/folderScanner';

interface FolderMapping {
    [relativePath: string]: string;
}

interface ProtoFolderNode {
    name: string;
    children: ProtoFolderNode[];
}

function filterTree(
    tree: FolderTreeStructure[],
    excludedPaths: Set<string>,
    parentPath: string,
): FolderTreeStructure[] {
    const result: FolderTreeStructure[] = [];
    for (const node of tree) {
        const path = parentPath ? `${parentPath}/${node.name}` : node.name;
        if (excludedPaths.has(path)) continue;
        result.push({
            ...node,
            children: filterTree(node.children, excludedPaths, path),
            files: node.files.filter((f) => !excludedPaths.has(`${path}/${f.name}`)),
        });
    }
    return result;
}

function treeToProto(tree: FolderTreeStructure[]): ProtoFolderNode[] {
    return tree.map((node) => ({
        name: node.name,
        children: treeToProto(node.children),
    }));
}

function buildFolderMapping(
    created: Array<{ id: string; name: string; path: string; parentId?: string }>,
): FolderMapping {
    const mapping: FolderMapping = {};
    for (const folder of created) {
        mapping[folder.path] = folder.id;
    }
    return mapping;
}

function getParentPath(filePath: string): string {
    const parts = filePath.split('/');
    if (parts.length <= 1) return '';
    return parts.slice(0, -1).join('/');
}

export function useFolderUpload() {
    const dispatch = useAppDispatch();
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const viewScope = useAppSelector((state) => state.files.filters.viewScope);
    const folders = useAppSelector((state) => state.filesTree.folders);

    const [scanResult, setScanResult] = useState<ScanResult | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [targetFolderId, setTargetFolderId] = useState<string | undefined>(undefined);

    const openConfirmDialog = useCallback((result: ScanResult, folderId?: string) => {
        setScanResult(result);
        setTargetFolderId(folderId);
        setShowConfirm(true);
    }, []);

    const cancelUpload = useCallback(() => {
        setShowConfirm(false);
        setScanResult(null);
    }, []);

    const confirmUpload = useCallback(async (excludedPaths: Set<string>) => {
        if (!scanResult || !organizationId) return;

        setShowConfirm(false);
        setUploading(true);

        const parentFolder = targetFolderId ? folders[targetFolderId] : undefined;
        const accessMode = resolveUploadAccessMode(viewScope, parentFolder);

        try {
            const includedFiles = excludedPaths.size > 0
                ? scanResult.files.filter((f) => !excludedPaths.has(f.path))
                : scanResult.files;

            const includedTree = excludedPaths.size > 0
                ? filterTree(scanResult.tree, excludedPaths, '')
                : scanResult.tree;

            let folderMapping: FolderMapping = {};

            if (includedTree.length > 0) {
                try {
                    const response = await filesApi.createFolderTree({
                        organizationId,
                        parentFolderId: targetFolderId,
                        tree: treeToProto(includedTree),
                        accessMode,
                    });

                    folderMapping = buildFolderMapping(
                        response.folders.map((f) => ({
                            id: f.id,
                            name: f.name,
                            path: f.path,
                            parentId: f.parentId,
                        }))
                    );

                    dispatch(fetchFilesTree({ includeFiles: false }));
                } catch (error) {
                    console.error('Failed to create folder tree:', error);
                }
            }

            const uploadInputs = includedFiles.map((scannedFile) => {
                const parentPath = getParentPath(scannedFile.path);
                const folderId = folderMapping[parentPath] || targetFolderId;

                return {
                    file: scannedFile.file,
                    filename: scannedFile.file.name,
                    mimeType: scannedFile.file.type || 'application/octet-stream',
                    organizationId,
                    context: 'files' as const,
                    folderId,
                    accessMode,
                };
            });

            if (uploadInputs.length > 0) {
                enqueueFileUploads(uploadInputs, dispatch);
            }
        } finally {
            setUploading(false);
            setScanResult(null);
        }
    }, [scanResult, organizationId, targetFolderId, viewScope, folders, dispatch]);

    return {
        scanResult,
        showConfirm,
        uploading,
        openConfirmDialog,
        cancelUpload,
        confirmUpload,
    };
}
