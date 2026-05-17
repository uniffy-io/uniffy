import type { ReactNode } from 'react';
import { CrepeEditor } from '@/components/editor/CrepeEditor';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';
import type { SerializedNote } from '@/features/notes/store/notesThunks';

interface ReadOnlyViewerProps {
  note: SerializedNote;
  /** Resolved content to display (includes draft content if available) */
  content: string;
  /** Optional title/metadata block rendered above the editor surface inside the same scroll wrapper. */
  titleSlot?: ReactNode;
}

export function ReadOnlyViewer({ note, content, titleSlot }: ReadOnlyViewerProps) {
  return (
    <div className="h-full bg-card">
      <CrepeEditor
        contentType={ContentType.NOTE}
        contentId={note.id}
        value={content}
        readonly
        enableUpload={false}
        headerSlot={titleSlot}
      />
    </div>
  );
}
