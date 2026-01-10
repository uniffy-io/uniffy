import { useEffect, useRef, useCallback } from 'react';
import { Crepe } from '@milkdown/crepe';
import { oneDark } from '@codemirror/theme-one-dark';
import { languages } from '@codemirror/language-data';
import { basicSetup } from 'codemirror';
import type { Note } from '@/gen/notes/v1/notes_pb';
import type { PlainMessage } from '@bufbuild/protobuf';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { setDraftContent } from '../../store/editorSlice';

// Import only common Crepe styles - frame themes set global html/body styles that break our app
import '@milkdown/crepe/theme/common/style.css';

// Import our custom overrides that handle theming
import '../../styles/notes-editor.css';

interface CrepeEditorProps {
  note: PlainMessage<Note>;
  /** When true, the editor is read-only (no editing, no toolbar, no slash commands) */
  readonly?: boolean;
  /** Content to display - if not provided, uses draft content or note content */
  content?: string;
  /** Custom class name for the wrapper */
  className?: string;
}

/** Helper to clear all children from a container */
function clearContainer(container: HTMLElement) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

/** Creates Crepe configuration */
function createCrepeConfig(root: HTMLElement, content: string, readonly: boolean) {
  return {
    root,
    defaultValue: content,
    features: {
      [Crepe.Feature.CodeMirror]: true,
      [Crepe.Feature.ListItem]: true,
      [Crepe.Feature.LinkTooltip]: true,
      [Crepe.Feature.ImageBlock]: true,
      // Disable editing features in readonly mode
      [Crepe.Feature.BlockEdit]: !readonly,
      [Crepe.Feature.Placeholder]: !readonly,
      [Crepe.Feature.Toolbar]: !readonly,
      [Crepe.Feature.Cursor]: !readonly,
      [Crepe.Feature.Table]: true,
      [Crepe.Feature.Latex]: true,
    },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: {
        text: 'Start writing, use "/" for commands...',
        mode: 'doc' as const,
      },
      [Crepe.Feature.CodeMirror]: {
        theme: oneDark,
        languages: languages,
        extensions: [basicSetup],
        searchPlaceholder: 'Search language...',
        noResultText: 'No language found',
      },
    },
  };
}

export function CrepeEditor({ note, readonly = false, content: propContent, className }: CrepeEditorProps) {
  const dispatch = useAppDispatch();
  const editorState = useAppSelector((state) => state.editor);
  const draftContent = editorState?.draftContent || {};
  const settings = editorState?.settings || {};
  const editorRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const contentRef = useRef<string>('');

  // Use provided content, or fall back to draft content, or note content
  const content = propContent ?? (draftContent[note.id] !== undefined ? draftContent[note.id] : note.content);

  // Handle content changes from the editor
  const handleContentChange = useCallback((markdown: string) => {
    if (readonly) return;
    dispatch(setDraftContent({
      noteId: note.id,
      content: markdown,
    }));
  }, [dispatch, note.id, readonly]);

  // Initialize Crepe editor
  useEffect(() => {
    if (!editorRef.current) return;

    const container = editorRef.current;
    let cancelled = false;
    
    // Clean up any existing instance first
    if (crepeRef.current) {
      crepeRef.current.destroy();
      crepeRef.current = null;
    }
    
    // Clear the container to prevent duplication
    clearContainer(container);
    
    contentRef.current = content;

    const crepe = new Crepe(createCrepeConfig(container, content, readonly));

    // Listen for markdown changes (only if not readonly)
    if (!readonly) {
      crepe.on((listener) => {
        listener.markdownUpdated((_ctx, markdown, prevMarkdown) => {
          if (markdown !== prevMarkdown) {
            handleContentChange(markdown);
          }
        });
      });
    }

    crepe.create().then(() => {
      // If effect was cleaned up before create finished, destroy immediately
      if (cancelled) {
        crepe.destroy();
        return;
      }
      crepeRef.current = crepe;
      if (readonly) {
        crepe.setReadonly(true);
      }
    });

    return () => {
      cancelled = true;
      if (crepeRef.current) {
        crepeRef.current.destroy();
        crepeRef.current = null;
      }
      // Also clear container on cleanup to handle Strict Mode remount
      clearContainer(container);
    };
  }, [note.id, readonly, handleContentChange]);

  // Update content when it changes externally (for preview pane syncing)
  useEffect(() => {
    if (!readonly || !editorRef.current) return;
    
    // Only update if content actually changed and editor exists
    if (contentRef.current === content) return;
    if (!crepeRef.current) return;
    
    contentRef.current = content;
    const container = editorRef.current;
    let cancelled = false;
    
    // Destroy current instance
    crepeRef.current.destroy();
    crepeRef.current = null;
    
    // Clear container before recreating
    clearContainer(container);
    
    // Recreate with new content
    const crepe = new Crepe(createCrepeConfig(container, content, true));

    crepe.create().then(() => {
      if (cancelled) {
        crepe.destroy();
        return;
      }
      crepeRef.current = crepe;
      crepe.setReadonly(true);
    });

    return () => {
      cancelled = true;
    };
  }, [content, readonly]);

  return (
    <div className={`crepe-editor-wrapper h-full overflow-y-auto ${className || ''}`}>
      <div 
        ref={editorRef} 
        className="crepe-editor prose prose-slate dark:prose-invert max-w-none px-8 py-4"
        style={{ 
          fontSize: `${settings?.fontSize || 16}px`,
          lineHeight: settings?.lineHeight || 1.6,
        }}
      />
    </div>
  );
}
