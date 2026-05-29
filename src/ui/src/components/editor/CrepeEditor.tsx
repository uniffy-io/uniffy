import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx, parserCtx, serializerCtx } from '@milkdown/core';
import { Plugin, Selection } from '@milkdown/prose/state';
import type { Node } from '@milkdown/prose/model';
import type { EditorView } from '@milkdown/prose/view';
import { upload, uploadConfig, type Uploader } from '@milkdown/kit/plugin/upload';
import { $prose } from '@milkdown/kit/utils';
import {
  ySyncPlugin,
  ySyncPluginKey,
  yCursorPlugin,
  yUndoPlugin,
  prosemirrorToYXmlFragment,
} from 'y-prosemirror';
import * as Y from 'yjs';
import type { Awareness } from 'y-protocols/awareness';
import {
  MARKDOWN_TEXT_FIELD,
  PROSEMIRROR_FRAGMENT_FIELD,
  replaceMarkdownYText,
} from '@/features/notes/realtime/markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { languages } from '@codemirror/language-data';
import { basicSetup } from 'codemirror';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
import { openViewerWithFetch } from '@/features/files';
import { parseFileUrl, buildFileUrl, buildMediaStreamUrl } from '@/shared/utils/fileUrls';
import { parseUrn, UrnType } from '@/shared/utils/urn';
import { searchApi } from '@/features/search';
import { tagPlugins } from '@/components/editor/plugins/tag';
import { mentionPlugins, onMentionTrigger, type MentionTriggerEvent } from '@/components/editor/plugins/mention';
import { videoPlugins } from '@/components/editor/plugins/video';
import { MentionSearch } from '@/components/editor/plugins/mention/MentionSearch';
import { createPortal } from 'react-dom';
import { openSpotlightSearch } from '@/features/search';
import { useGlobalShortcuts } from '@/features/settings';
import { createImageUploadHandler, uploadImage } from '@/components/editor/utils/imageUploader';
import { createVideoUploadHandler, uploadVideo } from '@/components/editor/utils/videoUploader';
import { createAudioUploadHandler, uploadAudio } from '@/components/editor/utils/audioUploader';
import { findHeadingBySlug } from '@/components/editor/utils/headingScroll';
import { audioPlugins, setAudioRecordingUploadHandler } from '@/components/editor/plugins/audio';
import { tocPlugins } from '@/components/editor/plugins/toc';
import { highlightPlugins, highlightMark } from '@/components/editor/plugins/highlight';
import { HighlightPicker } from '@/components/editor/plugins/highlight/HighlightPicker';
import { underlinePlugins } from '@/components/editor/plugins/underline';
import {
  insertTocBlock,
  insertVideoBlock,
  insertAudioBlock,
  insertAudioRecording,
} from '@/components/editor/commands/insertBlocks';
import {
  createSelectionVersionPlugin,
  disposeSelectionScope,
} from '@/components/editor/utils/selectionVersionPlugin';
import type { EditorHandle } from '@/components/editor/EditorHandle';
import { registerEditor } from '@/components/editor/editorRegistry';
import type { SearchResultItem } from '@uniffy/proto/search/v1/search_pb';
import { InlineCommentPopover } from '@/features/comments/components/InlineCommentPopover';
import { CommentThreadPopover } from '@/features/comments/components/CommentThreadPopover';
import {
  commentDecorationsPlugin,
  updateCommentDecorations,
  setCommentClickHandler,
} from '@/features/comments/plugins/commentDecorations';
import type { CommentAnchor } from '@/features/comments/plugins/commentDecorations';
import { useComments } from '@/features/comments/hooks/useComments';
import { setActiveComment } from '@/features/comments/store/commentsSlice';
import { CommentAnchorType } from '@uniffy/proto/comments/v1/comments_pb';
import { ContentType } from '@uniffy/proto/common/v1/common_pb';

// Import only common Crepe styles - frame themes set global html/body styles that break our app
import '@milkdown/crepe/theme/common/style.css';

// Comment highlight styles
import '@/features/comments/styles/comments.css';

// Import our custom overrides that handle theming
import '@/components/editor/styles/editor.css';

export interface CrepeRealtimeBinding {
  ydoc: Y.Doc;
  awareness: Awareness;
  undoManager: Y.UndoManager | null;
  sessionId: string;
  /**
   * Resolves on the first ``sync`` event from the provider. Gates
   * cold-start seeding so we never race the SyncStep2 frame.
   */
  whenSynced: Promise<void>;
}

interface CrepeEditorProps {
  contentType: ContentType;
  contentId: string;
  value: string;
  onChange?: (markdown: string) => void;
  /** When set, the Yjs doc is the source of truth; `value` is ignored. `onChange` still fires with serialized markdown. */
  realtime?: CrepeRealtimeBinding;
  readonly?: boolean;
  className?: string;
  enableComments?: boolean;
  enableUpload?: boolean;
  placeholder?: string;
  minHeight?: string;
  maxHeight?: string;
  compact?: boolean;
  /** Called per uploaded file id so callers can defer attachment when `contentId` is empty. */
  onFileUploaded?: (fileId: string) => void;
  autoEmbedMedia?: boolean;
  onEditorReady?: (handle: EditorHandle | null) => void;
  /** In-doc content rendered above the editor surface (e.g. title, cover) that scrolls with the document. */
  headerSlot?: React.ReactNode;
  /** Default true; notes opt out because they ship their own floating toolbar. */
  floatingToolbar?: boolean;
}

