import { useEffect, useState, useCallback, useRef } from 'react';
import { useSearchParams, useParams } from 'react-router-dom';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { useShortcutHandler } from '@/features/settings';
import { AppHeader } from '@/components/layout/AppHeader';
import { FilesLayout } from '@/features/files/components/FilesLayout';
import { FilesSidebar } from '@/features/files/components/sidebar/FilesSidebar';
import { FilesList } from '@/features/files/components/list/FilesList';
import { FolderUploadConfirmDialog } from '@/features/files/components/FolderUploadConfirmDialog';
import { FileDetailsPanel } from '@/features/files/components/details';
import { useFolderUpload } from '@/features/files/hooks/useFolderUpload';
import { scanInputFiles, isFolderUploadSupported } from '@/features/files/utils/folderScanner';
import { resolveUploadAccessMode } from '@/features/files/utils/resolveUploadAccessMode';
import { initializeFilesData, setFolderId, setDetailsPanelOpen, toggleSidebar } from '@/features/files/store/filesSlice';
import { fetchFilesTree, setSelectedFolder, createFolder } from '@/features/files/store/filesTreeSlice';
import { selectFilesForCurrentFolderAndScope, selectAllFiles } from '@/features/files/store/selectors';
import { openViewer } from '@/features/files/store/viewerSlice';
import { enqueueFileUploads } from '@/features/files/upload/enqueueFileUploads';
import { filesApi } from '@/features/files/api/filesApi';
import { downloadAsArchive, type FileDownloadItem } from '@/features/files/utils/archiveDownload';
import { useContentAccessRefetch } from '@/features/notifications/hooks/useContentAccessRefetch';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';

const FILE_CONTENT_TYPES = [ContentType.FILE, ContentType.FOLDER];

export function FilesPage() {
    useDocumentTitle('Files');

    const dispatch = useAppDispatch();
    const { fileId: urlFileId } = useParams<{ fileId?: string }>();
    const [searchParams] = useSearchParams();

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

    const files = useAppSelector(selectFilesForCurrentFolderAndScope);
    const allFiles = useAppSelector(selectAllFiles);

    const currentFile = currentFileId ? filesMap[currentFileId] : null;

    const viewerIsOpen = useAppSelector((state) => state.fileViewer.isOpen);

    const showSidebar = useAppSelector((state) => state.files.sidebarOpen);

    const [isDownloading, setIsDownloading] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);

    const folderUploadSupported = isFolderUploadSupported();
    const {
        scanResult: folderScanResult,
        showConfirm: showFolderConfirm,
        openConfirmDialog: openFolderConfirm,
        cancelUpload: cancelFolderUpload,
        confirmUpload: confirmFolderUpload,
    } = useFolderUpload();

    // Latches so a deep link only opens the viewer once.
    const deepLinkHandledRef = useRef(false);

    useEffect(() => {
        if (organizationId) {
            dispatch(initializeFilesData());
            dispatch(fetchFilesTree({ includeFiles: false }));
        }
    }, [dispatch, organizationId]);

    // Refetch files when viewScope changes
    useEffect(() => {
        if (organizationId) {
            dispatch(initializeFilesData({ forceRefresh: true }));
        }
    }, [dispatch, organizationId, viewScope]);

    // A file/folder shared with this user or flipped to OPEN_TO_ORG won't be in
    // the loaded list/tree; refresh both when access changes.
    useContentAccessRefetch(
        FILE_CONTENT_TYPES,
        useCallback(() => {
            dispatch(initializeFilesData({ forceRefresh: true }));
            dispatch(fetchFilesTree({ includeFiles: false }));
        }, [dispatch]),
    );

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
            } catch {
                // failDownload was dispatched by downloadAsArchive
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

    const handleUploadFolder = useCallback(() => {
        if (!canUpload) return;
        folderInputRef.current?.click();
    }, [canUpload]);

    const handleFolderInputChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const selected = e.target.files;
            if (!selected || selected.length === 0) return;

            const result = scanInputFiles(selected);
            openFolderConfirm(result, currentFolderId ?? undefined);

            // Reset so the same folder can be re-selected
            e.target.value = '';
        },
        [openFolderConfirm, currentFolderId]
    );

    // Handle file input change
    const handleFileInputChange = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const selectedFiles = e.target.files;
            if (selectedFiles && selectedFiles.length > 0 && organizationId) {
                const fileArray = Array.from(selectedFiles);
                const parentFolder = currentFolderId ? folders[currentFolderId] : undefined;
                const accessMode = resolveUploadAccessMode(viewScope, parentFolder);

                enqueueFileUploads(
                    fileArray.map((file) => ({
                        file,
                        filename: file.name,
                        mimeType: file.type || 'application/octet-stream',
                        organizationId,
                        context: 'files' as const,
                        folderId: currentFolderId ?? undefined,
                        accessMode,
                    })),
                    dispatch
                );
            }
            // Reset input so same file can be selected again
            e.target.value = '';
        },
        [dispatch, organizationId, currentFolderId, folders, viewScope]
    );

    // Handle create folder from context menu
    const handleCreateFolder = useCallback(async (): Promise<string | undefined> => {
        try {
            const result = await dispatch(
                createFolder({
                    name: 'New Folder',
                    parentId: currentFolderId ?? undefined,
                })
            ).unwrap();
            return result.id;
        } catch {
            // error toast is shown by errorToastMiddleware
            return undefined;
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
                sidebar={<FilesSidebar onToggleSidebar={handleToggleSidebar} onUpload={handleUpload} onUploadFolder={canUpload && folderUploadSupported ? handleUploadFolder : undefined} />}
                content={
                    <FilesList
                        files={files}
                        allFiles={allFiles}
                        loading={loading}
                        onDownload={handleDownload}
                        onBulkDownload={handleBulkDownload}
                        onUpload={handleUpload}
                        onUploadFolder={canUpload && folderUploadSupported ? handleUploadFolder : undefined}
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
            <input
                ref={folderInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleFolderInputChange}
                {...{ webkitdirectory: 'true', directory: 'true' } as React.InputHTMLAttributes<HTMLInputElement>}
            />

            <FolderUploadConfirmDialog
                open={showFolderConfirm}
                scanResult={folderScanResult}
                onConfirm={confirmFolderUpload}
                onCancel={cancelFolderUpload}
            />
        </>
    );
}

