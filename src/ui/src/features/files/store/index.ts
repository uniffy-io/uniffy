/**
 * Files Store Exports
 */

export {
    default as filesReducer,
    setFiles,
    setFile,
    removeFile,
    setCurrentFile,
    setLoading,
    setLoadingFileId,
    setError,
    clearError,
    setSearchQuery,
    setVisibilityFilter,
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
} from './filesSlice';
export type { SerializedFile } from './filesThunks';

export {
    default as filesTreeReducer,
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
} from './filesTreeSlice';
export type { FilesTreeState, SerializedTreeNode, SerializedFolder } from './filesTreeSlice';
export type { SerializedTreeNode as TreeNode, SerializedFolder as Folder } from './filesTreeThunks';

export {
    default as uploadReducer,
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
} from './uploadSlice';
export type { UploadItem } from './uploadSlice';

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
} from './selectors';

// Saved filters
export {
    default as savedFiltersReducer,
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
} from './savedFiltersSlice';
export type { SerializedSavedFilter, SerializedFilterCriteria, SerializedIconValue } from './savedFiltersSlice';
