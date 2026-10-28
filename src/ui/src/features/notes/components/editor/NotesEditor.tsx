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
import { roleCanEdit } from "@/shared/utils/contentRoles";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { NodeType } from "@uniffy/proto/notes/v1/notes_pb";
import { findHeadingBySlug } from "@/components/editor/utils/headingScroll";
import {
  EditorHandleContext,
  MarkdownRecoveryContext,
  type MarkdownRecoveryActions,
} from "@/components/editor/EditorHandle";
import type { EditorHandle } from "@/components/editor/EditorHandle";
import { NoteTitleBlock } from "@/features/notes/components/editor/NoteTitleBlock";
import { FloatingFormattingToolbar } from "@/components/editor/toolbar/FloatingFormattingToolbar";
import { useNoteRealtimeSession } from "@/features/notes/realtime/useNoteRealtimeSession";
import { useInitialSync } from "@/features/realtime/hooks/useInitialSync";
import { RealtimeConnectionNotice } from "@/features/realtime/components/RealtimeConnectionNotice";
import { useCanvasRealtimeSession } from "@/features/notes/realtime/useCanvasRealtimeSession";
import { ErrorBoundary } from "@/components/feedback";
import { isNoteLoading } from "@/features/notes/utils/noteLoading";
import { noteAffordances } from "@/features/notes/utils/noteAffordances";
import { EditorErrorFallback } from "@/features/notes/components/editor/EditorErrorFallback";
import type { SerializedNote } from "@/features/notes/store/notesThunks";

function renderEditorErrorFallback({ reset }: { error: Error; reset: () => void }) {
  return <EditorErrorFallback onRetry={reset} />;
}

interface NotesEditorProps {
  /** The open note was deleted or its access went: it stays on screen read-only, as last shown,
   * with the Access lost chip until the user navigates. */
  lostNote?: SerializedNote | null;
  /** The routed note failed to load in this tab's organization. */
  loadFailed?: boolean;
}

export function NotesEditor({ lostNote = null, loadFailed = false }: NotesEditorProps) {
  const location = useLocation();
  const notesState = useAppSelector((state) => state.notes);
  const editorState = useAppSelector((state) => state.editor);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  const isZenMode = useAppSelector((state) => state.zenMode.isActive);

  const lost = lostNote !== null;
  const currentNoteId = lostNote?.id ?? notesState?.currentNoteId;
  const notes = notesState?.notes || {};
  const loadingNoteId = notesState?.loadingNoteId;
  const settings = editorState?.settings;
  const userSelectedMode = settings?.editorMode || "crepe";

  const currentNote = lostNote ?? (currentNoteId ? notes[currentNoteId] : null);
  const isLoadingCurrentNote = isNoteLoading(loadingNoteId ?? null, currentNoteId);
  const canvasTitleHidden = settings?.canvasTitleHidden ?? false;

  // Pass note's userRole so hook skips a fetch; UNSPECIFIED (0) falls through.
  const role = useMyContentRole(ContentType.NOTE, currentNoteId ?? "", currentNote?.userRole);

  const roleAllowsEdit = role === null ? true : roleCanEdit(role);

  const isCanvas = currentNote?.nodeType === NodeType.CANVAS;
  // A session stamps this tab's organization on the rows it stores and replays, so it starts only
  // once the note loaded here. A route to another organization's note never opens one.
  const loadedHere =
    lost ||
    (!loadFailed &&
      Boolean(currentNote) &&
      (!currentNote?.organizationId || currentNote.organizationId === organizationId));
  // Viewers attach too so read-only shares render the live Y.Text; the
  // multiplexer suppresses write frames for read-only docs.
  // A lost note keeps its session read-only, so the server's denial still settles local recovery.
  const { binding: realtimeBinding, status: liveStatus } = useNoteRealtimeSession(
    currentNoteId ?? null,
    Boolean(currentNoteId) && loadedHere && !isCanvas,
    roleAllowsEdit && !lost,
  );
  const { binding: canvasRealtimeBinding, status: canvasLiveStatus } = useCanvasRealtimeSession(
    currentNoteId ?? null,
    Boolean(currentNoteId) && loadedHere && roleAllowsEdit && isCanvas,
  );
  const realtimeStatus = lost ? "access_lost" : liveStatus;
  const canvasRealtimeStatus = lost ? "access_lost" : canvasLiveStatus;
  const initiallySynced = useInitialSync(realtimeBinding?.whenSynced);
  const activeStatus = isCanvas ? canvasRealtimeStatus : realtimeStatus;
  const { canEdit, canShare } = noteAffordances(role, lost, activeStatus);
  const editorMode = canEdit ? userSelectedMode : "readonly";

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

  const [recoveryActions, setRecoveryActions] = useState<MarkdownRecoveryActions | null>(null);
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
            realtimeWhenSynced={canvasRealtimeBinding?.whenSynced}
          />
        )}
        {!isZenMode && !canvasTitleHidden && compactTitleBlock}
        {lost && <RealtimeConnectionNotice waiting status="access_lost" />}
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
    if (!initiallySynced)
      return <ReadOnlyViewer note={currentNote} content={noteContent} titleSlot={titleBlock} />;
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
            onRecoveryReady={setRecoveryActions}
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
    <MarkdownRecoveryContext.Provider
      value={canEdit && editorMode === "markdown" ? recoveryActions : null}
    >
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
              realtimeWhenSynced={realtimeBinding?.whenSynced}
            />
          )}
          <RealtimeConnectionNotice
            key={currentNote.id}
            waiting={!initiallySynced || lost}
            status={realtimeStatus}
          />
          <div ref={editorContainerRef} className="flex-1 overflow-hidden">
            <ErrorBoundary fallback={renderEditorErrorFallback}>{renderEditor()}</ErrorBoundary>
          </div>
          {canEdit && initiallySynced && editorMode === "crepe" && (
            <FloatingFormattingToolbar showOnSelection={!toolbarPinned} />
          )}
        </div>
      </EditorHandleContext.Provider>
    </MarkdownRecoveryContext.Provider>
  );
}
