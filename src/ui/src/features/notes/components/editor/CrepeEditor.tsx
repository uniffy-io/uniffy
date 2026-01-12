import { useEffect, useRef, useCallback } from 'react';
import { Crepe } from '@milkdown/crepe';
import { oneDark } from '@codemirror/theme-one-dark';
import { languages } from '@codemirror/language-data';
import { basicSetup } from 'codemirror';
import type { Note } from '@/gen/notes/v1/notes_pb';
import type { PlainMessage } from '@bufbuild/protobuf';
import { useAppSelector } from '@/app/hooks';
import { useAutosave } from '../../hooks/useNotesHooks';

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
  const editorState = useAppSelector((state) => state.editor);
  const settings = editorState?.settings || {};
  const editorRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const contentRef = useRef<string>('');
  const initializedNoteIdRef = useRef<string | null>(null);

  // Autosave hook - handles debounced saving (only active in edit mode)
  const { scheduleAutosave } = useAutosave(readonly ? null : note.id);
  
  // Get draft content directly from Redux (works in both edit and readonly modes)
  const currentDraft = useAppSelector((state) => state.editor.draftContent[note.id]);

  // Use provided content, or fall back to draft content, or note content
  // Check for both null and undefined in draft content
  const content = propContent ?? (currentDraft != null ? currentDraft : note.content);
  
  console.log('[CrepeEditor] Content calculation:', {
    noteId: note.id,
    noteContent: note.content,
    noteContentLength: note.content?.length,
    propContent,
    currentDraft,
    finalContent: content,
    finalContentLength: content?.length,
    readonly,
  });

  // Handle content changes from the editor
  const handleContentChange = useCallback((markdown: string) => {
    if (readonly) return;
    // Schedule autosave (debounced)
    scheduleAutosave(markdown);
  }, [readonly, scheduleAutosave]);

  // Initialize Crepe editor
  useEffect(() => {
    if (!editorRef.current) return;

    console.log('[CrepeEditor] Initializing with content:', {
      noteId: note.id,
      contentLength: content?.length,
      contentPreview: content?.substring(0, 100),
      hasEditorRef: !!editorRef.current,
      readonly,
    });

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
    initializedNoteIdRef.current = note.id;

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
      initializedNoteIdRef.current = null;
    };
    // Only recreate when note ID or readonly mode changes
    // Content changes in edit mode are handled by editor's internal state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note.id, readonly]);

  // Separate effect to handle content updates in readonly mode only
  useEffect(() => {
    // Only run this effect for readonly mode after initial mount
    if (!readonly || !crepeRef.current) return;
    
    // Check if content actually changed
    if (contentRef.current === content) return;
    
    console.log('[CrepeEditor] Updating readonly content', {
      oldContent: contentRef.current?.substring(0, 50),
      newContent: content?.substring(0, 50),
    });
    
    const container = editorRef.current;
    if (!container) return;
    
    let cancelled = false;
    
    // Destroy current instance
    crepeRef.current.destroy();
    crepeRef.current = null;
    
    // Clear container before recreating
    clearContainer(container);
    
    contentRef.current = content;
    
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
