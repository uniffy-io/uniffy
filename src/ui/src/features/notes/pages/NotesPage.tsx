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

  const notesState = useAppSelector((state) => state.notes);
  const editorState = useAppSelector((state) => state.editor);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const { defaultEditor, markdownShowPreview, markdownShowLineNumbers } = useAppearanceSettings();

  useNotesCacheSync();

  const currentNoteId = notesState?.currentNoteId;
  const isSidebarOpen = editorState?.isSidebarOpen ?? true;
  const isMetadataPanelOpen = editorState?.isMetadataPanelOpen ?? false;

  const isGraphRoute = location.pathname === '/notes/graph';

  const currentNote = currentNoteId ? notesState?.notes[currentNoteId] : null;
  const pageTitle = isGraphRoute ? 'Knowledge Graph' : (currentNote?.title || 'Notes');
  useDocumentTitle(pageTitle);

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

  useLayoutEffect(() => {
    if (!noteId && !isGraphRoute) {
      const lastNoteId = loadLastOpenedNote();
      if (lastNoteId) {
        navigate(`/notes/${lastNoteId}`, { replace: true });
      }
    }
  }, [noteId, isGraphRoute, navigate]);

  const hasAppliedDefaultEditor = useRef(false);
  useEffect(() => {
    if (!hasAppliedDefaultEditor.current && defaultEditor && ['crepe', 'markdown', 'readonly'].includes(defaultEditor)) {
      dispatch(setEditorMode(defaultEditor as EditorMode));
      dispatch(setShowMarkdownPreview(markdownShowPreview));
      dispatch(setShowMarkdownLineNumbers(markdownShowLineNumbers));
      hasAppliedDefaultEditor.current = true;
    }
  }, [dispatch, defaultEditor, markdownShowPreview, markdownShowLineNumbers]);

  const notesLoading = notesState?.loading ?? false;
  const notesCount = Object.keys(notesState?.notes ?? {}).length;
  const treeLoaded = useAppSelector((state) => state.notesTree.treeLoaded);

  // Gating on tree state (not notesCount) - fetchNote/searchNotes can mask an empty tree.
  useEffect(() => {
    if (!organizationId || treeLoaded) return;

    dispatch(initializeNotesData());
  }, [dispatch, organizationId, treeLoaded]);

  // Always refetch on noteId change or remount - returning from /chat would serve stale content and autosave could clobber concurrent edits.
  useEffect(() => {
    if (noteId) {
      dispatch(setCurrentNote(noteId));
      dispatch(fetchNote(noteId));
    } else if (currentNoteId && !isGraphRoute) {
      dispatch(setCurrentNote(null));
    }
    // currentNoteId omitted: run on mount + noteId change, not on Redux currentNoteId updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, isGraphRoute, dispatch]);

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
