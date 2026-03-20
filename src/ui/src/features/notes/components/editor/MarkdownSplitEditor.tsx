import { useRef, useEffect, useCallback, useState } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { defaultKeymap } from '@codemirror/commands';
import { useAppSelector } from '@/app/hooks';
import { useAutosave } from '@/features/notes/hooks/useNotesHooks';
import { CrepeEditor } from '@/components/editor/CrepeEditor';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';
import type { SerializedNote } from '@/features/notes/store/notesThunks';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';

interface MarkdownSplitEditorProps {
  note: SerializedNote;
}

const MIN_PANE_WIDTH = 200; // Minimum width in pixels

const defaultSettings = { editorMode: 'markdown' as const, showMarkdownPreview: true, fontSize: 16, lineHeight: 1.6, spellCheck: true };

export function MarkdownSplitEditor({ note }: MarkdownSplitEditorProps) {
  const editorState = useAppSelector((state) => state.editor);
  const settings = editorState?.settings ?? defaultSettings;
  const showMarkdownPreview = settings.showMarkdownPreview ?? true;
  const { isMobile } = useBreakpoint();
  const stackVertically = isMobile && showMarkdownPreview;

  // Autosave hook
  const { scheduleAutosave, draftContent } = useAutosave(note.id);
  
  // Check for both null and undefined in draft content
  const content = draftContent != null ? draftContent : note.content;
  
  // CodeMirror refs
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const codemirrorViewRef = useRef<EditorView | null>(null);
  
  // Resizer state
  const containerRef = useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatio] = useState(0.5); // 50% by default
  const [isDragging, setIsDragging] = useState(false);

  const handleContentChange = useCallback((newContent: string) => {
    scheduleAutosave(newContent);
  }, [scheduleAutosave]);

  // Handle resize drag
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      
      const containerRect = containerRef.current.getBoundingClientRect();
      const containerWidth = containerRect.width;
      const mouseX = e.clientX - containerRect.left;
      
      // Calculate ratio with min/max constraints
      const minRatio = MIN_PANE_WIDTH / containerWidth;
      const maxRatio = 1 - minRatio;
      const newRatio = Math.max(minRatio, Math.min(maxRatio, mouseX / containerWidth));
      
      setSplitRatio(newRatio);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Initialize CodeMirror editor
  useEffect(() => {
    if (!editorContainerRef.current) return;

    // Destroy existing instance
    if (codemirrorViewRef.current) {
      codemirrorViewRef.current.destroy();
      codemirrorViewRef.current = null;
    }

    const state = EditorState.create({
      doc: content,
      extensions: [
        basicSetup,
        oneDark,
        markdown({ codeLanguages: languages }),
        keymap.of(defaultKeymap),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newContent = update.state.doc.toString();
            handleContentChange(newContent);
          }
        }),
        EditorView.theme({
          '&': {
            height: '100%',
            fontSize: `${settings?.fontSize || 16}px`,
          },
          '.cm-scroller': {
            overflow: 'auto',
            lineHeight: `${settings?.lineHeight || 1.6}`,
          },
          '.cm-content': {
            padding: isMobile ? '16px' : '24px 32px',
          },
        }),
      ],
    });

    codemirrorViewRef.current = new EditorView({
      state,
      parent: editorContainerRef.current,
    });

    return () => {
      if (codemirrorViewRef.current) {
        codemirrorViewRef.current.destroy();
        codemirrorViewRef.current = null;
      }
    };
    // Note: We intentionally omit `content` and `handleContentChange` from deps.
    // This effect only re-initializes the editor when note.id or settings change.
    // Content sync is handled by the separate useEffect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, settings?.fontSize, settings?.lineHeight, isMobile]);

  // Update CodeMirror content when external changes happen
  useEffect(() => {
    if (!codemirrorViewRef.current) return;

    const currentContent = codemirrorViewRef.current.state.doc.toString();
    if (currentContent !== content) {
      codemirrorViewRef.current.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: content,
        },
      });
    }
  }, [content]);

  return (
    <div className="flex flex-col h-full">
      {/* Editor Content */}
      <div ref={containerRef} className={`flex-1 overflow-hidden relative ${stackVertically ? 'flex flex-col' : 'flex'}`}>
        {/* CodeMirror Editor Pane */}
        <div
          className="overflow-hidden"
          style={stackVertically
            ? { height: showMarkdownPreview ? '50%' : '100%', width: '100%' }
            : { width: showMarkdownPreview ? `${splitRatio * 100}%` : '100%', height: '100%' }
          }
        >
          <div ref={editorContainerRef} className="h-full" />
        </div>

        {/* Resizer Handle - horizontal on mobile, vertical on desktop */}
        {showMarkdownPreview && !stackVertically && (
          <div
            onMouseDown={handleMouseDown}
            className={`
              w-1 h-full cursor-col-resize flex-shrink-0 relative group
              ${isDragging ? 'bg-primary' : 'bg-border hover:bg-primary/50'}
              transition-colors
            `}
          >
            {/* Wider hit area for easier grabbing */}
            <div className="absolute inset-y-0 -left-1 -right-1" />
            {/* Visual indicator on hover/drag */}
            <div
              className={`
                absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                w-1 h-8 rounded-full
                ${isDragging ? 'bg-primary-foreground' : 'bg-transparent group-hover:bg-primary'}
                transition-colors
              `}
            />
          </div>
        )}

        {/* Horizontal separator on mobile stacked layout */}
        {showMarkdownPreview && stackVertically && (
          <div className="h-px w-full bg-border flex-shrink-0" />
        )}

        {/* Preview Pane - Using CrepeEditor in readonly mode */}
        {showMarkdownPreview && (
          <div
            className="overflow-hidden"
            style={stackVertically
              ? { height: '50%', width: '100%' }
              : { width: `${(1 - splitRatio) * 100}%`, height: '100%' }
            }
          >
            <CrepeEditor
              contentType={ContentType.NOTE}
              contentId={note.id}
              value={content}
              readonly
              enableUpload={false}
            />
          </div>
        )}

        {/* Overlay to capture mouse events while dragging */}
        {isDragging && (
          <div className="absolute inset-0 cursor-col-resize z-50" />
        )}
      </div>
    </div>
  );
}
