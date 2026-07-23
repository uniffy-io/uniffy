import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import {
    fetchFiles,
    fetchFile,
    updateFile,
    deleteFile,
    restoreFile,
    fetchFileVersions,
    restoreFileVersion,
    initializeFilesData,
    type SerializedFile,
    type SerializedFileVersion,
} from '@/features/files/store/filesThunks';
import type { SerializedFilterCriteria } from '@/features/files/store/savedFiltersSlice';

export type DetailsPanelTab = 'info' | 'metadata' | 'permissions' | 'versions';

const FILES_VIEW_STORAGE_KEY = 'uniffy-files-view';

interface FilesViewSettings {
    viewMode: 'grid' | 'list';
    iconSize: number;
    sortBy: 'filename' | 'updated_at' | 'created_at' | 'size_bytes';
    sortOrder: 'asc' | 'desc';
    activeFilterId: string | null;
    activeFilterName: string | null;
    activeFilterCriteria: SerializedFilterCriteria | null;
}

const VALID_SORT_BY = ['filename', 'updated_at', 'created_at', 'size_bytes'];
const VALID_SORT_ORDER = ['asc', 'desc'];

function loadFilesViewSettings(): FilesViewSettings {
    try {
        const stored = localStorage.getItem(FILES_VIEW_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            return {
                viewMode: parsed.viewMode === 'list' ? 'list' : 'grid',
                iconSize: typeof parsed.iconSize === 'number'
                    ? Math.max(0, Math.min(3, parsed.iconSize))
                    : 1,
                sortBy: VALID_SORT_BY.includes(parsed.sortBy)
                    ? parsed.sortBy
                    : 'updated_at',
                sortOrder: VALID_SORT_ORDER.includes(parsed.sortOrder)
                    ? parsed.sortOrder
                    : 'desc',
                activeFilterId: parsed.activeFilterId ?? null,
                activeFilterName: parsed.activeFilterName ?? null,
                activeFilterCriteria: parsed.activeFilterCriteria ?? null,
            };
        }
    } catch {
        // ignore
    }
    return {
        viewMode: 'grid',
        iconSize: 1,
        sortBy: 'updated_at',
        sortOrder: 'desc',
        activeFilterId: null,
        activeFilterName: null,
        activeFilterCriteria: null,
    };
}

function saveFilesViewSettings(settings: FilesViewSettings): void {
    try {
        localStorage.setItem(
            FILES_VIEW_STORAGE_KEY,
            JSON.stringify(settings),
        );
    } catch {
        // ignore
    }
}

function persistViewState(state: FilesState): void {
    saveFilesViewSettings({
        viewMode: state.viewMode,
        iconSize: state.iconSize,
        sortBy: state.filters.sortBy,
        sortOrder: state.filters.sortOrder,
        activeFilterId: state.activeFilter.id,
        activeFilterName: state.activeFilter.name,
        activeFilterCriteria: state.activeFilter.criteria,
    });
}

interface FilesState {
    files: Record<string, SerializedFile>;
    deletedFileIds: string[];
    currentFileId: string | null;

    isSelectMode: boolean;
    selectedFileIds: string[];
    selectedFolderIds: string[];
    /** Anchor for shift+click range selection. */
    lastSelectedId: string | null;
    lastSelectedType: 'file' | 'folder' | null;

    loading: boolean;
    loadingFileId: string | null;
    savingFile: boolean;

    error: string | null;

    filters: {
        searchQuery: string;
        sortBy: 'filename' | 'updated_at' | 'created_at' | 'size_bytes';
        sortOrder: 'asc' | 'desc';
        showDeleted: boolean;
        /** null = root, "all" = all files */
        folderId: string | null;
        viewScope: 'all' | 'personal' | 'shared' | 'organization';
    };

    activeFilter: {
        id: string | null;
        name: string | null;
        criteria: SerializedFilterCriteria | null;
    };

    pagination: {
        page: number;
        pageSize: number;
        totalCount: number;
        totalPages: number;
    };

    viewMode: 'grid' | 'list';

    /** 0..3 = small, medium, large, xlarge. */
    iconSize: number;

    isDetailsPanelOpen: boolean;
    detailsPanelTab: DetailsPanelTab;

    fileVersions: Record<string, SerializedFileVersion[]>;
    fileVersionsLoading: boolean;

    sidebarOpen: boolean;

    myStorageUsage: {
        usedBytes: number;
        quotaBytes: number | null;
        usagePercent: number;
        fileCount: number;
        loading: boolean;
    };
}

const persistedViewSettings = loadFilesViewSettings();

