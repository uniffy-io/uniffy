import { useRef, useEffect, useCallback, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { defaultKeymap } from '@codemirror/commands';
import { useAppSelector } from '@/app/hooks';
import { useAutosave } from '@/features/notes/hooks/useNotesHooks';
import { CrepeEditor } from '@/components/editor/CrepeEditor';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';
import type { SerializedNote } from '@/features/notes/store/notesThunks';
import { useBreakpoint } from '@/shared/hooks/useBreakpoint';
import { MarkdownMentionSearch } from '@/components/editor/plugins/mention/MarkdownMentionSearch';
import type { SearchResultItem } from '@uniffy/proto/search/v1/search_pb';
import { useTheme } from '@/config/theme/ThemeProvider';
import { createMarkdownEditorTheme } from '@/features/notes/components/editor/markdownEditorTheme';

interface MarkdownSplitEditorProps {
  note: SerializedNote;
  /** Optional title/metadata block rendered above the editor surface in the preview pane. */
  titleSlot?: ReactNode;
}

const MIN_PANE_WIDTH = 200; // Minimum width in pixels

const defaultSettings = { editorMode: 'markdown' as const, showMarkdownPreview: true, showMarkdownLineNumbers: true, fontSize: 16, lineHeight: 1.6, spellCheck: true };

export function MarkdownSplitEditor({ note, titleSlot }: MarkdownSplitEditorProps) {
  const editorState = useAppSelector((state) => state.editor);
  const settings = editorState?.settings ?? defaultSettings;
  const showMarkdownPreview = settings.showMarkdownPreview ?? true;
  const showLineNumbers = settings.showMarkdownLineNumbers ?? true;
  const { isMobile } = useBreakpoint();
  const { resolvedTheme } = useTheme();
  const stackVertically = isMobile && showMarkdownPreview;

  // Autosave hook
  const { scheduleAutosave, draftContent } = useAutosave(note.id);
  
  // Check for both null and undefined in draft content
  const content = draftContent != null ? draftContent : note.content;
  
  // CodeMirror refs
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const codemirrorViewRef = useRef<EditorView | null>(null);
  const themeCompartmentRef = useRef<Compartment>(new Compartment());
  
  // Resizer state
  const containerRef = useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatio] = useState(0.5); // 50% by default
  const [isDragging, setIsDragging] = useState(false);

  // Mention popup state - records the position of `@` so we know what range
  // to overwrite with `[[[label|urn]]]` when the user selects a result.
  const [mentionPopup, setMentionPopup] = useState<{ triggerFrom: number; triggerTo: number; query: string } | null>(null);
  const mentionPopupRef = useRef(mentionPopup);
  mentionPopupRef.current = mentionPopup;

  const handleContentChange = useCallback((newContent: string) => {
    scheduleAutosave(newContent);
  }, [scheduleAutosave]);

  const handleMentionSelect = useCallback((result: SearchResultItem) => {
    const popup = mentionPopupRef.current;
    const view = codemirrorViewRef.current;
    if (!popup || !view) {
      setMentionPopup(null);
      return;
    }
    // Extend the replace range to cover anything the user typed between `@`
    // and the popup taking focus (e.g. partial query text like "@fo").
    const doc = view.state.doc;
    let to = popup.triggerTo;
    while (to < doc.length) {
      const ch = doc.sliceString(to, to + 1);
      if (!ch || /\s/.test(ch)) break;
      to += 1;
    }
    const label = result.title || 'Untitled';
    const insertion = `[[[${label}|${result.urn}]]] `;
    view.dispatch({
      changes: { from: popup.triggerFrom, to, insert: insertion },
      selection: { anchor: popup.triggerFrom + insertion.length },
    });
    setMentionPopup(null);
    view.focus();
  }, []);

  const handleMentionClose = useCallback(() => {
    setMentionPopup(null);
    codemirrorViewRef.current?.focus();
  }, []);

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
        markdown({ codeLanguages: languages }),
        keymap.of(defaultKeymap),
        themeCompartmentRef.current.of(createMarkdownEditorTheme({
          isDark: resolvedTheme === 'dark',
          fontSize: settings?.fontSize || 16,
          lineHeight: settings?.lineHeight || 1.6,
          showLineNumbers,
          isMobile,
        })),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const newContent = update.state.doc.toString();
            handleContentChange(newContent);
          }
          // Mention trigger: detect a single `@` char inserted at a word
          // boundary. Runs after the change is committed so the doc state is
          // authoritative - no microtask races with CodeMirror's beforeinput.
          if (update.docChanged && !mentionPopupRef.current) {
            update.changes.iterChanges((_fromA, _toA, fromB, _toB, inserted) => {
              if (inserted.length !== 1 || inserted.sliceString(0) !== '@') return;
              const doc = update.state.doc;
              const charBefore = fromB > 0 ? doc.sliceString(fromB - 1, fromB) : '';
              const atWordBoundary = !charBefore || /\s/.test(charBefore);
              if (!atWordBoundary) return;
              setMentionPopup({ triggerFrom: fromB, triggerTo: fromB + 1, query: '' });
            });
          }
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
    // Only re-init when the note swaps. Theme + sizing live in a Compartment
    // below so they reconfigure in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id]);

  // Live-reconfigure the editor theme when the app theme or any of the
  // baked-in display settings (font, line height, gutter, breakpoint) change.
  useEffect(() => {
    const view = codemirrorViewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartmentRef.current.reconfigure(
        createMarkdownEditorTheme({
          isDark: resolvedTheme === 'dark',
          fontSize: settings?.fontSize || 16,
          lineHeight: settings?.lineHeight || 1.6,
          showLineNumbers,
          isMobile,
        }),
      ),
    });
  }, [resolvedTheme, settings?.fontSize, settings?.lineHeight, showLineNumbers, isMobile]);

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
              headerSlot={titleSlot}
            />
          </div>
        )}

        {/* Overlay to capture mouse events while dragging */}
        {isDragging && (
          <div className="absolute inset-0 cursor-col-resize z-50" />
        )}
      </div>

      {mentionPopup && createPortal(
        <MarkdownMentionSearch
          initialQuery={mentionPopup.query}
          onSelect={handleMentionSelect}
          onClose={handleMentionClose}
        />,
        document.body,
      )}
    </div>
  );
}
