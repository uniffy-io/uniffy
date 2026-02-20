import { CrepeEditor } from '@/components/editor/CrepeEditor';
import { ContentType } from '@/gen/common/v1/common_pb';
import type { SerializedNote } from '@/features/notes/store/notesThunks';

interface ReadOnlyViewerProps {
  note: SerializedNote;
  /** Resolved content to display (includes draft content if available) */
  content: string;
}

export function ReadOnlyViewer({ note, content }: ReadOnlyViewerProps) {
  return (
    <div className="h-full bg-card">
      <CrepeEditor
        contentType={ContentType.NOTE}
        contentId={note.id}
        value={content}
        readonly
        enableUpload={false}
      />
    </div>
  );
}
