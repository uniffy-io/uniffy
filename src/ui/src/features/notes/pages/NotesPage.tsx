import { useEffect } from 'react';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { AppHeader } from '@/components/layout/AppHeader';
import { NotesLayout } from '../components/NotesLayout';
import { NotesTreeNav } from '../components/tree/NotesTreeNav';
import { NotesEditor } from '../components/editor/NotesEditor';
import { NotesMetadataPanel } from '../components/metadata/NotesMetadataPanel';
import { useAppSelector } from '@/app/hooks';

export default function NotesPage() {
  useDocumentTitle('Notes');
  
  const { currentNoteId } = useAppSelector((state) => state.notes);
  const { isMetadataPanelOpen } = useAppSelector((state) => state.editor);
  
  // Load initial notes on mount
  useEffect(() => {
    // TODO: Fetch notes from API
  }, []);
  
  return (
    <>
      <AppHeader />
      <NotesLayout
        treeNav={<NotesTreeNav />}
        editor={<NotesEditor />}
        metadataPanel={currentNoteId ? <NotesMetadataPanel /> : null}
        showMetadataPanel={isMetadataPanelOpen && !!currentNoteId}
      />
    </>
  );
}
