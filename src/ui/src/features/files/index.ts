/**
 * Files Feature - Public Exports
 *
 * This is the main entry point for the files feature.
 * Import from '@/features/files' to access public API.
 */

// Pages
export { FilesPage } from '@/features/files/pages/FilesPage';
export { FiltersPage } from '@/features/files/pages/FiltersPage';
export { FilesTagsPage } from '@/features/files/pages/FilesTagsPage';

// Components
export { FilesLayout } from '@/features/files/components/FilesLayout';
export { FilesSidebar } from '@/features/files/components/sidebar/FilesSidebar';
export { FilesList } from '@/features/files/components/list/FilesList';
export { UploadDropzone } from '@/features/files/components/upload/UploadDropzone';
export { UploadPanel } from '@/features/files/components/upload/UploadPanel';
export { FileViewerModal } from '@/features/files/components/viewer';

// Store
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
    addToQueue,
    removeFromQueue,
    startUpload,
    updateProgress,
    setCompleting,
    completeUpload,
    failUpload,
    abortUpload,
    retryUpload,
    clearCompleted,
    clearFailed,
    toggleUploadPanel,
    setShowUploadPanel,
    clearUploads,
} from '@/features/files/store';
export type { UploadItem } from '@/features/files/store';

export {
    selectAllFiles,
    selectFilesForCurrentFolder,
    selectActiveFiles,
    selectDeletedFiles,
    selectAllTreeNodes,
    selectActiveUploadsArray,
    selectTotalPendingUploads,
} from '@/features/files/store';

// Hooks
export { useUploadProcessor } from '@/features/files/hooks/useUploadProcessor';
export { useSavedFilters } from '@/features/files/hooks/useSavedFilters';
export { useApplyFilter } from '@/features/files/hooks/useApplyFilter';

export { filesApi } from '@/features/files/api/filesApi';
export { savedFiltersApi } from '@/features/files/api/savedFiltersApi';

// Saved Filters Store
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

// Filter Components
export { FiltersDashboard, FilterCard, FilterBuilder } from '@/features/files/components/filters';

// Viewer Store
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

// Blob Cache (for clearing on logout)
export { clearBlobCache } from '@/features/files/components/viewer/hooks/blobCache';

// Image Editor
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

// Image Editor Components
export { ImageEditor } from '@/features/files/components/viewer/editor';

// Image Editor Hook
export { useImageEditor } from '@/features/files/hooks/useImageEditor';