const VIDEO_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256" fill="currentColor"><path d="M164,104v48a4,4,0,0,1-4,4H48a4,4,0,0,1-4-4V104a4,4,0,0,1,4-4H160A4,4,0,0,1,164,104Zm48-8a4,4,0,0,0-4.22.43L172,122.75V133.25l35.78,26.32A4,4,0,0,0,212,160a4,4,0,0,0,4-4V100A4,4,0,0,0,212,96Z"/></svg>';
const AUDIO_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256" fill="currentColor"><path d="M155.51,24.81a8,8,0,0,0-8.42.88L77.25,80H32A16,16,0,0,0,16,96v64a16,16,0,0,0,16,16H77.25l69.84,54.31A8,8,0,0,0,160,224V32A8,8,0,0,0,155.51,24.81ZM144,207.64,84.91,161.69A7.94,7.94,0,0,0,80,160H32V96H80a7.94,7.94,0,0,0,4.91-1.69L144,48.36Zm64-79.64a24,24,0,0,0-24-24,8,8,0,0,0,0,16,8,8,0,0,1,0,16,8,8,0,0,0,0,16A24,24,0,0,0,208,128Z"/></svg>';
const RECORD_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256" fill="currentColor"><path d="M128,176a48.05,48.05,0,0,0,48-48V64a48,48,0,0,0-96,0v64A48.05,48.05,0,0,0,128,176ZM96,64a32,32,0,0,1,64,0v64a32,32,0,0,1-64,0Zm40,143.6V232a8,8,0,0,1-16,0V207.6A80.11,80.11,0,0,1,48,128a8,8,0,0,1,16,0,64,64,0,0,0,128,0,8,8,0,0,1,16,0A80.11,80.11,0,0,1,136,207.6Z"/></svg>';
const TOC_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256" fill="currentColor"><path d="M88,64a8,8,0,0,1,8-8H216a8,8,0,0,1,0,16H96A8,8,0,0,1,88,64Zm128,56H96a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Zm0,64H96a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16ZM44,52A12,12,0,1,0,56,64,12,12,0,0,0,44,52Zm0,64a12,12,0,1,0,12,12A12,12,0,0,0,44,116Zm0,64a12,12,0,1,0,12,12A12,12,0,0,0,44,180Z"/></svg>';

function clearContainer(container: HTMLElement) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

// Custom y-prosemirror cursor builder: colored caret with an
// auto-hiding name flag so static labels do not clutter the editor.
function buildRealtimeCursor(user: { name?: string; color?: string } | null): HTMLElement {
  const color = user?.color ?? '#6366f1';
  const name = user?.name ?? 'Anonymous';

  const caret = document.createElement('span');
  caret.classList.add('uniffy-yjs-cursor');
  caret.setAttribute('style', `border-color: ${color}; background-color: ${color}`);

  const flag = document.createElement('div');
  flag.classList.add('uniffy-yjs-cursor__flag');
  flag.setAttribute('style', `background-color: ${color}`);
  flag.textContent = name;

  caret.appendChild(flag);
  return caret;
}

function buildRealtimeSelection(user: { color?: string } | null): { class?: string; style?: string } {
  const color = user?.color ?? '#6366f1';
  return {
    class: 'uniffy-yjs-selection',
    style: `background-color: ${color}33`,
  };
}

function createCrepeConfig(
  root: HTMLElement,
  content: string,
  readonly: boolean,
  compact: boolean,
  placeholderText: string,
  imageUploadHandler?: (file: File) => Promise<string>,
  videoUploadHandler?: (file: File) => Promise<string>,
  audioUploadHandler?: (file: File) => Promise<string>,
  floatingToolbar: boolean = true,
  realtime: boolean = false,
) {
  return {
    root,
    // y-prosemirror owns the doc under realtime; seeding via
    // ``defaultValue`` would race the ySyncPlugin and dup content.
    defaultValue: realtime ? '' : content,
    features: {
      [Crepe.Feature.CodeMirror]: true,
      [Crepe.Feature.ListItem]: true,
      [Crepe.Feature.LinkTooltip]: false,
      [Crepe.Feature.ImageBlock]: true,
      // Disable editing features in readonly mode
      // In compact mode, BlockEdit is enabled for slash commands but drag handle is hidden via CSS
      [Crepe.Feature.BlockEdit]: !readonly,
      [Crepe.Feature.Placeholder]: !readonly,
      // Floating selection toolbar - notes disables this (ships its own
      // React-rendered FloatingFormattingToolbar). Other CrepeEditor consumers
      // (calendar, projects, agents, chat) keep Crepe's default behavior.
      [Crepe.Feature.Toolbar]: !readonly && floatingToolbar,
      [Crepe.Feature.Cursor]: !readonly,
      [Crepe.Feature.Table]: true,
      [Crepe.Feature.Latex]: true,
    },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: {
        text: placeholderText,
        mode: compact ? 'block' as const : 'doc' as const,
      },
      [Crepe.Feature.CodeMirror]: {
        theme: oneDark,
        languages: languages,
        extensions: [basicSetup],
        searchPlaceholder: 'Search language...',
        noResultText: 'No language found',
      },
      ...(imageUploadHandler && {
        [Crepe.Feature.ImageBlock]: {
          onUpload: imageUploadHandler,
        },
      }),
      ...(!readonly && {
        [Crepe.Feature.BlockEdit]: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          buildMenu: (builder: any) => {
            const advancedGroup = builder.getGroup('advanced');
            if (!advancedGroup) return;

            advancedGroup.addItem('toc', {
              label: 'Table of Contents',
              icon: TOC_ICON_SVG,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onRun: (ctx: any) => insertTocBlock(ctx),
            });

            if (videoUploadHandler) {
              const videoHandler = videoUploadHandler;
              advancedGroup.addItem('video', {
                label: 'Video',
                icon: VIDEO_ICON_SVG,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onRun: (ctx: any) => insertVideoBlock(ctx, videoHandler),
              });
            }

            if (audioUploadHandler) {
              const audioHandler = audioUploadHandler;
              advancedGroup.addItem('audio', {
                label: 'Audio',
                icon: AUDIO_ICON_SVG,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onRun: (ctx: any) => insertAudioBlock(ctx, audioHandler),
              });

              advancedGroup.addItem('record', {
                label: 'Record Audio',
                icon: RECORD_ICON_SVG,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onRun: (ctx: any) => insertAudioRecording(ctx),
              });
            }
          },
        },
      }),
    },
  };
}

