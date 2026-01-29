import { useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { AppHeader } from '@/components/layout/AppHeader';
import { NotesLayout } from '../components/NotesLayout';
import { NotesSidebar } from '../components/sidebar/NotesSidebar';
import { NotesEditor } from '../components/editor/NotesEditor';
import { NotesMetadataPanel } from '../components/metadata/NotesMetadataPanel';
import { NotesGraphDashboard } from '../components/dashboard/NotesGraphDashboard';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { toggleSidebar, setEditorMode } from '../store/editorSlice';
import type { EditorMode } from '../store/editorSlice';
import { setCurrentNote, fetchNote, initializeNotesData } from '../store/notesSlice';
import { useShortcutHandler, useAppearanceSettings } from '@/features/settings';
import { SharingDialog } from '@/features/sharing';
import { useNotesCacheSync } from '../hooks/useNotesCacheSync';

export default function NotesPage() {
  const dispatch = useAppDispatch();
  const { noteId } = useParams<{ noteId: string }>();

  const notesState = useAppSelector((state) => state.notes);
  const editorState = useAppSelector((state) => state.editor);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
  const { defaultEditor } = useAppearanceSettings();

  // Sync notes to IndexedDB cache for instant load on next visit
  useNotesCacheSync();

  const isZenMode = useAppSelector((state) => state.zenMode.isActive);
  const currentNoteId = notesState?.currentNoteId;
  const isSidebarOpen = editorState?.isSidebarOpen ?? true;
  const isMetadataPanelOpen = editorState?.isMetadataPanelOpen ?? false;

  // Determine if we should show the dashboard (no note selected from URL)
  const showDashboard = !noteId;

  // Get current note title for dynamic document title
  const currentNote = currentNoteId ? notesState?.notes[currentNoteId] : null;
  const pageTitle = currentNote?.title || 'Notes';
  useDocumentTitle(pageTitle);

  // Keyboard shortcut for toggling sidebar
  const handleToggleSidebar = useCallback(() => {
    dispatch(toggleSidebar());
  }, [dispatch]);

  useShortcutHandler('notes.toggleSidebar', handleToggleSidebar);

  // Apply default editor mode from settings on initial mount only
  const hasAppliedDefaultEditor = useRef(false);
  useEffect(() => {
    if (!hasAppliedDefaultEditor.current && defaultEditor && ['crepe', 'markdown', 'readonly'].includes(defaultEditor)) {
      dispatch(setEditorMode(defaultEditor as EditorMode));
      hasAppliedDefaultEditor.current = true;
    }
  }, [dispatch, defaultEditor]);

  // Check if notes are already loaded
  const notesCount = Object.keys(notesState?.notes ?? {}).length;

  // Load notes on mount only if not already loaded
  // Uses excludeContent=true for performance - full content fetched when note is opened
  // initializeNotesData fetches all pages once and populates both the flat notes store
  // (for Knowledge Graph) and the tree store (for sidebar) in a single operation
  useEffect(() => {
    if (!organizationId || notesCount > 0) return;

    dispatch(initializeNotesData());
  }, [dispatch, organizationId, notesCount]);

  // Select note from URL parameter and fetch full content (or clear if viewing dashboard)
  useEffect(() => {
    if (noteId && noteId !== currentNoteId) {
      dispatch(setCurrentNote(noteId));
      // Fetch full note content - needed when navigating via URL/URN links
      // The initial fetchNotes() uses excludeContent=true for performance
      dispatch(fetchNote(noteId));
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
        showSidebar={!isZenMode && isSidebarOpen}
        showMetadataPanel={!isZenMode && isMetadataPanelOpen && !!currentNoteId}
      />
      <SharingDialog />
    </>
  );
}
