/**
 * Files Page Component
 *
 * Main page for file management with sidebar, file list, and upload functionality.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { AppHeader } from '@/components/layout/AppHeader';
import { FilesLayout } from '../components/FilesLayout';
import { FilesSidebar } from '../components/sidebar/FilesSidebar';
import { FilesList } from '../components/list/FilesList';
import { UploadPanel } from '../components/upload/UploadPanel';
import { useUploadProcessor } from '../hooks/useUploadProcessor';
import { SharingDialog } from '@/features/sharing';
import { initializeFilesData, setFolderId } from '../store/filesSlice';
import { fetchFilesTree, setSelectedFolder, createFolder } from '../store/filesTreeSlice';
import { selectFilesForCurrentFolderAndScope, selectAllFiles } from '../store/selectors';
import { addToQueue } from '../store/uploadSlice';
import { storeFile } from '../utils/fileStore';
import { filesApi } from '../api/filesApi';
import { downloadAsArchive, type FileDownloadItem } from '../utils/archiveDownload';
import { VisibilityScope } from '@/gen/common/v1/common_pb';

export function FilesPage() {
    useDocumentTitle('Files');

    // Process upload queue
    useUploadProcessor();

    const dispatch = useAppDispatch();
    const [searchParams] = useSearchParams();

    // Redux state
    const isZenMode = useAppSelector((state) => state.zenMode.isActive);
    const currentFolderId = useAppSelector((state) => state.files.filters.folderId);
    const viewScope = useAppSelector((state) => state.files.filters.viewScope);
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const folderTree = useAppSelector((state) => state.filesTree.tree);
    const folders = useAppSelector((state) => state.filesTree.folders);
    const loading = useAppSelector((state) => state.files.loading);

    // selectFilesForCurrentFolderAndScope handles:
    // - Folder filtering (currentFolderId or root)
    // - ViewScope filtering (personal/shared/organization/all)
    const files = useAppSelector(selectFilesForCurrentFolderAndScope);
    const allFiles = useAppSelector(selectAllFiles);

    // Local state
    const [showSidebar, setShowSidebar] = useState(true);
    const [isDownloading, setIsDownloading] = useState<string | null>(null);

    // File input ref for upload
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Initialize data on mount
    useEffect(() => {
        if (organizationId) {
            dispatch(initializeFilesData());
            dispatch(fetchFilesTree({ includeFiles: false }));
        }
    }, [dispatch, organizationId]);

    // Refetch files when viewScope changes
    useEffect(() => {
        if (organizationId) {
            console.log('[FilesPage] ViewScope changed, refetching files for scope:', viewScope);
            dispatch(initializeFilesData({ forceRefresh: true }));
        }
    }, [dispatch, organizationId, viewScope]);

    // Handle folder from URL
    useEffect(() => {
        const folderId = searchParams.get('folder');
        if (folderId !== currentFolderId) {
            dispatch(setFolderId(folderId));
            dispatch(setSelectedFolder(folderId));
        }
    }, [searchParams, dispatch, currentFolderId]);

    // Handle file download
    const handleDownload = useCallback(
        async (fileId: string) => {
            if (!organizationId || isDownloading) return;

            setIsDownloading(fileId);
            try {
                // Stream download from backend
                const chunks: Uint8Array<ArrayBuffer>[] = [];
                let filename = 'download';
                let mimeType = 'application/octet-stream';

                for await (const chunk of filesApi.downloadFile({ fileId, organizationId })) {
                    // First chunk has metadata
                    if (chunk.filename) filename = chunk.filename;
                    if (chunk.mimeType) mimeType = chunk.mimeType;

                    chunks.push(chunk.data as Uint8Array<ArrayBuffer>);
                }

                // Combine chunks and trigger download
                const blob = new Blob(chunks, { type: mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (error) {
                console.error('Download failed:', error);
            } finally {
                setIsDownloading(null);
            }
        },
        [organizationId, isDownloading]
    );

    // Handle bulk download (multiple files as archive, with optional folder structure)
    const handleBulkDownload = useCallback(
        async (items: FileDownloadItem[]) => {
            if (!organizationId || items.length === 0) return;

            try {
                // Generate archive name based on folder or default
                const archiveName = currentFolderId
                    ? `files-${new Date().toISOString().slice(0, 10)}`
                    : `uniffy-files-${new Date().toISOString().slice(0, 10)}`;

                await downloadAsArchive(items, organizationId, archiveName, dispatch);
            } catch (error) {
                console.error('Bulk download failed:', error);
            }
        },
        [organizationId, currentFolderId, dispatch]
    );

    // Toggle sidebar
    const handleToggleSidebar = useCallback(() => {
        setShowSidebar((prev) => !prev);
    }, []);

    // Uploads should be disabled in "Shared With Me" view
    const canUpload = viewScope !== 'shared';

    // Handle upload from context menu
    const handleUpload = useCallback(() => {
        if (!canUpload) return;
        fileInputRef.current?.click();
    }, [canUpload]);

    // Handle file input change
    const handleFileInputChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const selectedFiles = e.target.files;
            if (selectedFiles && selectedFiles.length > 0) {
                const fileArray = Array.from(selectedFiles);

                // Determine visibility - inherit from parent folder if inside one
                let visibility = VisibilityScope.PRIVATE;
                if (currentFolderId && folders[currentFolderId]) {
                    // Get parent folder's visibility directly from folders map
                    visibility = folders[currentFolderId].visibility;
                } else {
                    // No parent folder - use visibility based on current view scope
                    // (same logic as handleCreateFolder)
                    if (viewScope === 'organization') {
                        visibility = VisibilityScope.ORGANIZATION;
                    } else if (viewScope === 'shared') {
                        // Should not happen since upload is disabled in shared view
                        visibility = VisibilityScope.PRIVATE;
                    } else {
                        visibility = VisibilityScope.PRIVATE;
                    }
                }

                // Create upload items and store File objects
                const uploadItems = fileArray.map((file) => {
                    const id = `upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                    storeFile(id, file);
                    return {
                        id,
                        filename: file.name,
                        mimeType: file.type || 'application/octet-stream',
                        totalSize: file.size,
                        folderId: currentFolderId ?? undefined,
                        visibility,
                        totalChunks: 0,
                        chunkSize: 0,
                    };
                });

                dispatch(addToQueue(uploadItems));
            }
            // Reset input so same file can be selected again
            e.target.value = '';
        },
        [dispatch, currentFolderId, folders, viewScope]
    );

    // Handle create folder from context menu
    const handleCreateFolder = useCallback(async () => {
        try {
            // Determine visibility - inherit from parent folder if inside one
            let visibility = VisibilityScope.PRIVATE;
            if (currentFolderId && folders[currentFolderId]) {
                // Get parent folder's visibility directly from folders map
                visibility = folders[currentFolderId].visibility;
            } else {
                // No parent folder - use visibility based on current view scope
                if (viewScope === 'organization') {
                    visibility = VisibilityScope.ORGANIZATION;
                } else if (viewScope === 'shared') {
                    visibility = VisibilityScope.GROUP;
                } else {
                    visibility = VisibilityScope.PRIVATE;
                }
            }

            await dispatch(
                createFolder({
                    name: 'New Folder',
                    parentId: currentFolderId ?? undefined,
                    visibility,
                })
            ).unwrap();
        } catch (err) {
            console.error('Failed to create folder:', err);
        }
    }, [dispatch, currentFolderId, folders, viewScope]);

    return (
        <>
            <AppHeader />
            <FilesLayout
                showSidebar={!isZenMode && showSidebar}
                onToggleSidebar={handleToggleSidebar}
                sidebar={<FilesSidebar onToggleSidebar={handleToggleSidebar} onUpload={handleUpload} />}
                content={
                    <FilesList
                        files={files}
                        allFiles={allFiles}
                        loading={loading}
                        onDownload={handleDownload}
                        onBulkDownload={handleBulkDownload}
                        onUpload={handleUpload}
                        onCreateFolder={handleCreateFolder}
                        folderTree={folderTree}
                    />
                }
            />

            {/* Hidden file input for upload */}
            <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFileInputChange}
            />

            {/* Upload progress panel */}
            <UploadPanel />

            {/* Sharing dialog */}
            <SharingDialog />
        </>
    );
}

// Default export for lazy loading
export default FilesPage;