const initialState: FilesState = {
    files: {},
    deletedFileIds: [],
    currentFileId: null,
    isSelectMode: false,
    selectedFileIds: [],
    selectedFolderIds: [],
    lastSelectedId: null,
    lastSelectedType: null,
    loading: false,
    loadingFileId: null,
    savingFile: false,
    error: null,
    filters: {
        searchQuery: '',
        sortBy: persistedViewSettings.sortBy,
        sortOrder: persistedViewSettings.sortOrder,
        showDeleted: false,
        folderId: null,
        viewScope: 'all',
    },
    activeFilter: {
        id: persistedViewSettings.activeFilterId,
        name: persistedViewSettings.activeFilterName,
        criteria: persistedViewSettings.activeFilterCriteria,
    },
    pagination: {
        page: 1,
        pageSize: 50,
        totalCount: 0,
        totalPages: 0,
    },
    viewMode: persistedViewSettings.viewMode,
    iconSize: persistedViewSettings.iconSize,
    isDetailsPanelOpen: false,
    detailsPanelTab: 'info',
    fileVersions: {},
    fileVersionsLoading: false,
    sidebarOpen: true,
    myStorageUsage: {
        usedBytes: 0,
        quotaBytes: null,
        usagePercent: 0,
        fileCount: 0,
        loading: false,
    },
};

