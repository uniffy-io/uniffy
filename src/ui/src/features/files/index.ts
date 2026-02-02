/**
 * Files Feature - Public Exports
 *
 * This is the main entry point for the files feature.
 * Import from '@/features/files' to access public API.
 */

// Pages
export { FilesPage } from './pages/FilesPage';
export { FiltersPage } from './pages/FiltersPage';
export { FilesTagsPage } from './pages/FilesTagsPage';

// Components
export { FilesLayout } from './components/FilesLayout';
export { FilesSidebar } from './components/sidebar/FilesSidebar';
export { FilesList } from './components/list/FilesList';
export { UploadDropzone } from './components/upload/UploadDropzone';
export { UploadPanel } from './components/upload/UploadPanel';

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
} from './store';
export type { SerializedFile } from './store';

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
} from './store';
export type { FilesTreeState, SerializedTreeNode, SerializedFolder } from './store';

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
} from './store';
export type { UploadItem } from './store';

// Selectors
export {
    selectAllFiles,
    selectFilesForCurrentFolder,
    selectActiveFiles,
    selectDeletedFiles,
    selectAllTreeNodes,
    selectActiveUploadsArray,
    selectTotalPendingUploads,
} from './store';

// Hooks
export { useUploadProcessor } from './hooks/useUploadProcessor';
export { useSavedFilters } from './hooks/useSavedFilters';
export { useApplyFilter } from './hooks/useApplyFilter';

// API
export { filesApi } from './api/filesApi';
export { savedFiltersApi } from './api/savedFiltersApi';

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
} from './store';
export type { SerializedSavedFilter, SerializedFilterCriteria } from './store';

// Filter Components
export { FiltersDashboard, FilterCard, FilterBuilder } from './components/filters';
