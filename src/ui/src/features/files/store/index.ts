/**
 * Files Store Exports
 */

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
} from '@/features/files/store/filesSlice';
export type { SerializedFile } from '@/features/files/store/filesThunks';

export {
    filesTreeReducer,
    toggleNodeExpanded,
    expandAll,
    collapseAll,
    setSelectedFolder,
    clearTree,
    clearError as clearTreeError,
    fetchFilesTree,
    createFolder,
    updateFolder,
    deleteFolder,
} from '@/features/files/store/filesTreeSlice';
export type { FilesTreeState, SerializedTreeNode, SerializedFolder } from '@/features/files/store/filesTreeSlice';
export type { SerializedTreeNode as TreeNode, SerializedFolder as Folder } from '@/features/files/store/filesTreeThunks';

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
} from '@/features/files/store/uploadSlice';
export type { UploadItem } from '@/features/files/store/uploadSlice';

// Memoized selectors
export {
    selectAllFiles,
    selectFilesForCurrentFolder,
    selectSubfoldersForCurrentFolder,
    selectActiveFiles,
    selectDeletedFiles,
    selectAllTreeNodes,
    selectActiveUploadsArray,
    selectTotalPendingUploads,
} from '@/features/files/store/selectors';

// Saved filters
export {
    savedFiltersReducer,
    fetchSavedFilters,
    createSavedFilter,
    updateSavedFilter,
    deleteSavedFilter,
    clearSavedFilters,
    clearError as clearSavedFiltersError,
    setFilter,
    removeFilter,
    selectSavedFilters,
    selectSavedFiltersArray,
    selectUserFilters,
    selectPresetFilters,
    selectSavedFiltersLoading,
    selectSavedFiltersError,
    selectSavingFilter,
} from '@/features/files/store/savedFiltersSlice';
export type { SerializedSavedFilter, SerializedFilterCriteria, SerializedIconValue } from '@/features/files/store/savedFiltersSlice';

// File viewer
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
    setLoading as setViewerLoading,
    setError as setViewerError,
} from '@/features/files/store/viewerSlice';

// Viewer thunks
export { openViewerWithFetch } from '@/features/files/store/viewerThunks';

// Image editor
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
} from '@/features/files/store/imageEditorSlice';
export type { EditorHistoryEntry, CropRect } from '@/features/files/store/imageEditorSlice';
