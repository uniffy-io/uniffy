/**
 * Notes Feature Exports
 *
 * Central export point for all notes feature modules.
 */

// API
export { notesApi } from './api/notesApi';

// Components
export { NotesSidebar } from './components/sidebar/NotesSidebar';
export { NotesEditor } from './components/editor/NotesEditor';
export { NotesLayout } from './components/NotesLayout';
export { NotesMetadataPanel } from './components/metadata/NotesMetadataPanel';
export { CrepeEditor } from './components/editor/CrepeEditor';
export { MarkdownSplitEditor } from './components/editor/MarkdownSplitEditor';
export { ReadOnlyViewer } from './components/editor/ReadOnlyViewer';
export { EditorHeader } from './components/editor/EditorHeader';
export { NotesGraphDashboard } from './components/dashboard/NotesGraphDashboard';

// Pages
export { default as NotesPage } from './pages/NotesPage';

// Store - Slices
export { default as notesReducer } from './store/notesSlice';
export { default as notesTreeReducer } from './store/notesTreeSlice';
export { default as editorReducer } from './store/editorSlice';

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
} from './store/notesSlice';

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
} from './store/notesTreeSlice';

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
} from './store/editorSlice';

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
} from './store/notesSlice';

export { updateNoteIcon } from './store/notesThunks';

export { fetchNotesTree } from './store/notesTreeSlice';

// Hooks
export {
    useAutosave,
    useNoteLoader,
    useCurrentNote,
    useSaveStatus,
} from './hooks/useNotesHooks';

// Utils
export {
    buildGraphData,
    parseMentionsFromContent,
    getNodeSize,
    getGraphStats,
} from './utils/notesGraphUtils';

// Note icons - constants from noteIconConstants.ts, rendering from noteIcons.tsx
export {
    CURATED_HEROICONS,
    COMMON_EMOJIS,
    getIconCategories,
    getIconsByCategory,
    isValidHeroiconName,
    getHeroiconComponent,
} from './utils/noteIconConstants';
export type { NoteIcon } from './utils/noteIconConstants';

export {
    renderNoteIcon,
    getHeroiconByName,
    getHeroiconSvgPaths,
    drawHeroiconOnCanvas,
} from './utils/noteIcons';

// Types
export type { TreeNode, GroupTreeSection } from './store/notesTreeSlice';
export type { EditorMode, MetadataPanelTab } from './store/editorSlice';
export type { GraphNode, GraphLink, GraphData } from './utils/notesGraphUtils';
