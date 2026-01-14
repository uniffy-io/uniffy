import { useEffect, useRef, useCallback, useState } from 'react';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/core';
import { oneDark } from '@codemirror/theme-one-dark';
import { languages } from '@codemirror/language-data';
import { basicSetup } from 'codemirror';
import type { Note } from '@/gen/notes/v1/notes_pb';
import type { PlainMessage } from '@bufbuild/protobuf';
import { useAppSelector } from '@/app/hooks';
import { useAutosave } from '../../hooks/useNotesHooks';
import { mentionPlugins, onMentionTrigger, type MentionTriggerEvent } from './plugins/mention';
import { MentionSearch } from './plugins/mention/MentionSearch';
import { createPortal } from 'react-dom';
import type { SearchResultItem } from '@/gen/search/v1/search_pb';

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

  // Mention popup state
  const [mentionPopup, setMentionPopup] = useState<MentionTriggerEvent | null>(null);

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

  // Handle mention selection
  const handleMentionSelect = useCallback((result: SearchResultItem) => {
    if (!mentionPopup) return;

    const { view, from, to } = mentionPopup;
    const { state, dispatch } = view;
    const { schema } = state;

    // Get the mention node type from schema
    const mentionType = schema.nodes.mention;
    if (!mentionType) {
      console.error('[CrepeEditor] Mention node type not found in schema');
      setMentionPopup(null);
      return;
    }

    // Create the mention node using URN from search result
    const mention = mentionType.create({
      urn: result.urn,
      label: result.title,
    });

    // Replace the @ trigger and query with the mention
    const tr = state.tr.replaceWith(from, to, mention);

    // Add a space after the mention
    const spacePos = from + 1;
    tr.insertText(' ', spacePos);

    // Set cursor after the space
    tr.setSelection((state.selection.constructor as any).near(tr.doc.resolve(spacePos + 1)));

    dispatch(tr);
    view.focus();
    setMentionPopup(null);
  }, [mentionPopup]);

  // Register mention trigger callback
  useEffect(() => {
    console.log('[CrepeEditor] Registering mention trigger callback');
    onMentionTrigger((event) => {
      console.log('[CrepeEditor] Mention callback fired with event:', event);
      setMentionPopup(event);
    });
    return () => {
      console.log('[CrepeEditor] Unregistering mention trigger callback');
      onMentionTrigger(() => {});
    };
  }, []);

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

    // CRITICAL: Add plugins BEFORE calling create()
    // Access the underlying Milkdown editor and register our custom plugins
    try {
      const editor = crepe.editor;
      console.log('[CrepeEditor] Registering custom plugins...');

      // Register mention plugins (includes view capture plugin)
      editor.use(mentionPlugins);

      console.log('[CrepeEditor] Plugins registered successfully');

      // Store the editor reference globally so we can access it in plugins
      (window as any).__milkdownEditor = editor;
    } catch (error) {
      console.error('[CrepeEditor] Failed to register plugins:', error);
    }

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

    // Now create the editor with plugins already registered
    crepe.create().then(() => {
      // If effect was cleaned up before create finished, destroy immediately
      if (cancelled) {
        crepe.destroy();
        return;
      }
      crepeRef.current = crepe;

      // Access the editor view after creation and store it globally
      try {
        const editor = crepe.editor;
        editor.action((ctx) => {
          console.log('[CrepeEditor] Accessing editor view from context...');
          // Get the ProseMirror view from the context
          const view = ctx.get(editorViewCtx);
          console.log('[CrepeEditor] Got editor view:', view);
          if (view) {
            (window as any).__milkdownEditorView = view;
            console.log('[CrepeEditor] Stored editor view globally');
          }
        });
      } catch (error) {
        console.error('[CrepeEditor] Failed to access editor view:', error);
      }

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

    // Register plugins before create (same as above)
    try {
      const editor = crepe.editor;
      console.log('[CrepeEditor] Registering plugins in readonly mode...');
      editor.use(mentionPlugins);
      console.log('[CrepeEditor] Plugins registered successfully in readonly mode');
    } catch (error) {
      console.error('[CrepeEditor] Failed to register plugins in readonly mode:', error);
    }

    crepe.create().then(() => {
      if (cancelled) {
        crepe.destroy();
        return;
      }
      crepeRef.current = crepe;

      // Store editor view for readonly mode too
      try {
        const editor = crepe.editor;
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          if (view) {
            (window as any).__milkdownEditorView = view;
          }
        });
      } catch (error) {
        console.error('[CrepeEditor] Failed to access editor view in readonly mode:', error);
      }

      crepe.setReadonly(true);
    });

    return () => {
      cancelled = true;
    };
  }, [content, readonly]);

  console.log('[CrepeEditor] Render - mentionPopup state:', mentionPopup);

  return (
    <>
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

      {/* Mention search popup */}
      {mentionPopup && (
        <>
          {console.log('[CrepeEditor] Rendering mention popup!', mentionPopup)}
          {createPortal(
            <MentionSearch
              query={mentionPopup.query}
              from={mentionPopup.from}
              to={mentionPopup.to}
              view={mentionPopup.view}
              onSelect={handleMentionSelect}
              onClose={() => setMentionPopup(null)}
            />,
            document.body
          )}
        </>
      )}
    </>
  );
}
