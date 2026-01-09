import { Editor, rootCtx, defaultValueCtx } from '@milkdown/core';
import { commonmark } from '@milkdown/preset-commonmark';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { listener, listenerCtx } from '@milkdown/plugin-listener';
import { history } from '@milkdown/plugin-history';
import { useMemo, useRef, useEffect } from 'react';
import type { Note } from '@/gen/notes/v1/notes_pb';
import type { PlainMessage } from '@bufbuild/protobuf';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setDraftContent } from '../../store/editorSlice';
import '@milkdown/theme-nord/style.css';
import { codeBlockComponent, codeBlockConfig } from '@milkdown/components/code-block';
import { languages } from '@codemirror/language-data';
import { defaultKeymap } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';

interface MarkdownEditorProps {
  note: PlainMessage<Note>;
}

function MarkdownEditorInner({ note }: MarkdownEditorProps) {
  const dispatch = useAppDispatch();
  const { draftContent, autosave, settings } = useAppSelector((state) => state.editor);
  const { previewMode } = settings;
  
  const content = draftContent[note.id] !== undefined ? draftContent[note.id] : note.content;
  
  // Only create Milkdown editor if we're in pure edit mode (WYSIWYG)
  const shouldUseMilkdown = previewMode === 'edit';
  
  // Store initial content to avoid recreation on every content change
  const initialContent = useMemo(() => content, [note.id]);
  
  // CodeMirror editor ref for split mode
  const editorRef = useRef<HTMLDivElement>(null);
  const codemirrorViewRef = useRef<EditorView | null>(null);
  
  // Setup CodeMirror editor for split mode
  useEffect(() => {
    if (previewMode === 'split' && editorRef.current && !codemirrorViewRef.current) {
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
              dispatch(setDraftContent({
                noteId: note.id,
                content: newContent,
              }));
            }
          }),
        ],
      });
      
      codemirrorViewRef.current = new EditorView({
        state,
        parent: editorRef.current,
      });
    }
    
    // Update content when note changes
    if (codemirrorViewRef.current && previewMode === 'split') {
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
    }
    
    // Cleanup
    return () => {
      if (previewMode !== 'split' && codemirrorViewRef.current) {
        codemirrorViewRef.current.destroy();
        codemirrorViewRef.current = null;
      }
    };
  }, [previewMode, note.id, content, dispatch]);
  
  useEditor(
    (root) => {
      if (!shouldUseMilkdown) return undefined;
      return Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, initialContent);
          ctx.update(codeBlockConfig.key, (defaultConfig) => ({
            ...defaultConfig,
            languages,
            extensions: [basicSetup, oneDark, keymap.of(defaultKeymap)],
            renderLanguage: (language, selected) =>
              selected ? `✔ ${language}` : language,
          }));
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            dispatch(setDraftContent({
              noteId: note.id,
              content: markdown,
            }));
          });
        })
        .use(commonmark)
        .use(codeBlockComponent)
        .use(listener)
        .use(history);
    },
    [shouldUseMilkdown, note.id, initialContent, dispatch]
  );
  
  // Handle code block autocomplete (only for textarea fallback if needed)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget;
    const { selectionStart, value } = textarea;
    
    // Check if user just typed the third backtick
    if (e.key === '`' && value.substring(selectionStart - 2, selectionStart) === '``') {
      e.preventDefault();
      
      // Insert code block structure
      const before = value.substring(0, selectionStart);
      const after = value.substring(selectionStart);
      const newContent = `${before}\`\n\n\`\`\`${after}`;
      
      dispatch(setDraftContent({
        noteId: note.id,
        content: newContent,
      }));
      
      // Set cursor position inside the code block
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = selectionStart + 2;
        textarea.focus();
      }, 0);
    }
  };
  
  // Setup readonly Milkdown for preview
  const previewEditorRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if ((previewMode === 'split' || previewMode === 'preview') && previewEditorRef.current) {
      const editorInstance = Editor.make()
        .config((ctx) => {
          ctx.set(rootCtx, previewEditorRef.current!);
          ctx.set(defaultValueCtx, content);
          ctx.update(codeBlockConfig.key, (defaultConfig) => ({
            ...defaultConfig,
            languages,
            extensions: [basicSetup, oneDark, keymap.of(defaultKeymap)],
          }));
        })
        .use(commonmark)
        .use(codeBlockComponent)
        .create();
      
      return () => {
        editorInstance.then(editor => editor.destroy());
      };
    }
  }, [previewMode, content]);
  
  const lastSavedTime = autosave.lastSaved[note.id];
  const isSaving = autosave.isSaving[note.id];
  const saveError = autosave.error[note.id];
  
  // Format last saved time
  const getLastSavedText = () => {
    if (!lastSavedTime) return 'Not saved';
    const secondsAgo = Math.floor((Date.now() - lastSavedTime) / 1000);
    if (secondsAgo < 5) return 'Saved just now';
    if (secondsAgo < 60) return `Saved ${secondsAgo}s ago`;
    const minutesAgo = Math.floor(secondsAgo / 60);
    return `Saved ${minutesAgo}m ago`;
  };
  
  return (
    <div className="flex flex-col h-full">
      {/* Editor/Preview Content */}
      <div className="flex-1 overflow-hidden">
        {previewMode === 'split' ? (
          <div className="flex h-full">
            {/* CodeMirror Editor Pane */}
            <div className="flex-1 overflow-hidden border-r border-border">
              <div ref={editorRef} className="h-full" />
            </div>
            {/* Preview Pane */}
            <div className="flex-1 overflow-y-auto px-8 py-6">
              <div ref={previewEditorRef} />
            </div>
          </div>
        ) : previewMode === 'edit' ? (
          <div className="h-full overflow-y-auto px-8 py-6">
            <Milkdown />
          </div>
        ) : (
          <div className="h-full overflow-y-auto px-8 py-6">
            <div ref={previewEditorRef} />
          </div>
        )}
      </div>
      
      {/* Footer */}
      <div className="border-t border-border px-4 py-2 flex items-center justify-between text-xs text-muted-foreground flex-shrink-0">
        <div className="flex items-center gap-4">
          {/* Autosave Status */}
          <div className="flex items-center gap-2">
            {isSaving ? (
              <>
                <div className="h-2 w-2 rounded-full bg-yellow-500 animate-pulse" />
                <span>Saving...</span>
              </>
            ) : saveError ? (
              <>
                <div className="h-2 w-2 rounded-full bg-red-500" />
                <span className="text-red-600 dark:text-red-400">Save failed</span>
              </>
            ) : (
              <>
                <div className="h-2 w-2 rounded-full bg-green-500" />
                <span>{getLastSavedText()}</span>
              </>
            )}
          </div>
          
          {/* Version */}
          <span>v{note.version}</span>
          
          {/* Word Count */}
          <span>{content.split(/\s+/).filter(Boolean).length} words</span>
        </div>
        
        <div className="flex items-center gap-2">
          <span>Markdown</span>
        </div>
      </div>
    </div>
  );
}

export function MarkdownEditor({ note }: MarkdownEditorProps) {
  return (
    <MilkdownProvider>
      <MarkdownEditorInner note={note} />
    </MilkdownProvider>
  );
}
