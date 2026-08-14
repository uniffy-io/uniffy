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
} from "@/features/files/store/filesSlice";
export type { SerializedFile } from "@/features/files/store/filesThunks";

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
} from "@/features/files/store/filesTreeSlice";
export type {
  FilesTreeState,
  SerializedTreeNode,
  SerializedFolder,
} from "@/features/files/store/filesTreeSlice";
export type {
  SerializedTreeNode as TreeNode,
  SerializedFolder as Folder,
} from "@/features/files/store/filesTreeThunks";

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
} from "@/features/files/store/uploadSlice";
export type { DownloadItem, TrayView } from "@/features/files/store/uploadSlice";

export {
  selectAllFiles,
  selectFilesForCurrentFolder,
  selectSubfoldersForCurrentFolder,
  selectActiveFiles,
  selectDeletedFiles,
  selectAllTreeNodes,
} from "@/features/files/store/selectors";

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
} from "@/features/files/store/savedFiltersSlice";
export type {
  SerializedSavedFilter,
  SerializedFilterCriteria,
  SerializedIconValue,
} from "@/features/files/store/savedFiltersSlice";

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
} from "@/features/files/store/viewerSlice";

export { openViewerWithFetch } from "@/features/files/store/viewerThunks";

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
} from "@/features/files/store/imageEditorSlice";
export type { EditorHistoryEntry, CropRect } from "@/features/files/store/imageEditorSlice";
