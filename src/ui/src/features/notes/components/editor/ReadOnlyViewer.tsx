import { CrepeEditor } from '@/features/notes/components/editor/CrepeEditor';
import type { SerializedNote } from '@/features/notes/store/notesThunks';

interface ReadOnlyViewerProps {
  note: SerializedNote;
}

export function ReadOnlyViewer({ note }: ReadOnlyViewerProps) {
  return (
    <div className="h-full bg-card">
      <CrepeEditor note={note} readonly />
    </div>
  );
}