export const filesSlice = createSlice({
    name: 'files',
    initialState,
    reducers: {
        setFiles: (state, action: PayloadAction<SerializedFile[]>) => {
            state.files = {};
            action.payload.forEach((file) => {
                state.files[file.id] = file;
            });
        },

        setFile: (state, action: PayloadAction<SerializedFile>) => {
            state.files[action.payload.id] = action.payload;
        },

        removeFile: (state, action: PayloadAction<string>) => {
            delete state.files[action.payload];
            if (state.currentFileId === action.payload) {
                state.currentFileId = null;
            }
        },

        setCurrentFile: (state, action: PayloadAction<string | null>) => {
            state.currentFileId = action.payload;
        },

        toggleSelectMode: (state) => {
            state.isSelectMode = !state.isSelectMode;
            if (!state.isSelectMode) {
                state.selectedFileIds = [];
                state.selectedFolderIds = [];
            }
        },

        setSelectMode: (state, action: PayloadAction<boolean>) => {
            state.isSelectMode = action.payload;
            if (!action.payload) {
                state.selectedFileIds = [];
                state.selectedFolderIds = [];
            }
        },

        toggleFileSelection: (state, action: PayloadAction<string>) => {
            const fileId = action.payload;
            const index = state.selectedFileIds.indexOf(fileId);
            if (index >= 0) {
                state.selectedFileIds.splice(index, 1);
            } else {
                state.selectedFileIds.push(fileId);
            }
            state.lastSelectedId = fileId;
            state.lastSelectedType = 'file';
            if (state.selectedFileIds.length > 0 || state.selectedFolderIds.length > 0) {
                state.isSelectMode = true;
            }
        },

        toggleFolderSelection: (state, action: PayloadAction<string>) => {
            const folderId = action.payload;
            const index = state.selectedFolderIds.indexOf(folderId);
            if (index >= 0) {
                state.selectedFolderIds.splice(index, 1);
            } else {
                state.selectedFolderIds.push(folderId);
            }
            state.lastSelectedId = folderId;
            state.lastSelectedType = 'folder';
            if (state.selectedFileIds.length > 0 || state.selectedFolderIds.length > 0) {
                state.isSelectMode = true;
            }
        },

        selectFileRange: (state, action: PayloadAction<{ fileIds: string[]; anchorId: string }>) => {
            const { fileIds, anchorId } = action.payload;
            const newSelection = new Set(state.selectedFileIds);
            fileIds.forEach((id) => newSelection.add(id));
            state.selectedFileIds = Array.from(newSelection);
            state.lastSelectedId = anchorId;
            state.lastSelectedType = 'file';
            state.isSelectMode = true;
        },

        selectFolderRange: (state, action: PayloadAction<{ folderIds: string[]; anchorId: string }>) => {
            const { folderIds, anchorId } = action.payload;
            const newSelection = new Set(state.selectedFolderIds);
            folderIds.forEach((id) => newSelection.add(id));
            state.selectedFolderIds = Array.from(newSelection);
            state.lastSelectedId = anchorId;
            state.lastSelectedType = 'folder';
            state.isSelectMode = true;
        },

        selectFiles: (state, action: PayloadAction<string[]>) => {
            state.selectedFileIds = action.payload;
            if (action.payload.length > 0) {
                state.isSelectMode = true;
            }
        },

        selectAllFiles: (state, action: PayloadAction<string[]>) => {
            state.selectedFileIds = action.payload;
            state.isSelectMode = true;
        },

        selectAllFolders: (state, action: PayloadAction<string[]>) => {
            state.selectedFolderIds = action.payload;
            state.isSelectMode = true;
        },

        selectAll: (state, action: PayloadAction<{ fileIds: string[]; folderIds: string[] }>) => {
            state.selectedFileIds = action.payload.fileIds;
            state.selectedFolderIds = action.payload.folderIds;
            state.isSelectMode = true;
        },

        clearSelection: (state) => {
            state.selectedFileIds = [];
            state.selectedFolderIds = [];
            state.lastSelectedId = null;
            state.lastSelectedType = null;
        },

        exitSelectMode: (state) => {
            state.isSelectMode = false;
            state.selectedFileIds = [];
            state.selectedFolderIds = [];
            state.lastSelectedId = null;
            state.lastSelectedType = null;
        },

        setLoading: (state, action: PayloadAction<boolean>) => {
            state.loading = action.payload;
        },

        setLoadingFileId: (state, action: PayloadAction<string | null>) => {
            state.loadingFileId = action.payload;
        },

        setError: (state, action: PayloadAction<string | null>) => {
            state.error = action.payload;
        },

        clearError: (state) => {
            state.error = null;
        },

        setSearchQuery: (state, action: PayloadAction<string>) => {
            state.filters.searchQuery = action.payload;
        },

        setSortBy: (state, action: PayloadAction<'filename' | 'updated_at' | 'created_at' | 'size_bytes'>) => {
            state.filters.sortBy = action.payload;
            persistViewState(state);
        },

        setSortOrder: (state, action: PayloadAction<'asc' | 'desc'>) => {
            state.filters.sortOrder = action.payload;
            persistViewState(state);
        },

        setShowDeleted: (state, action: PayloadAction<boolean>) => {
            state.filters.showDeleted = action.payload;
        },

        setFolderId: (state, action: PayloadAction<string | null>) => {
            state.filters.folderId = action.payload;
        },

        setViewScope: (state, action: PayloadAction<'all' | 'personal' | 'shared' | 'organization'>) => {
            state.filters.viewScope = action.payload;
            state.filters.folderId = null;
        },

        setActiveFilter: (state, action: PayloadAction<{ id: string; name: string; criteria: SerializedFilterCriteria }>) => {
            state.activeFilter = {
                id: action.payload.id,
                name: action.payload.name,
                criteria: action.payload.criteria,
            };
            persistViewState(state);
        },

        clearActiveFilter: (state) => {
            state.activeFilter = {
                id: null,
                name: null,
                criteria: null,
            };
            persistViewState(state);
        },

        setPagination: (state, action: PayloadAction<Partial<FilesState['pagination']>>) => {
            state.pagination = { ...state.pagination, ...action.payload };
        },

        setViewMode: (state, action: PayloadAction<'grid' | 'list'>) => {
            state.viewMode = action.payload;
            persistViewState(state);
        },

        setIconSize: (state, action: PayloadAction<number>) => {
            state.iconSize = Math.max(0, Math.min(3, action.payload));
            persistViewState(state);
        },

        toggleDetailsPanel: (state) => {
            state.isDetailsPanelOpen = !state.isDetailsPanelOpen;
        },

        setDetailsPanelOpen: (state, action: PayloadAction<boolean>) => {
            state.isDetailsPanelOpen = action.payload;
        },

        setDetailsPanelTab: (state, action: PayloadAction<DetailsPanelTab>) => {
            state.detailsPanelTab = action.payload;
        },

        toggleSidebar: (state) => {
            state.sidebarOpen = !state.sidebarOpen;
        },

        setMyStorageUsage: (state, action: PayloadAction<{
            usedBytes: number;
            quotaBytes: number | null;
            usagePercent: number;
            fileCount: number;
        }>) => {
            state.myStorageUsage = {
                ...action.payload,
                loading: false,
            };
        },

        setMyStorageUsageLoading: (state, action: PayloadAction<boolean>) => {
            state.myStorageUsage.loading = action.payload;
        },

        clearFiles: (state) => {
            state.files = {};
            state.deletedFileIds = [];
            state.currentFileId = null;
            state.isSelectMode = false;
            state.selectedFileIds = [];
            state.selectedFolderIds = [];
            state.fileVersions = {};
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchFiles.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchFiles.fulfilled, (state, action) => {
                state.loading = false;
                action.payload.files.forEach((file) => {
                    state.files[file.id] = file;
                });
                state.pagination = {
                    page: action.payload.page,
                    pageSize: action.payload.pageSize,
                    totalCount: action.payload.totalCount,
                    totalPages: action.payload.totalPages,
                };
            })
            .addCase(fetchFiles.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Failed to fetch files';
            });

        builder
            .addCase(fetchFile.pending, (state, action) => {
                state.loadingFileId = action.meta.arg;
            })
            .addCase(fetchFile.fulfilled, (state, action) => {
                state.loadingFileId = null;
                state.files[action.payload.id] = action.payload;
            })
            .addCase(fetchFile.rejected, (state, action) => {
                state.loadingFileId = null;
                state.error = action.payload ?? 'Failed to fetch file';
            });

        builder
            .addCase(updateFile.pending, (state) => {
                state.savingFile = true;
            })
            .addCase(updateFile.fulfilled, (state, action) => {
                state.savingFile = false;
                state.files[action.payload.id] = action.payload;
            })
            .addCase(updateFile.rejected, (state, action) => {
                state.savingFile = false;
                state.error = action.payload ?? 'Failed to update file';
            });

        builder
            .addCase(deleteFile.fulfilled, (state, action) => {
                const { fileId, permanent } = action.payload;
                if (permanent) {
                    delete state.files[fileId];
                } else {
                    const file = state.files[fileId];
                    if (file) {
                        file.isDeleted = true;
                        state.deletedFileIds.push(fileId);
                    }
                }
                if (state.currentFileId === fileId) {
                    state.currentFileId = null;
                }
                state.selectedFileIds = state.selectedFileIds.filter(id => id !== fileId);
            });

        builder
            .addCase(restoreFile.fulfilled, (state, action) => {
                state.files[action.payload.id] = action.payload;
                state.deletedFileIds = state.deletedFileIds.filter(id => id !== action.payload.id);
            });

        builder
            .addCase(fetchFileVersions.pending, (state) => {
                state.fileVersionsLoading = true;
            })
            .addCase(fetchFileVersions.fulfilled, (state, action) => {
                state.fileVersionsLoading = false;
                state.fileVersions[action.payload.fileId] = action.payload.versions;
            })
            .addCase(fetchFileVersions.rejected, (state) => {
                state.fileVersionsLoading = false;
            });

        builder
            .addCase(restoreFileVersion.fulfilled, (state, action) => {
                state.files[action.payload.id] = action.payload;
            });

        builder
            .addCase(initializeFilesData.pending, (state, action) => {
                if (!action.meta.arg?.forceRefresh) {
                    const hasFiles = Object.keys(state.files).length > 0;
                    if (!hasFiles) {
                        state.loading = true;
                    }
                } else {
                    state.loading = true;
                }
                state.error = null;
            })
            .addCase(initializeFilesData.fulfilled, (state, action) => {
                state.loading = false;
                action.payload.files.forEach((file) => {
                    state.files[file.id] = file;
                });
                state.pagination = {
                    page: 1,
                    pageSize: action.payload.files.length,
                    totalCount: action.payload.totalCount,
                    totalPages: 1,
                };
            })
            .addCase(initializeFilesData.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload ?? 'Failed to initialize files';
            });
    },
});

export const {
    setFiles,
    setFile,
    removeFile,
    setCurrentFile,
    toggleSelectMode,
    setSelectMode,
    toggleFileSelection,
    toggleFolderSelection,
    selectFileRange,
    selectFolderRange,
    selectFiles,
    selectAllFiles,
    selectAllFolders,
    selectAll,
    clearSelection,
    exitSelectMode,
    setLoading,
    setLoadingFileId,
    setError,
    clearError,
    setSearchQuery,
    setSortBy,
    setSortOrder,
    setShowDeleted,
    setFolderId,
    setViewScope,
    setActiveFilter,
    clearActiveFilter,
    setPagination,
    setViewMode,
    setIconSize,
    toggleDetailsPanel,
    setDetailsPanelOpen,
    setDetailsPanelTab,
    toggleSidebar,
    clearFiles,
    setMyStorageUsage,
    setMyStorageUsageLoading,
} = filesSlice.actions;

export const filesReducer = filesSlice.reducer;

export {
    fetchFiles,
    fetchFile,
    updateFile,
    deleteFile,
    restoreFile,
    fetchFileVersions,
    restoreFileVersion,
    initializeFilesData,
} from '@/features/files/store/filesThunks';
