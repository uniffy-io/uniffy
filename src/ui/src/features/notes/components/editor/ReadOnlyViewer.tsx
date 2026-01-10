import type { Note } from '@/gen/notes/v1/notes_pb';
import type { PlainMessage } from '@bufbuild/protobuf';
import { CrepeEditor } from './CrepeEditor';

interface ReadOnlyViewerProps {
  note: PlainMessage<Note>;
}

export function ReadOnlyViewer({ note }: ReadOnlyViewerProps) {
  return (
    <div className="h-full bg-card">
      <CrepeEditor note={note} readonly />
    </div>
  );
}
