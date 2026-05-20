import type { ReactNode } from 'react';
import { CrepeEditor, type CrepeRealtimeBinding } from '@/components/editor/CrepeEditor';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';
import type { SerializedNote } from '@/features/notes/store/notesThunks';
import { useRealtimeMarkdownContent } from '@/features/notes/realtime/useMarkdownContent';

interface ReadOnlyViewerProps {
  note: SerializedNote;
  /** Static fallback content used when no realtime session is active. */
  content: string;
  /** Optional title/metadata block rendered above the editor surface inside the same scroll wrapper. */
  titleSlot?: ReactNode;
  /**
   * When set, the viewer reads live markdown from the shared
   * ``Y.Text("markdown")`` so it stays in sync with collaborative
   * edits in another pane.
   */
  realtime?: CrepeRealtimeBinding;
}

export function ReadOnlyViewer({ note, content, titleSlot, realtime }: ReadOnlyViewerProps) {
  // Debounce remote updates: the readonly Crepe pane rebuilds
  // Milkdown on every value change and would otherwise thrash
  // while a peer is typing.
  const liveContent = useRealtimeMarkdownContent(realtime?.ydoc ?? null, content, {
    whenSynced: realtime?.whenSynced ?? null,
    debounceMs: 300,
  });
  return (
    <div className="h-full bg-card">
      <CrepeEditor
        contentType={ContentType.NOTE}
        contentId={note.id}
        value={liveContent}
        readonly
        enableUpload={false}
        headerSlot={titleSlot}
      />
    </div>
  );
}
