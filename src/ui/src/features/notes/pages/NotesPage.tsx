import { useEffect } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { AppHeader } from '@/components/layout/AppHeader';
import { NotesLayout } from '../components/NotesLayout';
import { NotesSidebar } from '../components/sidebar/NotesSidebar';
import { NotesEditor } from '../components/editor/NotesEditor';
import { NotesMetadataPanel } from '../components/metadata/NotesMetadataPanel';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { toggleSidebar } from '../store/editorSlice';

export default function NotesPage() {
  useDocumentTitle('Notes');
  const dispatch = useAppDispatch();
  
  const notesState = useAppSelector((state) => state.notes);
  const editorState = useAppSelector((state) => state.editor);
  
  const currentNoteId = notesState?.currentNoteId;
  const isSidebarOpen = editorState?.isSidebarOpen ?? true;
  const isMetadataPanelOpen = editorState?.isMetadataPanelOpen ?? false;
  
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
  
  // Load initial notes on mount
  useEffect(() => {
    // TODO: Fetch notes from API
  }, []);
  
  return (
    <>
      <AppHeader />
      <NotesLayout
        sidebar={<NotesSidebar />}
        editor={<NotesEditor />}
        metadataPanel={currentNoteId ? <NotesMetadataPanel /> : null}
        showSidebar={isSidebarOpen}
        showMetadataPanel={isMetadataPanelOpen && !!currentNoteId}
      />
    </>
  );
}
