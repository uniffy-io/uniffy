import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useAppSelector } from "@/app/hooks";
import { EditorHeader } from "@/features/notes/components/editor/EditorHeader";
import { CrepeEditor } from "@/components/editor/CrepeEditor";
import { MarkdownSplitEditor } from "@/features/notes/components/editor/MarkdownSplitEditor";
import { ReadOnlyViewer } from "@/features/notes/components/editor/ReadOnlyViewer";
import { CanvasEditor } from "@/features/notes/canvas/CanvasEditor";
import { parseCanvasContent } from "@/features/notes/canvas/types";
import { useMyContentRole } from "@/features/permissions";
import { roleCanEdit, roleCanManage } from "@/shared/utils/contentRoles";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { NodeType } from "@uniffy/proto/notes/v1/notes_pb";
import { findHeadingBySlug } from "@/components/editor/utils/headingScroll";
import { EditorHandleContext } from "@/components/editor/EditorHandle";
import type { EditorHandle } from "@/components/editor/EditorHandle";
import { NoteTitleBlock } from "@/features/notes/components/editor/NoteTitleBlock";
import { FloatingFormattingToolbar } from "@/features/notes/components/editor/FloatingFormattingToolbar";
import { useNoteRealtimeSession } from "@/features/notes/realtime/useNoteRealtimeSession";
import { useCanvasRealtimeSession } from "@/features/notes/realtime/useCanvasRealtimeSession";
import { ErrorBoundary } from "@/components/feedback";
import { EditorErrorFallback } from "@/features/notes/components/editor/EditorErrorFallback";

function renderEditorErrorFallback({ reset }: { error: Error; reset: () => void }) {
  return <EditorErrorFallback onRetry={reset} />;
}

