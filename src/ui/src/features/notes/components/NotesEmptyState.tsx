import { NotePencil } from "@phosphor-icons/react";
import { EmptyState } from "@/components/feedback/EmptyState";
import { useAppDispatch } from "@/app/hooks";
import { createNote } from "@/features/notes/store/notesThunks";

export function NotesEmptyState() {
  const dispatch = useAppDispatch();

  return (
    <EmptyState
      icon={NotePencil}
      title="Create your first note"
      description="Start writing to capture ideas, meeting notes, or documentation. Notes support rich text, mentions, and canvas mode."
      actionLabel="New Note"
      onAction={() => dispatch(createNote({ title: "Untitled" }))}
      shortcutKey="notes.newNote"
      tips={[
        {
          color: "primary",
          text: (
            <>
              Use <kbd className="px-1 rounded bg-muted text-xs">@</kbd> to mention and link Notes,
              Files, or People
            </>
          ),
        },
        {
          color: "emerald-500",
          text: "Switch between rich text, markdown, and canvas editors",
        },
        {
          color: "amber-500",
          text: "Organize notes in folders with drag and drop",
        },
      ]}
    />
  );
}
