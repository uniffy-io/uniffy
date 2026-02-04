/**
 * Reusable Markdown Editor with @ Mention Support
 *
 * A simplified Milkdown/Crepe editor for use across features.
 * Supports markdown formatting and @mentions for referencing any UNIFFY content.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx } from '@milkdown/core';
import { Selection } from '@milkdown/prose/state';
import { toggleMark } from '@milkdown/prose/commands';
import { wrapIn, lift } from '@milkdown/prose/commands';
import { createPortal } from 'react-dom';
import {
  mentionPlugins,
  onMentionTrigger,
  MentionSearch,
  type MentionTriggerEvent,
} from '@/features/notes/components/editor/plugins/mention';
import type { SearchResultItem } from '@/gen/search/v1/search_pb';
import { cn } from '@/shared/utils/cn';

// Import Crepe styles
import '@milkdown/crepe/theme/common/style.css';

// Import custom theme overrides
import '@/features/notes/styles/notes-editor.css';

interface MarkdownEditorProps {
  /** Current markdown content */
  value: string;
  /** Called when content changes */
  onChange: (markdown: string) => void;
  /** Placeholder text when empty */
  placeholder?: string;
  /** Whether the editor is read-only */
  readonly?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Minimum height of the editor */
  minHeight?: string;
  /** Maximum height before scrolling (only in compact mode) */
  maxHeight?: string;
  /** Whether to show the floating toolbar (Crepe's default) */
  showToolbar?: boolean;
  /** Whether to show the bottom formatting toolbar (Slack-style) */
  showBottomToolbar?: boolean;
  /** Compact mode: minimal features, constrained height. Full mode: all formatting features */
  compact?: boolean;
}

/** Formatting toolbar button component */
function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
        active && 'text-primary bg-primary/10'
      )}
    >
      {children}
    </button>
  );
}

/** Toolbar separator */
function ToolbarSeparator() {
  return <div className="w-px h-5 bg-border mx-1" />;
}

/** Helper to clear all children from a container */
function clearContainer(container: HTMLElement) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

