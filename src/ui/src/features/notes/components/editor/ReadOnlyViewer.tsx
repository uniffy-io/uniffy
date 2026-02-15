import { CrepeEditor } from '@/components/editor/CrepeEditor';
import { ContentType } from '@/gen/common/v1/common_pb';
import type { SerializedNote } from '@/features/notes/store/notesThunks';

interface ReadOnlyViewerProps {
  note: SerializedNote;
}

export function ReadOnlyViewer({ note }: ReadOnlyViewerProps) {
  return (
    <div className="h-full bg-card">
      <CrepeEditor
        contentType={ContentType.NOTE}
        contentId={note.id}
        value={note.content}
        readonly
        enableUpload={false}
      />
    </div>
  );
}
