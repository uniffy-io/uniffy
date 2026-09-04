import type { ReactNode } from "react";
import { CrepeEditor, type CrepeRealtimeBinding } from "@/components/editor/CrepeEditor";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import type { SerializedNote } from "@/features/notes/store/notesThunks";
import { useRealtimeMarkdownContent } from "@/features/notes/realtime/useMarkdownContent";

interface ReadOnlyViewerProps {
  note: SerializedNote;
  content: string;
  titleSlot?: ReactNode;
  realtime?: CrepeRealtimeBinding;
}

export function ReadOnlyViewer({ note, content, titleSlot, realtime }: ReadOnlyViewerProps) {
  // Readonly Crepe rebuilds Milkdown per value change - debounce so a typing peer does not thrash it.
  const liveContent = useRealtimeMarkdownContent(realtime?.ydoc ?? null, content, {
    whenSynced: realtime?.whenSynced ?? null,
    debounceMs: 300,
  });
  return (
    <div className="h-full bg-surface">
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
