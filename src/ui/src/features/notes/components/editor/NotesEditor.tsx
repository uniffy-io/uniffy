import { useCallback, useMemo } from 'react';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { EditorHeader } from '@/features/notes/components/editor/EditorHeader';
import { CrepeEditor } from '@/components/editor/CrepeEditor';
import { MarkdownSplitEditor } from '@/features/notes/components/editor/MarkdownSplitEditor';
import { ReadOnlyViewer } from '@/features/notes/components/editor/ReadOnlyViewer';
import { CanvasEditor } from '@/features/notes/canvas/CanvasEditor';
import { parseCanvasContent, serializeCanvas } from '@/features/notes/canvas/types';
import type { CanvasState } from '@/features/notes/canvas/types';
import { toggleSidebar } from '@/features/notes/store/editorSlice';
import { useAutosave } from '@/features/notes/hooks/useNotesHooks';
import { CaretDoubleRight } from '@phosphor-icons/react';
import { useMyPermission } from '@/features/sharing';
import { ContentType } from '@/gen/common/v1/common_pb';
import { NodeType } from '@/gen/notes/v1/notes_pb';

export function NotesEditor() {
  const dispatch = useAppDispatch();
  const notesState = useAppSelector((state) => state.notes);
  const editorState = useAppSelector((state) => state.editor);

  const isZenMode = useAppSelector((state) => state.zenMode.isActive);

  const currentNoteId = notesState?.currentNoteId;
  const notes = notesState?.notes || {};
  const loadingNoteId = notesState?.loadingNoteId;
  const settings = editorState?.settings;
  const userSelectedMode = settings?.editorMode || 'crepe';
  const isSidebarOpen = editorState?.isSidebarOpen ?? true;

  const currentNote = currentNoteId ? notes[currentNoteId] : null;
  const isLoadingCurrentNote = loadingNoteId === currentNoteId;

  // Check user's permission on the current note
  const { permission } = useMyPermission(
    ContentType.NOTE,
    currentNoteId
  );

  // Force readonly mode if user doesn't have edit permission
  const canEdit = permission?.canEdit ?? true; // Default to true while loading
  const canShare = permission?.canShare ?? false; // Only admin/owner can share
  const editorMode = canEdit ? userSelectedMode : 'readonly';

  // Autosave hook - handles debounced saving
  const { scheduleAutosave, draftContent } = useAutosave(
    canEdit && currentNoteId ? currentNoteId : null
  );

  // Get draft content from autosave hook
  const noteContent = currentNote
    ? (draftContent != null ? draftContent : currentNote.content)
    : '';

  const handleContentChange = useCallback((markdown: string) => {
    scheduleAutosave(markdown);
  }, [scheduleAutosave]);

  const handleCanvasChange = useCallback(
    (state: CanvasState) => {
      scheduleAutosave(serializeCanvas(state));
    },
    [scheduleAutosave]
  );

  const isCanvas = currentNote?.nodeType === NodeType.CANVAS;

  const canvasState = useMemo(
    () => (isCanvas ? parseCanvasContent(noteContent) : null),
    [isCanvas, noteContent]
  );

  // Show loading state when:
  // 1. We're loading the current note AND
  // 2. Either we don't have the note yet OR the note has no content (from tree preview)
  const shouldShowLoading = isLoadingCurrentNote && (!currentNote || !currentNote.content);

  // Loading state - show spinner when fetching note
  if (shouldShowLoading) {
    return (
      <div className="flex flex-col h-full bg-card">
        {!isSidebarOpen && (
          <div className="flex items-center px-4 py-2 border-b border-border">
            <button
              onClick={() => dispatch(toggleSidebar())}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
              title="Show sidebar (⌘\\)"
            >
              <CaretDoubleRight size={16} weight="bold" />
            </button>
          </div>
        )}
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
          <p className="text-sm">Loading note...</p>
        </div>
      </div>
    );
  }

  // Empty state - no note selected
  if (!currentNote) {
    return (
      <div className="flex flex-col h-full bg-card">
        {/* Header with sidebar toggle when sidebar is hidden */}
        {!isSidebarOpen && (
          <div className="flex items-center px-4 py-2 border-b border-border">
            <button
              onClick={() => dispatch(toggleSidebar())}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
              title="Show sidebar (⌘\\)"
            >
              <CaretDoubleRight size={16} weight="bold" />
            </button>
          </div>
        )}

        {/* Empty state */}
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <h3 className="text-xl font-semibold mb-2">No note selected</h3>
          <p className="text-sm">Select a note from the sidebar or create a new one</p>
        </div>
      </div>
    );
  }

  // Canvas notes use a dedicated editor
  if (isCanvas && canvasState) {
    return (
      <div className="flex flex-col h-full bg-card">
        {!isZenMode && <EditorHeader note={currentNote} canEdit={canEdit} canShare={canShare} isCanvas />}
        <div className="flex-1 overflow-hidden">
          <CanvasEditor
            key={currentNote.id}
            canvasState={canvasState}
            onChange={handleCanvasChange}
            readonly={!canEdit}
            contentId={currentNote.id}
          />
        </div>
      </div>
    );
  }

  const renderEditor = () => {
    switch (editorMode) {
      case 'crepe':
        return (
          <CrepeEditor
            contentType={ContentType.NOTE}
            contentId={currentNote.id}
            value={noteContent}
            onChange={handleContentChange}
            enableComments={true}
          />
        );
      case 'markdown':
        return <MarkdownSplitEditor note={currentNote} />;
      case 'readonly':
        return <ReadOnlyViewer note={currentNote} content={noteContent} />;
      default:
        return (
          <CrepeEditor
            contentType={ContentType.NOTE}
            contentId={currentNote.id}
            value={noteContent}
            onChange={handleContentChange}
            enableComments={true}
          />
        );
    }
  };

  return (
    <div className="flex flex-col h-full bg-card">
      {!isZenMode && <EditorHeader note={currentNote} canEdit={canEdit} canShare={canShare} />}
      <div className="flex-1 overflow-hidden">
        {renderEditor()}
      </div>
    </div>
  );
}