/** Creates Crepe configuration */
function createCrepeConfig(
  root: HTMLElement,
  content: string,
  readonly: boolean,
  placeholder: string,
  showToolbar: boolean,
  compact: boolean,
  showBottomToolbar: boolean
) {
  // When bottom toolbar is shown, enable formatting features
  const hasFormatting = showBottomToolbar || !compact;

  return {
    root,
    defaultValue: content,
    features: {
      [Crepe.Feature.CodeMirror]: hasFormatting,
      [Crepe.Feature.ListItem]: hasFormatting,
      [Crepe.Feature.LinkTooltip]: false, // We handle this ourselves
      [Crepe.Feature.ImageBlock]: false, // Never show images
      [Crepe.Feature.BlockEdit]: false, // Never show block edit menu
      [Crepe.Feature.Placeholder]: !readonly,
      [Crepe.Feature.Toolbar]: !readonly && showToolbar, // Floating toolbar
      [Crepe.Feature.Cursor]: !readonly,
      [Crepe.Feature.Table]: hasFormatting,
      [Crepe.Feature.Latex]: false, // No LaTeX
    },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: {
        text: placeholder,
        mode: 'doc' as const,
      },
    },
  };
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = 'Start writing, use @ to mention...',
  readonly = false,
  className,
  minHeight = '120px',
  showToolbar = false,
  showBottomToolbar = false,
  compact = true,
}: MarkdownEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const contentRef = useRef<string>(value);
  const isInitializedRef = useRef(false);

  // Mention popup state
  const [mentionPopup, setMentionPopup] = useState<MentionTriggerEvent | null>(null);

  // Format handlers
  const handleBold = useCallback(() => {
    if (!crepeRef.current) return;
    crepeRef.current.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (view) {
        const { state, dispatch } = view;
        const markType = state.schema.marks.strong;
        if (markType) {
          toggleMark(markType)(state, dispatch);
          view.focus();
        }
      }
    });
  }, []);

  const handleItalic = useCallback(() => {
    if (!crepeRef.current) return;
    crepeRef.current.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (view) {
        const { state, dispatch } = view;
        const markType = state.schema.marks.emphasis;
        if (markType) {
          toggleMark(markType)(state, dispatch);
          view.focus();
        }
      }
    });
  }, []);

  const handleStrikethrough = useCallback(() => {
    if (!crepeRef.current) return;
    crepeRef.current.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (view) {
        const { state, dispatch } = view;
        // Try different possible mark names for strikethrough
        const markType = state.schema.marks.strikethrough || state.schema.marks.strike || state.schema.marks.del;
        if (markType) {
          toggleMark(markType)(state, dispatch);
          view.focus();
        }
      }
    });
  }, []);

  const handleHeading = useCallback((level: number) => {
    if (!crepeRef.current) return;
    crepeRef.current.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (view) {
        const { state, dispatch } = view;
        const { $from } = state.selection;
        const headingType = state.schema.nodes.heading;
        const paragraphType = state.schema.nodes.paragraph;

        if (headingType && paragraphType) {
          const currentNode = $from.parent;
          // If clicking the same heading level, convert back to paragraph
          if (currentNode.type === headingType && currentNode.attrs.level === level) {
            const tr = state.tr.setBlockType($from.before(), $from.after(), paragraphType);
            dispatch(tr);
          } else {
            // Convert to the specified heading level
            const tr = state.tr.setBlockType($from.before(), $from.after(), headingType, { level });
            dispatch(tr);
          }
          view.focus();
        }
      }
    });
  }, []);

  const handleBulletList = useCallback(() => {
    if (!crepeRef.current) return;
    crepeRef.current.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (view) {
        const { state, dispatch } = view;
        const listType = state.schema.nodes.bullet_list || state.schema.nodes.bulletList;
        const listItemType = state.schema.nodes.list_item || state.schema.nodes.listItem;

        if (listType && listItemType) {
          // Check if already in a list
          const { $from } = state.selection;
          let inList = false;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type === listType) {
              inList = true;
              break;
            }
          }

          if (inList) {
            lift(state, dispatch);
          } else {
            wrapIn(listType)(state, dispatch);
          }
          view.focus();
        }
      }
    });
  }, []);

  const handleNumberedList = useCallback(() => {
    if (!crepeRef.current) return;
    crepeRef.current.editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      if (view) {
        const { state, dispatch } = view;
        const listType = state.schema.nodes.ordered_list || state.schema.nodes.orderedList;
        const listItemType = state.schema.nodes.list_item || state.schema.nodes.listItem;

        if (listType && listItemType) {
          // Check if already in a list
          const { $from } = state.selection;
          let inList = false;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type === listType) {
              inList = true;
              break;
            }
          }

          if (inList) {
            lift(state, dispatch);
          } else {
            wrapIn(listType)(state, dispatch);
          }
          view.focus();
        }
      }
    });
  }, []);

  // Handle mention selection
  const handleMentionSelect = useCallback(
    (result: SearchResultItem) => {
      if (!mentionPopup) return;

      const { view, from: storedFrom, query } = mentionPopup;
      const { state, dispatch } = view;
      const { schema } = state;

      // Get the mention node type from schema
      const mentionType = schema.nodes.mention;
      if (!mentionType) {
        console.error('[MarkdownEditor] Mention node type not found in schema');
        setMentionPopup(null);
        return;
      }

      // Use stored from position (@ symbol) and calculate to based on query length
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
      tr.setSelection(Selection.near(tr.doc.resolve(spacePos + 1)));

      dispatch(tr);
      view.focus();
      setMentionPopup(null);
    },
    [mentionPopup]
  );

  // Register mention trigger callback
  useEffect(() => {
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

    contentRef.current = value;
    isInitializedRef.current = true;

    const crepe = new Crepe(
      createCrepeConfig(container, value, readonly, placeholder, showToolbar, compact, showBottomToolbar)
    );

    // Register mention plugins BEFORE calling create()
    try {
      const editor = crepe.editor;
      editor.use(mentionPlugins);
    } catch {
      // Plugin registration failed silently
    }

    // Create the editor
    crepe.create().then(() => {
      if (cancelled) {
        crepe.destroy();
        return;
      }
      crepeRef.current = crepe;

      // Store editor view globally for mention plugins
      try {
        const editor = crepe.editor;
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          if (view) {
            (window as Window & { __milkdownEditorView?: unknown }).__milkdownEditorView = view;
          }
        });
      } catch {
        // Editor view access failed silently
      }

      // Listen for markdown changes (only if not readonly)
      if (!readonly) {
        crepe.on((listener) => {
          listener.markdownUpdated((_ctx, markdown, prevMarkdown) => {
            if (cancelled || !crepeRef.current) return;
            if (markdown !== prevMarkdown) {
              contentRef.current = markdown;
              onChange(markdown);
            }
          });
        });
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
      clearContainer(container);
      isInitializedRef.current = false;
    };
    // Only recreate when readonly mode changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readonly, placeholder, showToolbar]);

  // Handle external value changes (for controlled component behavior)
  useEffect(() => {
    // Skip if not initialized or if the value matches current content
    if (!isInitializedRef.current || !crepeRef.current) return;
    if (contentRef.current === value) return;

    // Only update in readonly mode to avoid cursor jumping during editing
    if (readonly) {
      const container = editorRef.current;
      if (!container) return;

      let cancelled = false;

      // Destroy and recreate with new content
      crepeRef.current.destroy();
      crepeRef.current = null;
      clearContainer(container);

      contentRef.current = value;

      const crepe = new Crepe(
        createCrepeConfig(container, value, true, placeholder, showToolbar, compact, showBottomToolbar)
      );

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
        crepe.setReadonly(true);
      });

      return () => {
        cancelled = true;
      };
    }
  }, [value, readonly, placeholder, showToolbar, compact, showBottomToolbar]);

  return (
    <>
      {/* Scoped styles for this MarkdownEditor instance */}
      <style>{`
        .md-editor-compact .milkdown {
          display: block !important;
          min-height: 60px;
        }
        .md-editor-compact .milkdown > div {
          display: block !important;
          min-height: 60px;
        }
        .md-editor-compact .milkdown .editor {
          display: block !important;
        }
        .md-editor-compact .ProseMirror {
          min-height: 60px;
          padding: 0 !important;
          caret-color: hsl(var(--primary));
          outline: none;
        }
        .md-editor-compact .ProseMirror > :first-child {
          margin-top: 0 !important;
        }
        /* Fix placeholder vertical centering - target the placeholder wrapper */
        .md-editor-compact .milkdown .placeholder {
          top: 0 !important;
          transform: none !important;
          align-items: flex-start !important;
        }
        .md-editor-compact .milkdown > .placeholder {
          position: absolute !important;
          top: 0 !important;
          left: 0 !important;
          padding: 8px 12px !important;
        }
        /* Let outer wrapper handle scrolling */
        .md-editor-compact .milkdown {
          overflow: visible !important;
          resize: none !important;
        }
        .md-editor-compact .ProseMirror {
          overflow: visible !important;
          resize: none !important;
        }
      `}</style>
      <div
        className={cn(
          'crepe-editor-wrapper rounded-md border border-border bg-background',
          compact && 'md-editor-compact',
          showBottomToolbar && 'flex flex-col',
          className
        )}
      >
        {/* Editor area */}
        <div
          style={{
            height: minHeight,
            overflowX: 'hidden',
            overflowY: 'auto',
          }}
        >
          <div
            ref={editorRef}
            className="crepe-editor prose prose-sm max-w-none px-3 py-2"
          />
        </div>

        {/* Bottom formatting toolbar (Slack-style) */}
        {showBottomToolbar && !readonly && (
          <div className="flex items-center gap-0.5 px-2 py-1.5 border-t border-border bg-muted/30">
            <ToolbarButton onClick={handleBold} title="Bold (Ctrl+B)">
              <span className="font-bold text-sm">B</span>
            </ToolbarButton>
            <ToolbarButton onClick={handleItalic} title="Italic (Ctrl+I)">
              <span className="italic text-sm">I</span>
            </ToolbarButton>
            <ToolbarButton onClick={handleStrikethrough} title="Strikethrough">
              <span className="line-through text-sm">S</span>
            </ToolbarButton>
            <ToolbarSeparator />
            <ToolbarButton onClick={() => handleHeading(1)} title="Heading 1">
              <span className="font-bold text-xs">H1</span>
            </ToolbarButton>
            <ToolbarButton onClick={() => handleHeading(2)} title="Heading 2">
              <span className="font-bold text-xs">H2</span>
            </ToolbarButton>
            <ToolbarButton onClick={() => handleHeading(3)} title="Heading 3">
              <span className="font-bold text-xs">H3</span>
            </ToolbarButton>
            <ToolbarSeparator />
            <ToolbarButton onClick={handleBulletList} title="Bullet List">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                <circle cx="2" cy="6" r="1" fill="currentColor" />
                <circle cx="2" cy="12" r="1" fill="currentColor" />
                <circle cx="2" cy="18" r="1" fill="currentColor" />
              </svg>
            </ToolbarButton>
            <ToolbarButton onClick={handleNumberedList} title="Numbered List">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 6h13M7 12h13M7 18h13" />
                <text x="1" y="8" fontSize="6" fill="currentColor">1</text>
                <text x="1" y="14" fontSize="6" fill="currentColor">2</text>
                <text x="1" y="20" fontSize="6" fill="currentColor">3</text>
              </svg>
            </ToolbarButton>
          </div>
        )}
      </div>

      {/* Mention search popup */}
      {!readonly &&
        mentionPopup &&
        createPortal(
          <MentionSearch
            query={mentionPopup.query}
            from={mentionPopup.from}
            to={mentionPopup.to}
            view={mentionPopup.view}
            onSelect={handleMentionSelect}
            onClose={() => setMentionPopup(null)}
            onQueryChange={(newQuery: string) =>
              setMentionPopup((prev) => (prev ? { ...prev, query: newQuery } : null))
            }
          />,
          document.body
        )}
    </>
  );
}
