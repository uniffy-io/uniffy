/**
 * Files Page Component
 *
 * Main page for file management with sidebar, file list, and upload functionality.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { useShortcutHandler } from '@/features/settings';
import { AppHeader } from '@/components/layout/AppHeader';
import { FilesLayout } from '@/features/files/components/FilesLayout';
import { FilesSidebar } from '@/features/files/components/sidebar/FilesSidebar';
import { FilesList } from '@/features/files/components/list/FilesList';
import { UploadPanel } from '@/features/files/components/upload/UploadPanel';
import { FileDetailsPanel } from '@/features/files/components/details';
import { useUploadProcessor } from '@/features/files/hooks/useUploadProcessor';
import { initializeFilesData, setFolderId, setDetailsPanelOpen, toggleSidebar } from '@/features/files/store/filesSlice';
import { fetchFilesTree, setSelectedFolder, createFolder } from '@/features/files/store/filesTreeSlice';
import { selectFilesForCurrentFolderAndScope, selectAllFiles } from '@/features/files/store/selectors';
import { openViewer } from '@/features/files/store/viewerSlice';
import { addToQueue } from '@/features/files/store/uploadSlice';
import { storeFile } from '@/features/files/utils/fileStore';
import { filesApi } from '@/features/files/api/filesApi';
import { downloadAsArchive, type FileDownloadItem } from '@/features/files/utils/archiveDownload';
import { AccessMode } from '@uniffy/proto/common/v1/common_pb';

export function FilesPage() {
    useDocumentTitle('Files');

    // Process upload queue
    useUploadProcessor();

    const dispatch = useAppDispatch();
    const { fileId: urlFileId } = useParams<{ fileId?: string }>();
    const [searchParams] = useSearchParams();

    // Redux state
    const isZenMode = useAppSelector((state) => state.zenMode.isActive);
    const currentFolderId = useAppSelector((state) => state.files.filters.folderId);
    const viewScope = useAppSelector((state) => state.files.filters.viewScope);
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const folderTree = useAppSelector((state) => state.filesTree.tree);
    const folders = useAppSelector((state) => state.filesTree.folders);
    const loading = useAppSelector((state) => state.files.loading);
    const isDetailsPanelOpen = useAppSelector((state) => state.files.isDetailsPanelOpen);
    const currentFileId = useAppSelector((state) => state.files.currentFileId);
    const filesMap = useAppSelector((state) => state.files.files);

    // selectFilesForCurrentFolderAndScope handles:
    // - Folder filtering (currentFolderId or root)
    // - ViewScope filtering (personal/shared/organization/all)
    const files = useAppSelector(selectFilesForCurrentFolderAndScope);
    const allFiles = useAppSelector(selectAllFiles);

    // Get the current file for the details panel
    const currentFile = currentFileId ? filesMap[currentFileId] : null;

    // Viewer state - only used for deep link support
    const viewerIsOpen = useAppSelector((state) => state.fileViewer.isOpen);

    // Sidebar state from Redux (shared across files pages)
    const showSidebar = useAppSelector((state) => state.files.sidebarOpen);

    // Local state
    const [isDownloading, setIsDownloading] = useState<string | null>(null);

    // File input ref for upload
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Track if we've already opened viewer for deep link (prevent re-opening)
    const deepLinkHandledRef = useRef(false);

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

    // Deep link support: Open viewer when navigating directly to /files/:fileId
    // This only runs once on initial load, not when viewer state changes
    useEffect(() => {
        // Only handle deep link once, and only if viewer isn't already open
        if (deepLinkHandledRef.current || viewerIsOpen || !urlFileId || loading) {
            return;
        }

        // Check if file exists in our store
        const file = allFiles.find((f) => f.id === urlFileId);
        if (file) {
            deepLinkHandledRef.current = true;
            // Create playlist from all files
            const playlist = allFiles.map((f) => f.id);
            dispatch(openViewer({ fileId: urlFileId, playlist, fileData: file }));
        }
    }, [urlFileId, loading, allFiles, viewerIsOpen, dispatch]);

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
        dispatch(toggleSidebar());
    }, [dispatch]);

    const handleCloseSidebar = useCallback(() => {
        if (showSidebar) dispatch(toggleSidebar());
    }, [dispatch, showSidebar]);

    const handleCloseDetailPanel = useCallback(() => {
        dispatch(setDetailsPanelOpen(false));
    }, [dispatch]);

    // Keyboard shortcut for toggling sidebar (global shortcut)
    useShortcutHandler('app.toggleSidebar', handleToggleSidebar);

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

                // Determine access mode - inherit from parent folder if inside one
                let accessMode = AccessMode.OWNER_ONLY;
                if (currentFolderId && folders[currentFolderId]) {
                    // Get parent folder's access mode directly from folders map
                    accessMode = folders[currentFolderId].accessMode;
                } else {
                    // No parent folder - use access mode based on current view scope
                    // (same logic as handleCreateFolder)
                    if (viewScope === 'organization') {
                        accessMode = AccessMode.OPEN_TO_ORG;
                    } else if (viewScope === 'shared') {
                        // Should not happen since upload is disabled in shared view
                        accessMode = AccessMode.OWNER_ONLY;
                    } else {
                        accessMode = AccessMode.OWNER_ONLY;
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
                        visibility: accessMode,
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
            await dispatch(
                createFolder({
                    name: 'New Folder',
                    parentId: currentFolderId ?? undefined,
                })
            ).unwrap();
        } catch (err) {
            console.error('Failed to create folder:', err);
        }
    }, [dispatch, currentFolderId]);

    return (
        <>
            <AppHeader />
            <FilesLayout
                showSidebar={!isZenMode && showSidebar}
                showDetailPanel={!isZenMode && isDetailsPanelOpen}
                onToggleSidebar={handleToggleSidebar}
                onCloseSidebar={handleCloseSidebar}
                onCloseDetailPanel={handleCloseDetailPanel}
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
                        onToggleSidebar={handleToggleSidebar}
                        folderTree={folderTree}
                    />
                }
                detailPanel={<FileDetailsPanel file={currentFile} />}
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

            {/* FileViewerModal is now global (in App.tsx), no need to render here */}
        </>
    );
}

