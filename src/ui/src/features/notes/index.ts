export { notesApi } from "@/features/notes/api/notesApi";

export { NotesSidebar } from "@/features/notes/components/sidebar/NotesSidebar";
export { NotesEditor } from "@/features/notes/components/editor/NotesEditor";
export { NotesLayout } from "@/features/notes/components/NotesLayout";
export { NotesMetadataPanel } from "@/features/notes/components/metadata/NotesMetadataPanel";
export { CrepeEditor } from "@/components/editor/CrepeEditor";
export { MarkdownSplitEditor } from "@/features/notes/components/editor/MarkdownSplitEditor";
export { ReadOnlyViewer } from "@/features/notes/components/editor/ReadOnlyViewer";
export { EditorHeader } from "@/features/notes/components/editor/EditorHeader";

export { NotesPage } from "@/features/notes/pages/NotesPage";

export { notesReducer } from "@/features/notes/store/notesSlice";
export { notesTreeReducer } from "@/features/notes/store/notesTreeSlice";
export { editorReducer } from "@/features/notes/store/editorSlice";

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
  setSortBy,
  setSortOrder,
  setShowDeleted,
  setPagination,
  clearNotes,
} from "@/features/notes/store/notesSlice";

export {
  setTree,
  setPersonalNodes,
  setSharedNodes,
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
} from "@/features/notes/store/notesTreeSlice";

export {
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
} from "@/features/notes/store/editorSlice";

export {
  fetchNotes,
  fetchDeletedNotes,
  fetchNote,
  createNote,
  updateNote,
  deleteNote,
  restoreNote,
  moveNote,
  copyNote,
  initializeNotesData,
} from "@/features/notes/store/notesSlice";

export { updateNoteIcon } from "@/features/notes/store/notesThunks";

export { fetchNotesTree } from "@/features/notes/store/notesTreeSlice";

export { useNoteLoader, useCurrentNote } from "@/features/notes/hooks/useNotesHooks";

export { useNotesCacheSync } from "@/features/notes/hooks/useNotesCacheSync";
export { useTreeStateSync } from "@/features/notes/hooks/useTreeStateSync";

export { buildBreadcrumbPath } from "@/features/notes/utils/notesTreeUtils";
export type { BreadcrumbItem } from "@/features/notes/utils/notesTreeUtils";

export {
  CURATED_ICONS,
  COMMON_EMOJIS,
  getIconCategories,
  getIconsByCategory,
  isValidIconName,
  getIconComponent,
  ICON_COMPONENTS,
} from "@/features/notes/utils/noteIconConstants";
export type { NoteIcon } from "@/features/notes/utils/noteIconConstants";

export {
  renderNoteIcon,
  getIconByName,
  getIconSvgPaths,
  drawIconOnCanvas,
} from "@/features/notes/utils/noteIcons";

export {
  clearAllCache as clearNotesCache,
  clearCachedNotes,
} from "@/features/notes/utils/notesCache";

export { clearTreeState } from "@/features/notes/utils/treeStateStorage";

export type { TreeNode } from "@/features/notes/store/notesTreeSlice";
export type { EditorMode, MetadataPanelTab } from "@/features/notes/store/editorSlice";
