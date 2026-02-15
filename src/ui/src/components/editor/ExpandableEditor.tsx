import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ArrowsOut, Check, PencilSimple } from '@phosphor-icons/react';
import { CrepeEditor } from '@/components/editor/CrepeEditor';
import { ContentType } from '@/gen/common/v1/common_pb';
import { cn } from '@/shared/utils/cn';

interface ExpandableEditorProps {
  /** Content type for uploads and comments */
  contentType: ContentType;
  /** Content ID for uploads and comments */
  contentId: string;
  /** Markdown content */
  value: string;
  /** Called when content changes */
  onChange: (markdown: string) => void;
  /** Placeholder text for empty editor */
  placeholder?: string;
  /** Enable file uploads (defaults to true when contentId is provided) */
  enableUpload?: boolean;
  /** When true, the editor is read-only */
  readonly?: boolean;
  /** Label shown in the overlay header (e.g. "Description") */
  label?: string;
  /** Called with each uploaded file ID (for deferred attachment when contentId is empty) */
  onFileUploaded?: (fileId: string) => void;
  /** Show full content preview without truncation, with a separate edit button */
  fullPreview?: boolean;
}

export function ExpandableEditor({
  contentType,
  contentId,
  value,
  onChange,
  placeholder = 'Click to add a description...',
  enableUpload = !!contentId,
  readonly = false,
  label = 'Description',
  onFileUploaded,
  fullPreview = false,
}: ExpandableEditorProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  // Initial content snapshot for the expanded editor (set once when opening)
  const [draftInitial, setDraftInitial] = useState(value);

  const handleOpen = useCallback(() => {
    if (readonly) return;
    setDraftInitial(value);
    setEditorReady(false);
    setEditorKey((k) => k + 1);
    setIsExpanded(true);

    // Defer editor mount for smooth animation
    setTimeout(() => {
      setEditorReady(true);
    }, 50);
  }, [readonly, value]);

  const handleClose = useCallback(() => {
    setIsExpanded(false);
    setEditorReady(false);
  }, []);

  const handleEditorChange = useCallback((markdown: string) => {
    onChange(markdown);
  }, [onChange]);

  // Auto-focus the editor when expanded overlay opens
  const editorPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isExpanded || !editorReady) return;
    // Wait for CrepeEditor to mount and create ProseMirror
    const timer = setTimeout(() => {
      const pm = editorPanelRef.current?.querySelector('.ProseMirror') as HTMLElement | null;
      pm?.focus();
    }, 100);
    return () => clearTimeout(timer);
  }, [isExpanded, editorReady]);

  // Close on Escape
  useEffect(() => {
    if (!isExpanded) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => document.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [isExpanded, handleClose]);

  const hasContent = value && value.trim().length > 0;

  return (
    <>
      {/* Collapsed preview - clickable area with rendered content */}
      {fullPreview ? (
        <div className="relative group">
          {hasContent ? (
            <div className="pointer-events-none expandable-editor-preview">
              <CrepeEditor
                contentType={contentType}
                contentId={contentId}
                value={value}
                readonly
                enableUpload={false}
                compact
                className="border-none bg-transparent"
              />
            </div>
          ) : (
            <div
              role="button"
              tabIndex={readonly ? undefined : 0}
              onClick={handleOpen}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleOpen(); }}
              className="text-sm text-muted-foreground italic cursor-pointer hover:text-foreground transition-colors rounded-md bg-muted/50 px-3 py-2"
            >
              {placeholder}
            </div>
          )}

          {/* Edit button */}
          {!readonly && hasContent && (
            <button
              type="button"
              onClick={handleOpen}
              className="absolute top-0 right-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
            >
              <PencilSimple size={12} />
              Edit
            </button>
          )}
        </div>
      ) : (
        <div
          role="button"
          tabIndex={readonly ? undefined : 0}
          onClick={handleOpen}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleOpen(); }}
          className={cn(
            'relative border border-border rounded-lg transition-colors overflow-hidden',
            readonly
              ? 'cursor-default bg-muted/30'
              : 'cursor-pointer hover:border-primary/40 hover:bg-muted/30',
          )}
        >
          {hasContent ? (
            <div className="max-h-[100px] overflow-hidden pointer-events-none expandable-editor-preview">
              <CrepeEditor
                contentType={contentType}
                contentId={contentId}
                value={value}
                readonly
                enableUpload={false}
                compact
                className="border-none bg-transparent"
              />
              {/* Fade-out gradient at the bottom when content overflows */}
              <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-card to-transparent" />
            </div>
          ) : (
            <div className="px-3 py-2.5 min-h-[80px] flex items-start">
              <p className="text-sm text-muted-foreground">{placeholder}</p>
            </div>
          )}

          {/* Expand icon */}
          {!readonly && (
            <div className="absolute top-2 right-2">
              <ArrowsOut
                size={16}
                weight="bold"
                className="text-muted-foreground"
              />
            </div>
          )}
        </div>
      )}

      {/* Expanded overlay */}
      {isExpanded && createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleClose}
          />

          {/* Editor panel */}
          <div className="relative w-full max-w-5xl mx-4 bg-card border border-border rounded-xl shadow-2xl flex flex-col h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
              <h3 className="text-sm font-semibold text-foreground">{label}</h3>
              <button
                type="button"
                onClick={handleClose}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-primary-foreground bg-primary hover:bg-primary/90 transition-colors"
              >
                <Check size={16} weight="bold" />
                Done
              </button>
            </div>

            {/* Editor body - let CrepeEditor's own wrapper handle scrolling */}
            <div ref={editorPanelRef} className="flex-1 min-h-0">
              {editorReady ? (
                <CrepeEditor
                  key={editorKey}
                  contentType={contentType}
                  contentId={contentId}
                  value={draftInitial}
                  onChange={handleEditorChange}
                  placeholder={placeholder}
                  enableUpload={enableUpload}
                  onFileUploaded={onFileUploaded}
                />
              ) : (
                <div className="flex items-center justify-center h-full">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