/** Same transformation as `MentionNodeView.handleReplaceWithMedia` applied to every FILE mention in the document. */
async function autoEmbedMediaMentions(view: EditorView, organizationId: string) {
  // resolveUrns() can return after a session switch leaves the view
  // destroyed; dispatching then trips the milkdown context.
  if (view.isDestroyed) return;

  const fileMentions: Array<{ pos: number; node: Node; urn: string; label: string; fileId: string }> = [];

  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== 'mention') return;
    const { urn, label } = node.attrs as { urn: string; label: string };
    const parsed = parseUrn(urn);
    if (parsed.type === UrnType.FILE && parsed.id) {
      fileMentions.push({ pos, node, urn, label, fileId: parsed.id });
    }
  });

  if (fileMentions.length === 0) return;

  // Batch resolve URN metadata to get mime types
  const urns = fileMentions.map((m) => m.urn);
  let resolvedMap: Record<string, { metadata?: Record<string, string> }>;
  try {
    const response = await searchApi.resolveUrns({ organizationId, urns });
    resolvedMap = (response.resolved ?? {}) as Record<string, { metadata?: Record<string, string> }>;
  } catch {
    return;
  }

  // Build replacements in reverse order so positions stay valid
  const replacements: Array<{
    pos: number;
    nodeSize: number;
    mediaType: 'image' | 'video' | 'audio';
    url: string;
    title: string;
  }> = [];

  for (const mention of fileMentions) {
    const resolved = resolvedMap[mention.urn];
    const mime = resolved?.metadata?.mime_type;
    if (!mime) continue;

    let mediaType: 'image' | 'video' | 'audio';
    let url: string;

    if (mime.startsWith('image/')) {
      mediaType = 'image';
      url = buildFileUrl(organizationId, mention.fileId);
    } else if (mime.startsWith('video/')) {
      mediaType = 'video';
      url = buildMediaStreamUrl(organizationId, mention.fileId);
    } else if (mime.startsWith('audio/')) {
      mediaType = 'audio';
      url = buildMediaStreamUrl(organizationId, mention.fileId);
    } else {
      continue;
    }

    replacements.push({
      pos: mention.pos,
      nodeSize: mention.node.nodeSize,
      mediaType,
      url,
      title: mention.label,
    });
  }

  if (replacements.length === 0) return;

  // Re-check after the async URN resolution: the view may have been
  // destroyed while we were waiting.
  if (view.isDestroyed) return;

  // Apply replacements in reverse document order
  replacements.sort((a, b) => b.pos - a.pos);

  const { schema } = view.state;
  let tr = view.state.tr;

  for (const rep of replacements) {
    let mediaNode: Node | null = null;

    if (rep.mediaType === 'image') {
      const imageType = schema.nodes['image-block'] ?? schema.nodes.image;
      mediaNode = imageType?.createAndFill?.({ src: rep.url, alt: rep.title }) ?? null;
    } else if (rep.mediaType === 'video') {
      const videoType = schema.nodes.video_block;
      mediaNode = videoType?.create({ src: rep.url, title: rep.title }) ?? null;
    } else if (rep.mediaType === 'audio') {
      const audioType = schema.nodes.audio_block;
      mediaNode = audioType?.create({ src: rep.url, title: rep.title }) ?? null;
    }

    if (!mediaNode) continue;

    // Delete the inline mention node
    tr = tr.delete(rep.pos, rep.pos + rep.nodeSize);

    // Resolve position to find the parent paragraph
    const mappedPos = tr.mapping.map(rep.pos);
    const $pos = tr.doc.resolve(mappedPos);

    if ($pos.depth >= 1) {
      const parentNode = $pos.node(1);
      const parentStart = $pos.before(1);
      const parentEnd = $pos.after(1);

      if (parentNode.textContent.trim() === '') {
        // Paragraph is empty after removing mention - replace with media block
        tr = tr.replaceWith(parentStart, parentEnd, mediaNode);
      } else {
        // Paragraph has other content - insert media block after it
        tr = tr.insert(parentEnd, mediaNode);
      }
    }
  }

  view.dispatch(tr);
}

