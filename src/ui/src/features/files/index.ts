export { FilesPage } from '@/features/files/pages/FilesPage';
export { FiltersPage } from '@/features/files/pages/FiltersPage';
export { FilesTrashPage } from '@/features/files/pages/FilesTrashPage';

export {
    trashReducer,
    fetchTrash,
    setTrashFolderId,
    removeTrashFile,
    removeTrashFolder,
    clearTrash,
} from '@/features/files/store/trashSlice';

export { FilesLayout } from '@/features/files/components/FilesLayout';
export { FilesSidebar } from '@/features/files/components/sidebar/FilesSidebar';
export { FilesList } from '@/features/files/components/list/FilesList';
export { UploadDropzone } from '@/features/files/components/upload/UploadDropzone';
export { UploadTray } from '@/features/files/components/upload/UploadTray';
export { FileViewerModal } from '@/features/files/components/viewer';

export {
    filesReducer,
    setFiles,
    setFile,
    removeFile,
    setCurrentFile,
    setLoading,
    setLoadingFileId,
    setError,
    clearError,
    setSearchQuery,
    setSortBy,
    setSortOrder,
    setShowDeleted,
    setFolderId,
    setActiveFilter,
    clearActiveFilter,
    setPagination,
    setViewMode,
    clearFiles,
    fetchFiles,
    fetchFile,
    updateFile,
    deleteFile,
    restoreFile,
    initializeFilesData,
} from '@/features/files/store';
export type { SerializedFile } from '@/features/files/store';

export {
    filesTreeReducer,
    toggleNodeExpanded,
    expandAll,
    collapseAll,
    setSelectedFolder,
    clearTree,
    fetchFilesTree,
    createFolder,
    updateFolder,
    deleteFolder as deleteFolderThunk,
} from '@/features/files/store';
export type { FilesTreeState, SerializedTreeNode, SerializedFolder } from '@/features/files/store';

export {
    uploadReducer,
    setUploadRecords,
    setTrayView,
    startDownload,
    updateDownloadProgress,
    setDownloadArchiving,
    completeDownload,
    failDownload,
    clearCompletedDownloads,
    clearUploads,
} from '@/features/files/store';
export type { DownloadItem, TrayView } from '@/features/files/store';

export {
    selectAllFiles,
    selectFilesForCurrentFolder,
    selectActiveFiles,
    selectDeletedFiles,
    selectAllTreeNodes,
} from '@/features/files/store';

export { useSavedFilters } from '@/features/files/hooks/useSavedFilters';
export { useApplyFilter } from '@/features/files/hooks/useApplyFilter';

export { filesApi } from '@/features/files/api/filesApi';
export { savedFiltersApi } from '@/features/files/api/savedFiltersApi';
export { attachmentsApi } from '@/features/files/api/attachmentsApi';

export {
    savedFiltersReducer,
    fetchSavedFilters,
    createSavedFilter,
    updateSavedFilter,
    deleteSavedFilter,
    clearSavedFilters,
    selectSavedFilters,
    selectSavedFiltersArray,
    selectUserFilters,
    selectPresetFilters,
    selectSavedFiltersLoading,
    selectSavedFiltersError,
} from '@/features/files/store';
export type { SerializedSavedFilter, SerializedFilterCriteria } from '@/features/files/store';

export { FiltersDashboard, FilterCard, FilterBuilder } from '@/features/files/components/filters';

export {
    viewerReducer,
    openViewer,
    closeViewer,
    setFileData,
    nextFile,
    previousFile,
    toggleFullscreen,
    setFullscreen,
    setPlaying,
    togglePlay,
    setCurrentTime,
    setDuration,
    setVolume,
    setMuted,
    toggleMute,
    setZoom,
    setPan,
    setRotation,
    resetImageView,
    setPage,
    setTotalPages,
    setPdfZoom,
    setViewerLoading,
    setViewerError,
    openViewerWithFetch,
} from '@/features/files/store';

export { clearBlobCache } from '@/features/files/components/viewer/hooks/blobCache';

export {
    imageEditorReducer,
    enterEditMode,
    exitEditMode,
    rotateRight,
    rotateLeft,
    toggleFlipH,
    toggleFlipV,
    setBrightness,
    commitBrightness,
    setContrast,
    commitContrast,
    toggleCropTool,
    setCropActive,
    setCropRect,
    applyCrop,
    cancelCrop,
    undo,
    redo,
    resetToOriginal,
    openSaveDialog,
    closeSaveDialog,
    setSaving,
    setSaveError,
    selectIsEditing,
    selectCanUndo,
    selectCanRedo,
    selectHasChanges,
} from '@/features/files/store';
export type { EditorHistoryEntry, CropRect } from '@/features/files/store';

export { ImageEditor } from '@/features/files/components/viewer/editor';

export { useImageEditor } from '@/features/files/hooks/useImageEditor';
