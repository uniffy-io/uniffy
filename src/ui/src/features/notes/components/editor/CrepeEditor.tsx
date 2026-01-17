import { useEffect, useRef, useCallback, useState } from 'react';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/core';
import { oneDark } from '@codemirror/theme-one-dark';
import { languages } from '@codemirror/language-data';
import { basicSetup } from 'codemirror';
import { useAppSelector } from '@/app/hooks';
import { useAutosave } from '../../hooks/useNotesHooks';
import { mentionPlugins, onMentionTrigger, type MentionTriggerEvent } from './plugins/mention';
import { MentionSearch } from './plugins/mention/MentionSearch';
import { createPortal } from 'react-dom';
import type { SearchResultItem } from '@/gen/search/v1/search_pb';
import type { SerializedNote } from '../../store/notesThunks';

// Import only common Crepe styles - frame themes set global html/body styles that break our app
import '@milkdown/crepe/theme/common/style.css';

// Import our custom overrides that handle theming
import '../../styles/notes-editor.css';

interface CrepeEditorProps {
  note: SerializedNote;
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

  // Handle content changes from the editor
  const handleContentChange = useCallback((markdown: string) => {
    if (readonly) return;
    // Schedule autosave (debounced)
    scheduleAutosave(markdown);
  }, [readonly, scheduleAutosave]);

  // Handle mention selection
  const handleMentionSelect = useCallback((result: SearchResultItem) => {
    if (!mentionPopup) return;

    const { view, from: storedFrom, query } = mentionPopup;
    const { state, dispatch } = view;
    const { schema } = state;

    // Get the mention node type from schema
    const mentionType = schema.nodes.mention;
    if (!mentionType) {
      console.error('[CrepeEditor] Mention node type not found in schema');
      setMentionPopup(null);
      return;
    }

    // Use stored from position (@ symbol) and calculate to based on query length
    // from = position of @, to = from + 1 (@) + query length
    const from = storedFrom;
    const to = storedFrom + 1 + query.length;

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
    // Only register callback for non-readonly editors (prevents duplicate popups)
    if (readonly) return;

    const unsubscribe = onMentionTrigger((event) => {
      setMentionPopup(event);
    });

    return () => {
      unsubscribe();
    };
  }, [readonly]);

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
    initializedNoteIdRef.current = note.id;

    const crepe = new Crepe(createCrepeConfig(container, content, readonly));

    // CRITICAL: Add plugins BEFORE calling create()
    // Access the underlying Milkdown editor and register our custom plugins
    try {
      const editor = crepe.editor;
      // Register mention plugins (includes view capture plugin)
      editor.use(mentionPlugins);
      // Store the editor reference globally so we can access it in plugins
      (window as any).__milkdownEditor = editor;
    } catch {
      // Plugin registration failed silently
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
          // Get the ProseMirror view from the context
          const view = ctx.get(editorViewCtx);
          if (view) {
            (window as any).__milkdownEditorView = view;
          }
        });
      } catch {
        // Editor view access failed silently
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
      editor.use(mentionPlugins);
    } catch {
      // Plugin registration failed silently
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
      } catch {
        // Editor view access failed silently
      }

      crepe.setReadonly(true);
    });

    return () => {
      cancelled = true;
    };
  }, [content, readonly]);

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

      {/* Mention search popup - only for editable mode */}
      {!readonly && mentionPopup && createPortal(
        <MentionSearch
          query={mentionPopup.query}
          from={mentionPopup.from}
          to={mentionPopup.to}
          view={mentionPopup.view}
          onSelect={handleMentionSelect}
          onClose={() => setMentionPopup(null)}
          onQueryChange={(newQuery) => setMentionPopup(prev => prev ? { ...prev, query: newQuery } : null)}
        />,
        document.body
      )}
    </>
  );
}