const defaultSettings = { editorMode: 'crepe' as const, showMarkdownPreview: true, fontSize: 16, lineHeight: 1.6, spellCheck: true };

export function CrepeEditor({
  contentType,
  contentId,
  value: content,
  onChange,
  readonly = false,
  className,
  enableComments = false,
  enableUpload = true,
  placeholder = 'Start writing, use "/" for commands...',
  minHeight,
  maxHeight,
  compact = false,
  onFileUploaded,
  autoEmbedMedia = false,
  onEditorReady,
  headerSlot,
  floatingToolbar = true,
  realtime,
}: CrepeEditorProps) {
  const realtimeRef = useRef<CrepeRealtimeBinding | undefined>(realtime);
  realtimeRef.current = realtime;
  const dispatch = useAppDispatch();
  const editorState = useAppSelector((state) => state.editor);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  // Comment decorations: fetch + read comments from Redux (only when comments enabled)
  const { comments: contentComments, refresh: refreshComments } = useComments(
    enableComments ? contentType : ContentType.NOTE,
    enableComments ? contentId : '',
  );
  const activeCommentId = useAppSelector((state) => state.comments.activeCommentId);

  // Build comment anchors from Redux state (only SELECTION anchors)
  const commentAnchors: CommentAnchor[] = useMemo(() => {
    if (!enableComments || !contentComments.length) return [];
    return contentComments
      .filter((c) => c.anchorType === CommentAnchorType.SELECTION && c.anchorData)
      .map((c) => ({
        commentId: c.id,
        from: (c.anchorData?.from as number) ?? 0,
        to: (c.anchorData?.to as number) ?? 0,
        text: (c.anchorData?.text as string) ?? '',
        isResolved: c.isResolved,
      }));
  }, [enableComments, contentComments]);

  // Refs to pass current values into the plugin without re-creating the editor
  const commentAnchorsRef = useRef(commentAnchors);
  commentAnchorsRef.current = commentAnchors;
  const activeCommentIdRef = useRef(activeCommentId);
  activeCommentIdRef.current = activeCommentId;

  const settings = editorState?.settings ?? defaultSettings;
  const editorRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const unregisterEditorRef = useRef<(() => void) | null>(null);
  const contentRef = useRef<string>('');
  const initializedNoteIdRef = useRef<string | null>(null);
  const handleScopeRef = useRef<object>({});
  const onEditorReadyRef = useRef(onEditorReady);
  onEditorReadyRef.current = onEditorReady;

  // Mention popup state
  const [mentionPopup, setMentionPopup] = useState<MentionTriggerEvent | null>(null);

  // Comment form state - triggered from toolbar button
  const [commentSelection, setCommentSelection] = useState<{
    from: number;
    to: number;
    text: string;
    rect: DOMRect;
  } | null>(null);

  // Comment thread popover state - triggered from clicking highlighted text
  const [threadPopover, setThreadPopover] = useState<{
    commentId: string;
    rect: DOMRect;
  } | null>(null);

  // Highlight color picker state - triggered from toolbar highlight button
  const [highlightPicker, setHighlightPicker] = useState<{
    from: number;
    to: number;
    rect: DOMRect;
  } | null>(null);

  // Stable ref for the comment callback so createCrepeConfig captures the latest version
  const commentCallbackRef = useRef<() => void>(() => {});
  commentCallbackRef.current = () => {
    const view = viewRef.current;
    if (!view || view.isDestroyed) return;
    const { from, to } = view.state.selection;
    if (from === to) return;

    const text = view.state.doc.textBetween(from, to, ' ');
    if (!text.trim()) return;

    // Get the bounding rect of the selection for positioning the form
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);
    const rect = new DOMRect(
      Math.min(start.left, end.left),
      Math.min(start.top, end.top),
      Math.abs(end.right - start.left),
      Math.abs(end.bottom - start.top),
    );

    setCommentSelection({ from, to, text, rect });
  };

  // Stable ref for the highlight callback
  const highlightCallbackRef = useRef<() => void>(() => {});
  highlightCallbackRef.current = () => {
    const view = viewRef.current;
    if (!view || view.isDestroyed) return;
    const { from, to } = view.state.selection;
    if (from === to) return;

    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);
    const rect = new DOMRect(
      Math.min(start.left, end.left),
      Math.min(start.top, end.top),
      Math.abs(end.right - start.left),
      Math.abs(end.bottom - start.top),
    );

    setHighlightPicker({ from, to, rect });
  };

  // Create image upload handler (edit mode with uploads enabled and org ID)
  // When contentId is empty, uploads work in deferred mode (file uploaded, attachment created later)
  const imageUploadHandler = useMemo(() => {
    if (readonly || !enableUpload || !organizationId) {
      return undefined;
    }
    return createImageUploadHandler(contentType, contentId, organizationId, onFileUploaded);
  }, [readonly, enableUpload, organizationId, contentId, contentType, onFileUploaded]);

  // Create video upload handler
  const videoUploadHandler = useMemo(() => {
    if (readonly || !enableUpload || !organizationId) {
      return undefined;
    }
    return createVideoUploadHandler(contentType, contentId, organizationId, onFileUploaded);
  }, [readonly, enableUpload, organizationId, contentId, contentType, onFileUploaded]);

  // Create audio upload handler
  const audioUploadHandler = useMemo(() => {
    if (readonly || !enableUpload || !organizationId) {
      setAudioRecordingUploadHandler(null);
      return undefined;
    }
    const handler = createAudioUploadHandler(contentType, contentId, organizationId, onFileUploaded);
    setAudioRecordingUploadHandler(handler);
    return handler;
  }, [readonly, enableUpload, organizationId, contentId, contentType, onFileUploaded]);

  // Handle content changes from the editor
  const handleContentChange = useCallback((markdown: string) => {
    if (readonly) return;
    onChange?.(markdown);
  }, [readonly, onChange]);

  // Handle mention selection
  const handleMentionSelect = useCallback((result: SearchResultItem) => {
    if (!mentionPopup) return;

    const { view, from: storedFrom, query } = mentionPopup;
    const { state, dispatch } = view;
    const { schema } = state;

    // Use stored from position (@ symbol) and calculate to based on query length
    // from = position of @, to = from + 1 (@) + query length
    const from = storedFrom;
    const to = storedFrom + 1 + query.length;

    // Validate positions are within the current document bounds
    const docSize = state.doc.content.size;
    if (from < 0 || to > docSize) {
      setMentionPopup(null);
      return;
    }

    // ── Insert mention chip ─────────────────────────────────────
    // All @mentions create chips. Media files can be converted to
    // inline embeds via the "Embed" button in the hover preview.
    const mentionType = schema.nodes.mention;
    if (!mentionType) {
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
    tr.setSelection(Selection.near(tr.doc.resolve(spacePos + 1)));

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
    initializedNoteIdRef.current = contentId;

    const crepe = new Crepe(createCrepeConfig(
      container, content, readonly, compact, placeholder,
      imageUploadHandler, videoUploadHandler, audioUploadHandler,
      floatingToolbar, Boolean(realtimeRef.current),
    ));

    // CRITICAL: Add plugins BEFORE calling create()
    // Access the underlying Milkdown editor and register our custom plugins
    try {
      const editor = crepe.editor;
      // Register video plugin first — must parse [[[video|url]]] before mention plugin
      editor.use(videoPlugins);
      // Register audio plugin — must parse [[[audio|url]]] before mention plugin
      editor.use(audioPlugins);
      // Register tag plugins — tag remark must run before mention remark
      // so that [[[tag|X]]] patterns are consumed before mention remark sees them
      editor.use(tagPlugins);
      // Register toc plugin — toc remark must run before mention remark
      // so that [[[toc|...]]] patterns are consumed before mention remark sees them
      editor.use(tocPlugins);
      // Register mention plugins (includes view capture plugin)
      editor.use(mentionPlugins);
      // Register highlight mark plugin (both edit and readonly - highlights are content)
      editor.use(highlightPlugins);
      // Register underline mark plugin (both edit and readonly)
      editor.use(underlinePlugins);
      // Selection version notifier - drives external toolbar active-state subscriptions
      if (!readonly) {
        const scope = handleScopeRef.current;
        editor.use($prose(() => createSelectionVersionPlugin(scope)));
      }
      // Register comment highlight decorations (edit mode with comments enabled only)
      if (!readonly && enableComments) {
        editor.use(commentDecorationsPlugin);
      }

      // Wire y-prosemirror plugins under realtime: shared fragment
      // sync, peer cursors from awareness, origin-scoped undo.
      const rt = realtimeRef.current;
      if (rt) {
        const fragment = rt.ydoc.get(PROSEMIRROR_FRAGMENT_FIELD, Y.XmlFragment);
        editor.use($prose(() => ySyncPlugin(fragment)));
        editor.use($prose(() =>
          yCursorPlugin(rt.awareness, {
            cursorBuilder: buildRealtimeCursor,
            selectionBuilder: buildRealtimeSelection,
          }),
        ));
        if (rt.undoManager) {
          editor.use($prose(() => yUndoPlugin({ undoManager: rt.undoManager! })));
        }

        // Mirror serialized markdown into ``Y.Text("markdown")`` for
        // the snapshot pipeline. Milkdown's ``markdownUpdated`` is
        // filtered for ``ySync``-meta transactions, so we hook
        // ``view.update`` via a ``$prose`` plugin and debounce 250ms.
        editor.use(
          $prose((ctx) => {
            let timer: ReturnType<typeof setTimeout> | null = null;
            const flush = (view: EditorView) => {
              timer = null;
              try {
                const serializer = ctx.get(serializerCtx);
                const markdown = serializer(view.state.doc);
                replaceMarkdownYText(rt.ydoc, markdown, rt.sessionId);
              } catch {
                // Serializer not ready yet - next update retries.
              }
            };
            return new Plugin({
              view: () => ({
                update: (updatedView, prevState) => {
                  if (updatedView.state.doc.eq(prevState.doc)) return;
                  if (timer) clearTimeout(timer);
                  timer = setTimeout(() => flush(updatedView), 250);
                },
                destroy: () => {
                  if (timer) {
                    clearTimeout(timer);
                    timer = null;
                  }
                },
              }),
            });
          }),
        );
      }

      // Register upload plugin for paste/drop image handling (only in edit mode with uploads enabled)
      if (!readonly && enableUpload && organizationId) {
        const contentIdCapture = contentId;
        const contentTypeCapture = contentType;
        const orgIdCapture = organizationId;
        const onFileUploadedCapture = onFileUploaded;

        // Create uploader that handles pasted/dropped images and videos
        const uploader: Uploader = async (files, schema) => {
          const nodes: Node[] = [];

          for (let i = 0; i < files.length; i++) {
            const file = files.item(i);
            if (!file) continue;

            // Handle image files
            if (file.type.startsWith('image/')) {
              try {
                const url = await uploadImage({
                  file,
                  organizationId: orgIdCapture,
                  contentId: contentIdCapture,
                  contentType: contentTypeCapture,
                  onFileUploaded: onFileUploadedCapture,
                });

                const node = schema.nodes.image?.createAndFill({
                  src: url,
                  alt: file.name,
                });
                if (node) {
                  nodes.push(node);
                }
              } catch (error) {
                console.error('[CrepeEditor] Failed to upload pasted image:', error);
              }
            }

            // Handle video files
            if (file.type.startsWith('video/')) {
              try {
                const url = await uploadVideo({
                  file,
                  organizationId: orgIdCapture,
                  contentId: contentIdCapture,
                  contentType: contentTypeCapture,
                  onFileUploaded: onFileUploadedCapture,
                });

                const videoType = schema.nodes.video_block;
                if (videoType) {
                  const node = videoType.create({ src: url, title: file.name });
                  nodes.push(node);
                }
              } catch (error) {
                console.error('[CrepeEditor] Failed to upload pasted video:', error);
              }
            }

            // Handle audio files
            if (file.type.startsWith('audio/')) {
              try {
                const url = await uploadAudio({
                  file,
                  organizationId: orgIdCapture,
                  contentId: contentIdCapture,
                  contentType: contentTypeCapture,
                  onFileUploaded: onFileUploadedCapture,
                });

                const audioType = schema.nodes.audio_block;
                if (audioType) {
                  const node = audioType.create({ src: url, title: file.name });
                  nodes.push(node);
                }
              } catch (error) {
                console.error('[CrepeEditor] Failed to upload pasted audio:', error);
              }
            }
          }

          return nodes;
        };

        // Configure and register the upload plugin
        editor.config((ctx) => {
          ctx.update(uploadConfig.key, (prev) => ({
            ...prev,
            uploader,
          }));
        });
        editor.use(upload);
      }

    } catch {
      // Plugin registration failed silently
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
          const view = ctx.get(editorViewCtx);
          if (view) {
            viewRef.current = view;
            unregisterEditorRef.current = registerEditor({ editor, view });

            if (!readonly && onEditorReadyRef.current) {
              const scope = handleScopeRef.current;
              const handle: EditorHandle = {
                crepe,
                view,
                scope,
                run: (fn) => {
                  try {
                    return crepe.editor.action(fn);
                  } catch (error) {
                    console.error('[CrepeEditor] handle.run failed:', error);
                    return undefined;
                  }
                },
                focus: () => view.focus(),
                ...(enableComments && {
                  triggerComment: () => commentCallbackRef.current(),
                }),
              };
              onEditorReadyRef.current(handle);
            }

            // Wire up comment click handler - open thread popover (only when comments enabled)
            if (enableComments) {
              setCommentClickHandler((commentId) => {
                dispatch(setActiveComment(commentId));
                // Find the highlight element to position the popover
                const el = document.querySelector(`[data-comment-id="${commentId}"]`);
                if (el) {
                  setThreadPopover({ commentId, rect: el.getBoundingClientRect() });
                }
              });
            }
          }
        });
      } catch {
        // Editor view access failed silently
      }

      // Listen for markdown changes AFTER editor is fully created (only if not readonly)
      // This ensures editorViewCtx is available during serialization
      if (!readonly) {
        const rt = realtimeRef.current;
        crepe.on((listener) => {
          listener.markdownUpdated((_ctx, markdown, prevMarkdown) => {
            // Guard against callbacks firing after editor is destroyed
            if (cancelled || !crepeRef.current) return;
            if (markdown !== prevMarkdown) {
              handleContentChange(markdown);
              // Mirror into ``Y.Text("markdown")`` so the snapshot
              // pipeline can render without running a JS parser.
              if (rt) {
                replaceMarkdownYText(rt.ydoc, markdown, rt.sessionId);
              }
            }
          });
        });
      }

      // First-attach cold-start: convert ``Y.Text("markdown")`` into
      // ``Y.XmlFragment("prosemirror")`` for ySyncPlugin to mirror.
      // Gated on ``whenSynced`` to avoid racing SyncStep2.
      const rtBinding = realtimeRef.current;
      if (rtBinding && !readonly) {
        void rtBinding.whenSynced.then(() => {
          if (cancelled || !crepeRef.current) return;
          try {
            crepeRef.current.editor.action((ctx) => {
              const view = ctx.get(editorViewCtx);
              if (!view || view.isDestroyed) return;
              const fragment = rtBinding.ydoc.get(
                PROSEMIRROR_FRAGMENT_FIELD,
                Y.XmlFragment,
              );
              if (fragment.length > 0) return;
              const ytext = rtBinding.ydoc.get(MARKDOWN_TEXT_FIELD, Y.Text);
              const md = ytext.toString();
              if (!md) return;
              const parser = ctx.get(parserCtx);
              const node = parser(md);
              if (!node) return;
              rtBinding.ydoc.transact(() => {
                prosemirrorToYXmlFragment(node, fragment);
              }, 'hydration');
            });
          } catch (err) {
            console.warn('[CrepeEditor] realtime cold-start seed failed', err);
          }
        });
      }

      if (readonly) {
        crepe.setReadonly(true);
      }

      // Auto-embed media file mentions after editor is ready
      if (autoEmbedMedia && organizationId) {
        try {
          crepe.editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            if (view && !view.isDestroyed) {
              autoEmbedMediaMentions(view, organizationId);
            }
          });
        } catch {
          // Editor action failed silently
        }
      }
    });

    return () => {
      cancelled = true;
      if (unregisterEditorRef.current) {
        unregisterEditorRef.current();
        unregisterEditorRef.current = null;
      }
      // crepe.destroy() is async; without detaching the Y.Doc observer
      // synchronously, a remote update can dispatch into the editor after
      // Milkdown wipes its ctx, throwing "Context editorState not found".
      // y-prosemirror's deferred metadata flush (lib.js updateMetas) gates
      // on `binding.isDestroyed`, but binding.destroy() never sets it - set
      // it ourselves to mute pending awareness dispatches.
      const liveView = viewRef.current;
      if (liveView && !liveView.isDestroyed) {
        try {
          const syncState = ySyncPluginKey.getState(liveView.state) as { binding?: { destroy?: () => void; isDestroyed?: boolean } } | null;
          const binding = syncState?.binding;
          if (binding) {
            binding.isDestroyed = true;
            binding.destroy?.();
          }
        } catch {
          // best effort
        }
      }
      viewRef.current = null;
      if (crepeRef.current) {
        crepeRef.current.destroy();
        crepeRef.current = null;
      }
      if (onEditorReadyRef.current) onEditorReadyRef.current(null);
      disposeSelectionScope(handleScopeRef.current);
      handleScopeRef.current = {};
      // Also clear container on cleanup to handle Strict Mode remount
      clearContainer(container);
      initializedNoteIdRef.current = null;
    };
    // Recreate on content ID / readonly / upload handler change, and
    // on ydoc identity change so ySyncPlugin rebinds to the new shared
    // types when the realtime session is replaced.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId, readonly, imageUploadHandler, videoUploadHandler, audioUploadHandler, realtime?.ydoc]);

  // Separate effect to handle content updates in readonly mode only
  useEffect(() => {
    // Only run this effect for readonly mode after initial mount
    if (!readonly || !crepeRef.current) return;
    
    // Check if content actually changed
    if (contentRef.current === content) return;

    const container = editorRef.current;
    if (!container) return;
    
    let cancelled = false;

    if (unregisterEditorRef.current) {
      unregisterEditorRef.current();
      unregisterEditorRef.current = null;
    }
    viewRef.current = null;

    crepeRef.current.destroy();
    crepeRef.current = null;

    clearContainer(container);

    contentRef.current = content;

    const crepe = new Crepe(createCrepeConfig(container, content, true, compact, placeholder));

    // Register plugins before create (same as above)
    try {
      const editor = crepe.editor;
      editor.use(videoPlugins);
      editor.use(audioPlugins);
      editor.use(tagPlugins);
      editor.use(tocPlugins);
      editor.use(mentionPlugins);
      editor.use(highlightPlugins);
      editor.use(underlinePlugins);
    } catch {
      // Plugin registration failed silently
    }

    crepe.create().then(() => {
      if (cancelled) {
        crepe.destroy();
        return;
      }
      crepeRef.current = crepe;

      try {
        const editor = crepe.editor;
        editor.action((ctx) => {
          const editorView = ctx.get(editorViewCtx);
          if (editorView && !editorView.isDestroyed) {
            viewRef.current = editorView;
            unregisterEditorRef.current = registerEditor({ editor, view: editorView });
            if (autoEmbedMedia && organizationId) {
              autoEmbedMediaMentions(editorView, organizationId);
            }
          }
        });
      } catch {
        // Editor action failed silently
      }

      crepe.setReadonly(true);
    });

    return () => {
      cancelled = true;
    };
  }, [content, readonly, compact, placeholder, autoEmbedMedia, organizationId]);

  // Get shortcut matching function from settings
  const { matches } = useGlobalShortcuts();

  // Handle keyboard shortcuts within the editor (where global shortcuts don't work)
  useEffect(() => {
    const container = editorRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if this matches the nav.search shortcut
      if (matches('nav.search', e)) {
        e.preventDefault();
        e.stopPropagation();
        openSpotlightSearch();
      }
    };

    container.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => container.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [matches]);

  // In readonly mode, clicking an image opens the file viewer modal
  // Uses capture phase to intercept before Milkdown's ImageBlock handles the event
  useEffect(() => {
    if (!readonly) return;
    const container = editorRef.current;
    if (!container) return;

    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Walk up from click target to find an <img> element
      const img = target.closest('img') || (target.tagName === 'IMG' ? target : null);
      if (!img) return;

      const src = (img as HTMLImageElement).src;
      const parsed = parseFileUrl(src);
      if (!parsed) return;

      e.preventDefault();
      e.stopPropagation();
      dispatch(openViewerWithFetch({ fileId: parsed.fileId }));
    };

    container.addEventListener('click', handleClick, { capture: true });
    return () => container.removeEventListener('click', handleClick, { capture: true });
  }, [readonly, dispatch]);

  // Intercept in-document anchor links (href starting with `#`) so a Table of
  // Contents scrolls to the heading instead of triggering a full React Router
  // remount. External links and same-origin non-hash navigations pass through.
  useEffect(() => {
    const container = editorRef.current;
    if (!container) return;

    const handleAnchorClick = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      // Let users open links in a new tab / window normally.
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

      const target = e.target as HTMLElement | null;
      const anchor = target?.closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href');
      if (!href) return;

      // In-doc hash link (`#slug`) - resolve locally.
      let slug: string | null = null;
      let parsedUrl: URL | null = null;
      if (href.startsWith('#')) {
        slug = href.slice(1);
      } else {
        // Same-origin same-path link with a hash also counts.
        try {
          parsedUrl = new URL(href, window.location.href);
          if (
            parsedUrl.origin === window.location.origin &&
            parsedUrl.pathname === window.location.pathname &&
            parsedUrl.hash
          ) {
            slug = parsedUrl.hash.slice(1);
          }
        } catch {
          return;
        }
      }

      if (slug) {
        const heading = findHeadingBySlug(slug, container);
        if (!heading) return;

        e.preventDefault();
        e.stopPropagation();
        heading.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Keep the URL shareable without polluting browser history.
        const nextUrl = `${window.location.pathname}${window.location.search}#${slug}`;
        window.history.replaceState(window.history.state, '', nextUrl);
        return;
      }

      // External link (or any non-anchor URL): open in a new tab. Skip
      // unsupported schemes (mailto:, tel:, etc.) so the browser default
      // still launches the right handler in the same tab.
      const scheme = parsedUrl?.protocol ?? '';
      if (scheme === 'http:' || scheme === 'https:') {
        e.preventDefault();
        e.stopPropagation();
        window.open(parsedUrl!.href, '_blank', 'noopener,noreferrer');
      }
    };

    container.addEventListener('click', handleAnchorClick, { capture: true });
    return () => container.removeEventListener('click', handleAnchorClick, { capture: true });
  }, []);

  // Handle highlight color selection from the picker
  const handleHighlightColor = useCallback((color: string | null) => {
    if (!crepeRef.current || !highlightPicker) return;

    try {
      crepeRef.current.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (!view || view.isDestroyed) return;

        const markType = highlightMark.type(ctx);
        const { from, to } = highlightPicker;

        if (color === null) {
          // Remove highlight marks in the selection
          view.dispatch(view.state.tr.removeMark(from, to, markType));
        } else {
          // Remove existing highlight, then add new one
          let tr = view.state.tr.removeMark(from, to, markType);
          tr = tr.addMark(from, to, markType.create({ color }));
          view.dispatch(tr);
        }

        view.focus();
      });
    } catch {
      // Editor action failed
    }

    setHighlightPicker(null);
  }, [highlightPicker]);

  // Update comment decorations when comments or active comment change
  useEffect(() => {
    if (readonly || !enableComments) return;
    const crepe = crepeRef.current;
    if (!crepe) return;

    try {
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (view && !view.isDestroyed) {
          updateCommentDecorations(view, commentAnchors, activeCommentId);
        }
      });
    } catch {
      // Editor not ready yet
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commentAnchors, activeCommentId]);

  return (
    <>
      <div className={`crepe-editor-wrapper ${compact ? '' : 'h-full'} overflow-y-auto ${className || ''}`}
        style={{
          ...(minHeight ? { minHeight } : {}),
          ...(maxHeight ? { maxHeight } : {}),
        }}
      >
        {headerSlot}
        <div
          ref={editorRef}
          className={`crepe-editor prose max-w-none ${compact ? 'crepe-editor-compact px-3 py-2' : ''}`}
          style={className?.includes('chat-bubble-editor') ? undefined : {
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

      {/* Highlight color picker - triggered from toolbar highlight button */}
      {!readonly && highlightPicker && createPortal(
        <HighlightPicker
          anchorRect={highlightPicker.rect}
          onSelect={handleHighlightColor}
          onClose={() => setHighlightPicker(null)}
        />,
        document.body
      )}

      {/* Inline comment form - triggered from toolbar comment button */}
      {!readonly && enableComments && commentSelection && createPortal(
        <InlineCommentPopover
          selection={commentSelection}
          contentType={contentType}
          contentId={contentId}
          onClose={() => setCommentSelection(null)}
        />,
        document.body
      )}

      {/* Comment thread popover - triggered from clicking highlighted text */}
      {enableComments && threadPopover && (() => {
        const comment = contentComments.find((c) => c.id === threadPopover.commentId);
        if (!comment) return null;
        return (
          <CommentThreadPopover
            comment={comment}
            contentType={contentType}
            contentId={contentId}
            anchorRect={threadPopover.rect}
            onClose={() => {
              setThreadPopover(null);
              dispatch(setActiveComment(null));
            }}
            onRefresh={refreshComments}
          />
        );
      })()}
    </>
  );
}
