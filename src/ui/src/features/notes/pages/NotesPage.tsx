import { useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { AppHeader } from '@/components/layout/AppHeader';
import { NotesLayout } from '@/features/notes/components/NotesLayout';
import { NotesSidebar } from '@/features/notes/components/sidebar/NotesSidebar';
import { NotesEditor } from '@/features/notes/components/editor/NotesEditor';
import { NotesMetadataPanel } from '@/features/notes/components/metadata/NotesMetadataPanel';
import { NotesGraphDashboard } from '@/features/notes/components/dashboard/NotesGraphDashboard';
import { NotesEmptyState } from '@/features/notes/components/NotesEmptyState';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { toggleSidebar, setEditorMode, setShowMarkdownPreview, setShowMarkdownLineNumbers, setSidebarOpen, toggleMetadataPanel } from '@/features/notes/store/editorSlice';
import type { EditorMode } from '@/features/notes/store/editorSlice';
import { setCurrentNote, fetchNote, initializeNotesData, loadLastOpenedNote } from '@/features/notes/store/notesSlice';
import { useShortcutHandler, useAppearanceSettings } from '@/features/settings';
import { useNotesCacheSync } from '@/features/notes/hooks/useNotesCacheSync';

export function NotesPage() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const { noteId } = useParams<{ noteId: string }>();

  // All hooks must be called before any early returns (Rules of Hooks)
  const notesState = useAppSelector((state) => state.notes);
  const editorState = useAppSelector((state) => state.editor);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const { defaultEditor, markdownShowPreview, markdownShowLineNumbers } = useAppearanceSettings();

  // Sync notes to IndexedDB cache for instant load on next visit
  useNotesCacheSync();

  const currentNoteId = notesState?.currentNoteId;
  const isSidebarOpen = editorState?.isSidebarOpen ?? true;
  const isMetadataPanelOpen = editorState?.isMetadataPanelOpen ?? false;

  // Check if we're on the graph route
  const isGraphRoute = location.pathname === '/notes/graph';

  // Get current note title for dynamic document title
  const currentNote = currentNoteId ? notesState?.notes[currentNoteId] : null;
  const pageTitle = isGraphRoute ? 'Knowledge Graph' : (currentNote?.title || 'Notes');
  useDocumentTitle(pageTitle);

  // Keyboard shortcut for toggling sidebar (global shortcut)
  const handleToggleSidebar = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);

  const handleCloseSidebar = useCallback(() => {
    dispatch(setSidebarOpen(false));
  }, [dispatch]);

  const handleCloseMetadataPanel = useCallback(() => {
    dispatch(toggleMetadataPanel());
  }, [dispatch]);

  useShortcutHandler('app.toggleSidebar', handleToggleSidebar);

  // Redirect to last opened note when navigating to /notes (but not /notes/graph)
  useLayoutEffect(() => {
    // Only redirect from the base /notes route, not from /notes/graph
    if (!noteId && !isGraphRoute) {
      const lastNoteId = loadLastOpenedNote();
      if (lastNoteId) {
        // Always redirect to last note when navigating to base /notes
        navigate(`/notes/${lastNoteId}`, { replace: true });
      }
    }
  }, [noteId, isGraphRoute, navigate]);

  // Apply default editor mode from settings on initial mount only
  const hasAppliedDefaultEditor = useRef(false);
  useEffect(() => {
    if (!hasAppliedDefaultEditor.current && defaultEditor && ['crepe', 'markdown', 'readonly'].includes(defaultEditor)) {
      dispatch(setEditorMode(defaultEditor as EditorMode));
      dispatch(setShowMarkdownPreview(markdownShowPreview));
      dispatch(setShowMarkdownLineNumbers(markdownShowLineNumbers));
      hasAppliedDefaultEditor.current = true;
    }
  }, [dispatch, defaultEditor, markdownShowPreview, markdownShowLineNumbers]);

  // Check if notes are already loaded
  const notesLoading = notesState?.loading ?? false;
  const notesCount = Object.keys(notesState?.notes ?? {}).length;
  const treeLoaded = useAppSelector((state) => state.notesTree.treeLoaded);

  // Load notes on mount only if the tree hasn't been hydrated yet.
  // Gating on tree state (not notesCount) prevents fetchNote / searchNotes
  // from masking an empty tree, which used to leave the sidebar blank until
  // the user hit the refresh button.
  useEffect(() => {
    if (!organizationId || treeLoaded) return;

    dispatch(initializeNotesData());
  }, [dispatch, organizationId, treeLoaded]);

  // Select note from URL parameter and fetch full content (or clear if viewing dashboard).
  // Always refetch when the route's noteId changes OR the page remounts, even when
  // currentNoteId in Redux already matches - returning from another domain (e.g. /chat)
  // would otherwise serve stale cached content and let autosave clobber concurrent edits.
  useEffect(() => {
    if (noteId) {
      dispatch(setCurrentNote(noteId));
      dispatch(fetchNote(noteId));
    } else if (currentNoteId && !isGraphRoute) {
      dispatch(setCurrentNote(null));
    }
    // currentNoteId intentionally excluded - we want this effect to run on
    // mount + noteId change, not when Redux updates currentNoteId itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, isGraphRoute, dispatch]);

  // Determine if we should show the dashboard (graph route or no note selected)
  const showDashboard = isGraphRoute || !noteId;

  return (
    <>
      <AppHeader />
      <NotesLayout
        sidebar={<NotesSidebar />}
        editor={showDashboard
          ? (notesCount === 0 && !notesLoading && !isGraphRoute
            ? <NotesEmptyState key="empty-state" />
            : <NotesGraphDashboard key="graph-dashboard" />)
          : <NotesEditor key="note-editor" />
        }
        metadataPanel={currentNoteId ? <NotesMetadataPanel /> : null}
        showSidebar={!isZenMode && isSidebarOpen}
        showMetadataPanel={!isZenMode && isMetadataPanelOpen && !!currentNoteId}
        onCloseSidebar={handleCloseSidebar}
        onCloseMetadataPanel={handleCloseMetadataPanel}
      />
    </>
  );
}
