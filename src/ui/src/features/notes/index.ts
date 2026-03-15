/**
 * Notes Feature Exports
 *
 * Central export point for all notes feature modules.
 */

// API
export { notesApi } from '@/features/notes/api/notesApi';

// Components
export { NotesSidebar } from '@/features/notes/components/sidebar/NotesSidebar';
export { NotesEditor } from '@/features/notes/components/editor/NotesEditor';
export { NotesLayout } from '@/features/notes/components/NotesLayout';
export { NotesMetadataPanel } from '@/features/notes/components/metadata/NotesMetadataPanel';
export { CrepeEditor } from '@/components/editor/CrepeEditor';
export { MarkdownSplitEditor } from '@/features/notes/components/editor/MarkdownSplitEditor';
export { ReadOnlyViewer } from '@/features/notes/components/editor/ReadOnlyViewer';
export { EditorHeader } from '@/features/notes/components/editor/EditorHeader';
export { NotesGraphDashboard } from '@/features/notes/components/dashboard/NotesGraphDashboard';

// Pages
export { NotesPage } from '@/features/notes/pages/NotesPage';
export { NotesTagsPage } from '@/features/notes/pages/NotesTagsPage';

// Store - Slices
export { notesReducer } from '@/features/notes/store/notesSlice';
export { notesTreeReducer } from '@/features/notes/store/notesTreeSlice';
export { editorReducer } from '@/features/notes/store/editorSlice';

// Store - Actions
export {
    setNotes,
    setNote,
    removeNote,
    setCurrentNote,
    addTab,
    removeTab,
    setActiveTab,
    setLoading,
    setLoadingNoteId,
    setError,
    clearError,
    setSearchQuery,
    setVisibilityFilter,
    setSortBy,
    setSortOrder,
    setShowDeleted,
    setPagination,
    clearNotes,
} from '@/features/notes/store/notesSlice';

export {
    setTree,
    setPersonalNodes,
    setSharedNodes,
    setGroupSections,
    setOrganizationNodes,
    setTrashNodes,
    addNodeToSection,
    updateNodeTitle,
    removeNode,
    toggleNodeExpanded,
    expandNode,
    collapseNode,
    expandAll,
    collapseAll,
    setSelectedNode,
    setDraggedNode,
    setDropTarget,
    setTreeWidth,
    toggleTreeCollapsed,
    setTreeCollapsed,
    setTreeLoading,
    setTreeError,
    clearTree,
} from '@/features/notes/store/notesTreeSlice';

export {
    setDraftContent,
    clearDraftContent,
    markSaved,
    markUnsaved,
    setAutosaveLastSaved,
    setAutosaveSaving,
    setAutosaveError,
    clearAutosaveState,
    setEditorMode,
    toggleMarkdownPreview,
    setShowMarkdownPreview,
    setFontSize,
    setLineHeight,
    setSpellCheck,
    toggleSidebar,
    setSidebarOpen,
    toggleMetadataPanel,
    setMetadataPanelOpen,
    setMetadataPanelWidth,
    setMetadataPanelTab,
} from '@/features/notes/store/editorSlice';

// Store - Thunks
// Note: Bookmark functionality is now in @/features/bookmarks
export {
    fetchNotes,
    fetchDeletedNotes,
    fetchNote,
    createNote,
    updateNote,
    autosaveNote,
    deleteNote,
    restoreNote,
    searchNotes,
    moveNote,
    copyNote,
    initializeNotesData,
} from '@/features/notes/store/notesSlice';

export { updateNoteIcon } from '@/features/notes/store/notesThunks';

export { fetchNotesTree } from '@/features/notes/store/notesTreeSlice';

// Hooks
export {
    useAutosave,
    useNoteLoader,
    useCurrentNote,
    useSaveStatus,
} from '@/features/notes/hooks/useNotesHooks';

export { useNotesCacheSync } from '@/features/notes/hooks/useNotesCacheSync';
export { useTreeStateSync } from '@/features/notes/hooks/useTreeStateSync';

// Utils
export {
    buildGraphData,
    parseMentionsFromContent,
    getNodeSize,
    getGraphStats,
} from '@/features/notes/utils/notesGraphUtils';

export {
    buildBreadcrumbPath,
} from '@/features/notes/utils/notesTreeUtils';
export type { BreadcrumbItem } from '@/features/notes/utils/notesTreeUtils';

// Note icons - constants from noteIconConstants.ts, rendering from noteIcons.tsx
export {
    CURATED_ICONS,
    COMMON_EMOJIS,
    getIconCategories,
    getIconsByCategory,
    isValidIconName,
    getIconComponent,
    ICON_COMPONENTS,
} from '@/features/notes/utils/noteIconConstants';
export type { NoteIcon } from '@/features/notes/utils/noteIconConstants';

export {
    renderNoteIcon,
    getIconByName,
    getIconSvgPaths,
    drawIconOnCanvas,
} from '@/features/notes/utils/noteIcons';

// Cache utilities (for logout cleanup)
export {
    clearAllCache as clearNotesCache,
    clearCachedNotes,
} from '@/features/notes/utils/notesCache';

// Tree state persistence
export {
    clearTreeState,
} from '@/features/notes/utils/treeStateStorage';

// Types
export type { TreeNode, GroupTreeSection } from '@/features/notes/store/notesTreeSlice';
export type { EditorMode, MetadataPanelTab } from '@/features/notes/store/editorSlice';
export type { GraphNode, GraphLink, GraphData } from '@/features/notes/utils/notesGraphUtils';
