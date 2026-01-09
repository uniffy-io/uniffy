import { useAppSelector } from '@/app/hooks';
import { EditorHeader } from './EditorHeader';
import { MarkdownEditor } from './MarkdownEditor';

export function NotesEditor() {
  const { currentNoteId, notes } = useAppSelector((state) => state.notes);
  
  const currentNote = currentNoteId ? notes[currentNoteId] : null;
  
  if (!currentNote) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-card text-muted-foreground">
        <div className="text-6xl mb-4">📝</div>
        <h3 className="text-xl font-semibold mb-2">No note selected</h3>
        <p className="text-sm">Select a note from the sidebar or create a new one</p>
      </div>
    );
  }
  
  return (
    <div className="flex flex-col h-full bg-card">
      <EditorHeader note={currentNote} />
      <MarkdownEditor note={currentNote} />
    </div>
  );
}
