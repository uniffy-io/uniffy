import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppSelector } from '@/app/hooks';
import { EditorHeader } from '@/features/notes/components/editor/EditorHeader';
import { CrepeEditor } from '@/components/editor/CrepeEditor';
import { MarkdownSplitEditor } from '@/features/notes/components/editor/MarkdownSplitEditor';
import { ReadOnlyViewer } from '@/features/notes/components/editor/ReadOnlyViewer';
import { CanvasEditor } from '@/features/notes/canvas/CanvasEditor';
import { parseCanvasContent, serializeCanvas } from '@/features/notes/canvas/types';
import type { CanvasState } from '@/features/notes/canvas/types';
import { useAutosave } from '@/features/notes/hooks/useNotesHooks';
import { useMyContentRole } from '@/features/permissions';
import { roleCanEdit, roleCanManage } from '@/shared/utils/contentRoles';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';
import { NodeType } from '@uniffy/proto/notes/v1/notes_pb';
import { findHeadingBySlug } from '@/components/editor/utils/headingScroll';

export function NotesEditor() {
  const location = useLocation();
  const notesState = useAppSelector((state) => state.notes);
  const editorState = useAppSelector((state) => state.editor);

  const isZenMode = useAppSelector((state) => state.zenMode.isActive);

  const currentNoteId = notesState?.currentNoteId;
  const notes = notesState?.notes || {};
  const loadingNoteId = notesState?.loadingNoteId;
  const settings = editorState?.settings;
  const userSelectedMode = settings?.editorMode || 'crepe';

  const currentNote = currentNoteId ? notes[currentNoteId] : null;
  const isLoadingCurrentNote = loadingNoteId === currentNoteId;

  // Check user's role on the current note
  const role = useMyContentRole(ContentType.NOTE, currentNoteId ?? '');

  // Force readonly mode if user doesn't have edit permission
  const canEdit = role === null ? true : roleCanEdit(role); // Default to true while loading
  const canShare = roleCanManage(role);
  const editorMode = canEdit ? userSelectedMode : 'readonly';

  // Autosave hook - handles debounced saving
  const { scheduleAutosave, draftContent } = useAutosave(
    canEdit && currentNoteId ? currentNoteId : null
  );

  // Get draft content from autosave hook
  const noteContent = currentNote
    ? (draftContent != null ? draftContent : currentNote.content)
    : '';

  // Scroll to heading when URL has a hash fragment (e.g. /notes/:id#heading-slug).
  // The editor renders asynchronously, so we poll until the heading appears in the DOM.
  const hashScrolledRef = useRef<string | null>(null);

  useEffect(() => {
    const hash = location.hash.replace(/^#/, '');
    if (!hash || !currentNote?.content) return;

    // Avoid re-scrolling to the same hash on re-renders
    if (hashScrolledRef.current === `${currentNoteId}#${hash}`) return;

    let attempts = 0;
    const maxAttempts = 20;
    let rafId: number;

    const tryScroll = () => {
      const heading = findHeadingBySlug(hash);
      if (heading) {
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        hashScrolledRef.current = `${currentNoteId}#${hash}`;
        return;
      }
      attempts++;
      if (attempts < maxAttempts) {
        rafId = requestAnimationFrame(tryScroll);
      }
    };

    // Start polling after a short delay to let the editor mount
    const timeoutId = setTimeout(() => {
      rafId = requestAnimationFrame(tryScroll);
    }, 100);

    return () => {
      clearTimeout(timeoutId);
      cancelAnimationFrame(rafId);
    };
  }, [location.hash, currentNoteId, currentNote?.content]);

  // Hide title section on scroll down, show on scroll up or at top.
  // Uses capture-phase scroll listener on the container so it catches
  // scroll events from any nested scrollable element (CrepeEditor wrapper,
  // CodeMirror scroller, etc.) without needing to query for them.
  // A cooldown timer prevents rapid toggling during fast/momentum scrolling
  // by locking the state for the duration of the CSS transition.
  const [titleVisible, setTitleVisible] = useState(true);
  const lastScrollTopRef = useRef(0);
  const titleVisibleRef = useRef(true);
  const cooldownRef = useRef(false);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container) return;

    let cooldownTimer: ReturnType<typeof setTimeout>;

    const onScroll = (e: Event) => {
      const target = e.target;
      if (!(target instanceof Element)) return;

      const scrollTop = target.scrollTop;
      const prev = lastScrollTopRef.current;
      lastScrollTopRef.current = scrollTop;

      // Ignore tiny deltas (sub-pixel / momentum noise)
      if (Math.abs(scrollTop - prev) < 2) return;

      const shouldShow = scrollTop <= 10 || scrollTop < prev;

      // Only update if the value actually changed AND we're not in cooldown
      if (shouldShow !== titleVisibleRef.current && !cooldownRef.current) {
        titleVisibleRef.current = shouldShow;
        setTitleVisible(shouldShow);

        // Lock state for 250ms (matches CSS transition) to prevent flicker
        cooldownRef.current = true;
        clearTimeout(cooldownTimer);
        cooldownTimer = setTimeout(() => {
          cooldownRef.current = false;
        }, 250);
      }
    };

    // Capture phase catches scroll events from any descendant
    container.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      container.removeEventListener('scroll', onScroll, { capture: true });
      clearTimeout(cooldownTimer);
    };
  }, [currentNoteId, editorMode]);

  // Reset title visibility when switching notes
  useEffect(() => {
    setTitleVisible(true);
    titleVisibleRef.current = true;
    lastScrollTopRef.current = 0;
    cooldownRef.current = false;
  }, [currentNoteId]);

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
      {!isZenMode && <EditorHeader note={currentNote} canEdit={canEdit} canShare={canShare} titleVisible={titleVisible} />}
      <div ref={editorContainerRef} className="flex-1 overflow-hidden">
        {renderEditor()}
      </div>
    </div>
  );
}
