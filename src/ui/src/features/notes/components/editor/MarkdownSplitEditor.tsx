import { useRef, useEffect, useCallback, useState } from 'react';
import { EditorView, keymap } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { defaultKeymap } from '@codemirror/commands';
import type { Note } from '@/gen/notes/v1/notes_pb';
import type { PlainMessage } from '@bufbuild/protobuf';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setDraftContent } from '../../store/editorSlice';
import { CrepeEditor } from './CrepeEditor';

interface MarkdownSplitEditorProps {
  note: PlainMessage<Note>;
}

const MIN_PANE_WIDTH = 200; // Minimum width in pixels

export function MarkdownSplitEditor({ note }: MarkdownSplitEditorProps) {
  const dispatch = useAppDispatch();
  const editorState = useAppSelector((state) => state.editor);
  const draftContent = editorState?.draftContent || {};
  const settings = editorState?.settings || {};
  const showMarkdownPreview = settings?.showMarkdownPreview ?? true;
  
  const content = draftContent[note.id] !== undefined ? draftContent[note.id] : note.content;
  
  // CodeMirror refs
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const codemirrorViewRef = useRef<EditorView | null>(null);
  
  // Resizer state
  const containerRef = useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatio] = useState(0.5); // 50% by default
  const [isDragging, setIsDragging] = useState(false);

  const handleContentChange = useCallback((newContent: string) => {
    dispatch(setDraftContent({
      noteId: note.id,
      content: newContent,
    }));
  }, [dispatch, note.id]);

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
            padding: '24px 32px',
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
  }, [note.id, settings?.fontSize, settings?.lineHeight]);

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
      <div ref={containerRef} className="flex-1 flex overflow-hidden relative">
        {/* CodeMirror Editor Pane */}
        <div 
          className="overflow-hidden h-full"
          style={{ width: showMarkdownPreview ? `${splitRatio * 100}%` : '100%' }}
        >
          <div ref={editorContainerRef} className="h-full" />
        </div>
        
        {/* Resizer Handle */}
        {showMarkdownPreview && (
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
        
        {/* Preview Pane - Using CrepeEditor in readonly mode */}
        {showMarkdownPreview && (
          <div 
            className="overflow-hidden h-full"
            style={{ width: `${(1 - splitRatio) * 100}%` }}
          >
            <CrepeEditor 
              note={note} 
              readonly 
              content={content}
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