export function NotesEditor() {
  const location = useLocation();
  const notesState = useAppSelector((state) => state.notes);
  const editorState = useAppSelector((state) => state.editor);

  const isZenMode = useAppSelector((state) => state.zenMode.isActive);

  const currentNoteId = notesState?.currentNoteId;
  const notes = notesState?.notes || {};
  const loadingNoteId = notesState?.loadingNoteId;
  const settings = editorState?.settings;
  const userSelectedMode = settings?.editorMode || "crepe";

  const currentNote = currentNoteId ? notes[currentNoteId] : null;
  const isLoadingCurrentNote = loadingNoteId === currentNoteId;
  const canvasTitleHidden = settings?.canvasTitleHidden ?? false;

  // Pass note's userRole so hook skips a fetch; UNSPECIFIED (0) falls through.
  const role = useMyContentRole(ContentType.NOTE, currentNoteId ?? "", currentNote?.userRole);

  const canEdit = role === null ? true : roleCanEdit(role);
  const canShare = roleCanManage(role);
  const editorMode = canEdit ? userSelectedMode : "readonly";

  const isCanvas = currentNote?.nodeType === NodeType.CANVAS;
  // Viewers attach too so read-only shares render the live Y.Text; the
  // multiplexer suppresses write frames for read-only docs.
  const { binding: realtimeBinding, status: realtimeStatus } = useNoteRealtimeSession(
    currentNoteId ?? null,
    Boolean(currentNoteId) && !isCanvas,
    canEdit,
  );
  const { binding: canvasRealtimeBinding, status: canvasRealtimeStatus } = useCanvasRealtimeSession(
    currentNoteId ?? null,
    Boolean(currentNoteId) && canEdit && isCanvas,
  );

  const noteContent = currentNote?.content ?? "";

  // Poll until heading appears since editor renders async.
  const hashScrolledRef = useRef<string | null>(null);

  useEffect(() => {
    const hash = location.hash.replace(/^#/, "");
    if (!hash || !currentNote?.content) return;

    if (hashScrolledRef.current === `${currentNoteId}#${hash}`) return;

    let attempts = 0;
    const maxAttempts = 20;
    let rafId: number;

    const tryScroll = () => {
      const heading = findHeadingBySlug(hash);
      if (heading) {
        heading.scrollIntoView({ behavior: "smooth", block: "start" });
        hashScrolledRef.current = `${currentNoteId}#${hash}`;
        return;
      }
      attempts++;
      if (attempts < maxAttempts) {
        rafId = requestAnimationFrame(tryScroll);
      }
    };

    const timeoutId = setTimeout(() => {
      rafId = requestAnimationFrame(tryScroll);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      cancelAnimationFrame(rafId);
    };
  }, [location.hash, currentNoteId, currentNote?.content]);

  const editorContainerRef = useRef<HTMLDivElement>(null);

  const [editorHandle, setEditorHandle] = useState<EditorHandle | null>(null);
  const handleEditorReady = useCallback((handle: EditorHandle | null) => {
    setEditorHandle(handle);
  }, []);

  const canvasState = useMemo(
    () => (isCanvas ? parseCanvasContent(noteContent) : null),
    [isCanvas, noteContent],
  );

  const shouldShowLoading = isLoadingCurrentNote && (!currentNote || !currentNote.content);

  if (shouldShowLoading) {
    return (
      <div className="flex flex-col h-full bg-surface">
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
          <p className="text-sm">Loading note...</p>
        </div>
      </div>
    );
  }

  if (!currentNote) {
    return (
      <div className="flex flex-col h-full bg-surface">
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <h3 className="text-xl font-semibold mb-2">No note selected</h3>
          <p className="text-sm">Select a note from the sidebar or create a new one</p>
        </div>
      </div>
    );
  }

  const titleBlock = <NoteTitleBlock note={currentNote} canEdit={canEdit} />;
  const compactTitleBlock = <NoteTitleBlock note={currentNote} canEdit={canEdit} compact />;
  const toolbarPinned = settings?.toolbarPinned ?? true;

  // Canvas surface has no scrolling document, so title sits above.
  if (isCanvas && canvasState) {
    return (
      <div
        className="flex flex-col h-full bg-surface"
        data-toolbar-pinned={toolbarPinned ? "true" : "false"}
      >
        {!isZenMode && (
          <EditorHeader
            note={currentNote}
            canEdit={canEdit}
            canShare={canShare}
            isCanvas
            realtimeStatus={canvasRealtimeStatus}
            realtimeAwareness={canvasRealtimeBinding?.awareness ?? null}
          />
        )}
        {!isZenMode && !canvasTitleHidden && compactTitleBlock}
        <div className="flex-1 overflow-hidden">
          <ErrorBoundary fallback={renderEditorErrorFallback}>
            <CanvasEditor
              key={currentNote.id}
              canvasState={canvasState}
              readonly={!canEdit}
              contentId={currentNote.id}
              realtime={canvasRealtimeBinding ?? undefined}
            />
          </ErrorBoundary>
        </div>
      </div>
    );
  }

  const renderEditor = () => {
    switch (editorMode) {
      case "crepe":
        return (
          <CrepeEditor
            contentType={ContentType.NOTE}
            contentId={currentNote.id}
            value={noteContent}
            enableComments={true}
            onEditorReady={handleEditorReady}
            headerSlot={titleBlock}
            floatingToolbar={false}
            realtime={realtimeBinding ?? undefined}
          />
        );
      case "markdown":
        return (
          <MarkdownSplitEditor
            note={currentNote}
            titleSlot={titleBlock}
            realtime={realtimeBinding ?? undefined}
          />
        );
      case "readonly":
        return (
          <ReadOnlyViewer
            note={currentNote}
            content={noteContent}
            titleSlot={titleBlock}
            realtime={realtimeBinding ?? undefined}
          />
        );
      default:
        return (
          <CrepeEditor
            contentType={ContentType.NOTE}
            contentId={currentNote.id}
            value={noteContent}
            enableComments={true}
            onEditorReady={handleEditorReady}
            headerSlot={titleBlock}
            floatingToolbar={false}
            realtime={realtimeBinding ?? undefined}
          />
        );
    }
  };

  return (
    <EditorHandleContext.Provider value={editorHandle}>
      <div
        className="flex flex-col h-full bg-surface"
        data-toolbar-pinned={toolbarPinned ? "true" : "false"}
      >
        {!isZenMode && (
          <EditorHeader
            note={currentNote}
            canEdit={canEdit}
            canShare={canShare}
            realtimeStatus={realtimeStatus}
            realtimeAwareness={realtimeBinding?.awareness ?? null}
          />
        )}
        <div ref={editorContainerRef} className="flex-1 overflow-hidden">
          <ErrorBoundary fallback={renderEditorErrorFallback}>{renderEditor()}</ErrorBoundary>
        </div>
        {/* Floating toolbar only when persistent bar unpinned and in crepe mode. */}
        {canEdit && editorMode === "crepe" && !toolbarPinned && <FloatingFormattingToolbar />}
      </div>
    </EditorHandleContext.Provider>
  );
}
