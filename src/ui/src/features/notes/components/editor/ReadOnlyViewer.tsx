import { CrepeEditor } from './CrepeEditor';
import type { SerializedNote } from '../../store/notesThunks';

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
