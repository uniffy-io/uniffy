import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { AppHeader } from '@/components/layout/AppHeader';
import { NotesLayout } from '../components/NotesLayout';
import { NotesSidebar } from '../components/sidebar/NotesSidebar';
import { NotesEditor } from '../components/editor/NotesEditor';
import { NotesMetadataPanel } from '../components/metadata/NotesMetadataPanel';
import { NotesGraphDashboard } from '../components/dashboard/NotesGraphDashboard';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { toggleSidebar } from '../store/editorSlice';
import { fetchNotes, setCurrentNote } from '../store/notesSlice';
import { fetchNotesTree } from '../store/notesTreeSlice';

export default function NotesPage() {
  useDocumentTitle('Notes');
  const dispatch = useAppDispatch();
  const { noteId } = useParams<{ noteId: string }>();

  const notesState = useAppSelector((state) => state.notes);
  const editorState = useAppSelector((state) => state.editor);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  const currentNoteId = notesState?.currentNoteId;
  const isSidebarOpen = editorState?.isSidebarOpen ?? true;
  const isMetadataPanelOpen = editorState?.isMetadataPanelOpen ?? false;

  // Determine if we should show the dashboard (no note selected from URL)
  const showDashboard = !noteId;

  // Keyboard shortcut for toggling sidebar (Cmd/Ctrl + \)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
        e.preventDefault();
        dispatch(toggleSidebar());
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dispatch]);

  // Load initial notes on mount when we have an organization
  useEffect(() => {
    if (!organizationId) return;

    // Fetch all notes and populate both the list and tree
    dispatch(fetchNotes());
    dispatch(fetchNotesTree());
  }, [dispatch, organizationId]);

  // Select note from URL parameter (or clear if viewing dashboard)
  useEffect(() => {
    if (noteId && noteId !== currentNoteId) {
      dispatch(setCurrentNote(noteId));
    } else if (!noteId && currentNoteId) {
      // Clear current note when navigating to dashboard
      dispatch(setCurrentNote(null));
    }
  }, [noteId, currentNoteId, dispatch]);

  return (
    <>
      <AppHeader />
      <NotesLayout
        sidebar={<NotesSidebar />}
        editor={showDashboard ? <NotesGraphDashboard /> : <NotesEditor />}
        metadataPanel={currentNoteId ? <NotesMetadataPanel /> : null}
        showSidebar={isSidebarOpen}
        showMetadataPanel={isMetadataPanelOpen && !!currentNoteId}
      />
    </>
  );
}
