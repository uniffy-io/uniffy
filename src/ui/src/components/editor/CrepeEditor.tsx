import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Crepe } from '@milkdown/crepe';
import { editorViewCtx, commandsCtx } from '@milkdown/core';
import { Selection } from '@milkdown/prose/state';
import type { Node } from '@milkdown/prose/model';
import type { EditorView } from '@milkdown/prose/view';
import { clearTextInCurrentBlockCommand } from '@milkdown/kit/preset/commonmark';
import { upload, uploadConfig, type Uploader } from '@milkdown/kit/plugin/upload';
import { oneDark } from '@codemirror/theme-one-dark';
import { languages } from '@codemirror/language-data';
import { basicSetup } from 'codemirror';
import { useAppSelector, useAppDispatch } from '@/app/hooks';
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
import { audioPlugins } from '@/components/editor/plugins/audio';
import { highlightPlugins, highlightMark } from '@/components/editor/plugins/highlight';
import { HighlightPicker } from '@/components/editor/plugins/highlight/HighlightPicker';
import type { SearchResultItem } from '@/gen/search/v1/search_pb';
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
import { CommentAnchorType } from '@/gen/comments/v1/comments_pb';
import { ContentType } from '@/gen/common/v1/common_pb';

// Import only common Crepe styles - frame themes set global html/body styles that break our app
import '@milkdown/crepe/theme/common/style.css';

// Comment highlight styles
import '@/features/comments/styles/comments.css';

// Import our custom overrides that handle theming
import '@/components/editor/styles/editor.css';

interface CrepeEditorProps {
  /** Content type for uploads and comments */
  contentType: ContentType;
  /** Content ID for uploads and comments */
  contentId: string;
  /** Markdown content to display */
  value: string;
  /** Called when content changes (consumers handle persistence) */
  onChange?: (markdown: string) => void;
  /** When true, the editor is read-only (no editing, no toolbar, no slash commands) */
  readonly?: boolean;
  /** Custom class name for the wrapper */
  className?: string;
  /** Enable inline comments (default: false) */
  enableComments?: boolean;
  /** Enable file uploads - images, video, audio (default: true) */
  enableUpload?: boolean;
  /** Placeholder text for empty editor */
  placeholder?: string;
  /** Minimum height CSS value */
  minHeight?: string;
  /** Maximum height CSS value */
  maxHeight?: string;
  /** Compact mode - constrained height, minimal padding (default: false) */
  compact?: boolean;
  /** Called with each uploaded file ID (for deferred attachment when contentId is empty) */
  onFileUploaded?: (fileId: string) => void;
}

// SVG icon for the comment toolbar button (Phosphor chat-circle, 24x24)
const COMMENT_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256"><path fill="currentColor" d="M128,24A104,104,0,0,0,36.18,176.88L24.83,210.93a16,16,0,0,0,20.24,20.24l34.05-11.35A104,104,0,1,0,128,24Zm0,192a87.87,87.87,0,0,1-44.06-11.81,8,8,0,0,0-4-1.08,8.09,8.09,0,0,0-2.53.41L40,216,52.47,178.6a8,8,0,0,0-.67-6.54A88,88,0,1,1,128,216Z"/></svg>';

// SVG icon for the highlight toolbar button (Phosphor Highlighter, 24x24)
const HIGHLIGHT_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256"><path fill="currentColor" d="M253.66,98.34l-40-40a8,8,0,0,0-11.32,0l-32,32L140,60a8,8,0,0,0-11.31,0L72,116.69A8,8,0,0,0,72,128l18.34,18.34L42.34,194.34a8,8,0,0,0,0,11.32l8,8a8,8,0,0,0,11.32,0l48-48L128,184a8,8,0,0,0,11.31,0l56.69-56.69,0,0,32-32a8,8,0,0,0,0-11.31ZM128,172.69,91.31,136l48-48L176,124.69l-.69.69,0,0ZM208,104.69,179.31,76l28-28L236.69,76.69Z"/></svg>';

// SVG icon for the video slash command (Phosphor video camera icon, 24x24)
const VIDEO_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256" fill="currentColor"><path d="M164,104v48a4,4,0,0,1-4,4H48a4,4,0,0,1-4-4V104a4,4,0,0,1,4-4H160A4,4,0,0,1,164,104Zm48-8a4,4,0,0,0-4.22.43L172,122.75V133.25l35.78,26.32A4,4,0,0,0,212,160a4,4,0,0,0,4-4V100A4,4,0,0,0,212,96Z"/></svg>';

// SVG icon for the audio slash command (Phosphor speaker icon, 24x24)
const AUDIO_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256" fill="currentColor"><path d="M155.51,24.81a8,8,0,0,0-8.42.88L77.25,80H32A16,16,0,0,0,16,96v64a16,16,0,0,0,16,16H77.25l69.84,54.31A8,8,0,0,0,160,224V32A8,8,0,0,0,155.51,24.81ZM144,207.64,84.91,161.69A7.94,7.94,0,0,0,80,160H32V96H80a7.94,7.94,0,0,0,4.91-1.69L144,48.36Zm64-79.64a24,24,0,0,0-24-24,8,8,0,0,0,0,16,8,8,0,0,1,0,16,8,8,0,0,0,0,16A24,24,0,0,0,208,128Z"/></svg>';

/**
 * Open a file picker for video files and return the selected file.
 */
function openVideoFilePicker(): Promise<File | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'video/*';
        input.style.display = 'none';
        input.addEventListener('change', () => {
            const file = input.files?.[0] ?? null;
            input.remove();
            resolve(file);
        });
        input.addEventListener('cancel', () => {
            input.remove();
            resolve(null);
        });
        document.body.appendChild(input);
        input.click();
    });
}

/**
 * Open a file picker for audio files and return the selected file.
 */
function openAudioFilePicker(): Promise<File | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'audio/*';
        input.style.display = 'none';
        input.addEventListener('change', () => {
            const file = input.files?.[0] ?? null;
            input.remove();
            resolve(file);
        });
        input.addEventListener('cancel', () => {
            input.remove();
            resolve(null);
        });
        document.body.appendChild(input);
        input.click();
    });
}

/**
 * Find an audio_block node by its src value and update it.
 * Used to replace a placeholder (uploading:xxx) with the real URL.
 */
function updateAudioBlockSrc(view: EditorView, oldSrc: string, newSrc: string, title?: string) {
    const { state } = view;
    let found: number | null = null;

    state.doc.descendants((node, pos) => {
        if (found !== null) return false;
        if (node.type.name === 'audio_block' && node.attrs.src === oldSrc) {
            found = pos;
            return false;
        }
    });

    if (found !== null) {
        const attrs: Record<string, string> = { src: newSrc };
        if (title) attrs.title = title;
        const tr = state.tr.setNodeMarkup(found, null, attrs);
        view.dispatch(tr);
    }
}

/**
 * Find and remove an audio_block node by its src value.
 * Used to clean up placeholders on cancel or upload error.
 */
function removeAudioBlock(view: EditorView, src: string) {
    const { state } = view;
    const found: { pos: number; size: number }[] = [];

    state.doc.descendants((node, pos) => {
        if (found.length > 0) return false;
        if (node.type.name === 'audio_block' && node.attrs.src === src) {
            found.push({ pos, size: node.nodeSize });
            return false;
        }
    });

    if (found.length > 0) {
        const { pos, size } = found[0];
        const tr = state.tr.delete(pos, pos + size);
        view.dispatch(tr);
    }
}

/**
 * Find a video_block node by its src value and update it.
 * Used to replace a placeholder (uploading:xxx) with the real URL.
 */
function updateVideoBlockSrc(view: EditorView, oldSrc: string, newSrc: string, title?: string) {
    const { state } = view;
    let found: number | null = null;

    state.doc.descendants((node, pos) => {
        if (found !== null) return false;
        if (node.type.name === 'video_block' && node.attrs.src === oldSrc) {
            found = pos;
            return false;
        }
    });

    if (found !== null) {
        const attrs: Record<string, string> = { src: newSrc };
        if (title) attrs.title = title;
        const tr = state.tr.setNodeMarkup(found, null, attrs);
        view.dispatch(tr);
    }
}

/**
 * Find and remove a video_block node by its src value.
 * Used to clean up placeholders on cancel or upload error.
 */
function removeVideoBlock(view: EditorView, src: string) {
    const { state } = view;
    const found: { pos: number; size: number }[] = [];

    state.doc.descendants((node, pos) => {
        if (found.length > 0) return false;
        if (node.type.name === 'video_block' && node.attrs.src === src) {
            found.push({ pos, size: node.nodeSize });
            return false;
        }
    });

    if (found.length > 0) {
        const { pos, size } = found[0];
        const tr = state.tr.delete(pos, pos + size);
        view.dispatch(tr);
    }
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
  compact: boolean,
  placeholderText: string,
  imageUploadHandler?: (file: File) => Promise<string>,
  videoUploadHandler?: (file: File) => Promise<string>,
  audioUploadHandler?: (file: File) => Promise<string>,
  onCommentClick?: () => void,
  onHighlightClick?: () => void,
) {
  return {
    root,
    defaultValue: content,
    features: {
      [Crepe.Feature.CodeMirror]: true,
      [Crepe.Feature.ListItem]: true,
      [Crepe.Feature.LinkTooltip]: true,
      [Crepe.Feature.ImageBlock]: true,
      // Disable editing features in readonly mode
      // In compact mode, BlockEdit is enabled for slash commands but drag handle is hidden via CSS
      [Crepe.Feature.BlockEdit]: !readonly,
      [Crepe.Feature.Placeholder]: !readonly,
      [Crepe.Feature.Toolbar]: !readonly,
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
      ...(!readonly && (onCommentClick || onHighlightClick) && {
        [Crepe.Feature.Toolbar]: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          buildToolbar: (builder: any) => {
            const functionGroup = builder.getGroup('function');
            if (!functionGroup) return;
            if (onHighlightClick) {
              functionGroup.addItem('highlight', {
                icon: HIGHLIGHT_ICON_SVG,
                active: () => false,
                onRun: () => {
                  onHighlightClick();
                },
              });
            }
            if (onCommentClick) {
              functionGroup.addItem('comment', {
                icon: COMMENT_ICON_SVG,
                active: () => false,
                onRun: () => {
                  onCommentClick();
                },
              });
            }
          },
        },
      }),
      ...(imageUploadHandler && {
        [Crepe.Feature.ImageBlock]: {
          onUpload: imageUploadHandler,
        },
      }),
      ...(!readonly && (videoUploadHandler || audioUploadHandler) && {
        [Crepe.Feature.BlockEdit]: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          buildMenu: (builder: any) => {
            const advancedGroup = builder.getGroup('advanced');
            if (!advancedGroup) return;

            if (videoUploadHandler) {
              const videoHandler = videoUploadHandler;
              advancedGroup.addItem('video', {
                label: 'Video',
                icon: VIDEO_ICON_SVG,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onRun: (ctx: any) => {
                  const commands = ctx.get(commandsCtx);
                  const view = ctx.get(editorViewCtx) as EditorView;
                  if (!view) return;

                  commands.call(clearTextInCurrentBlockCommand.key);

                  const placeholderId = `uploading:${Date.now()}-${Math.random().toString(36).slice(2)}`;
                  const { schema } = view.state;
                  const videoType = schema.nodes.video_block;
                  if (!videoType) return;

                  const placeholderNode = videoType.create({ src: placeholderId });
                  const { $from } = view.state.selection;
                  const tr = view.state.tr.replaceRangeWith($from.before(), $from.after(), placeholderNode);
                  view.dispatch(tr);

                  openVideoFilePicker().then(async (file) => {
                    if (!file) {
                      removeVideoBlock(view, placeholderId);
                      return;
                    }
                    try {
                      const url = await videoHandler(file);
                      updateVideoBlockSrc(view, placeholderId, url, file.name);
                    } catch (error) {
                      console.error('[CrepeEditor] Failed to upload video:', error);
                      removeVideoBlock(view, placeholderId);
                    }
                  });
                },
              });
            }

            if (audioUploadHandler) {
              const audioHandler = audioUploadHandler;
              advancedGroup.addItem('audio', {
                label: 'Audio',
                icon: AUDIO_ICON_SVG,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onRun: (ctx: any) => {
                  const commands = ctx.get(commandsCtx);
                  const view = ctx.get(editorViewCtx) as EditorView;
                  if (!view) return;

                  commands.call(clearTextInCurrentBlockCommand.key);

                  const placeholderId = `uploading:${Date.now()}-${Math.random().toString(36).slice(2)}`;
                  const { schema } = view.state;
                  const audioType = schema.nodes.audio_block;
                  if (!audioType) return;

                  const placeholderNode = audioType.create({ src: placeholderId });
                  const { $from } = view.state.selection;
                  const tr = view.state.tr.replaceRangeWith($from.before(), $from.after(), placeholderNode);
                  view.dispatch(tr);

                  openAudioFilePicker().then(async (file) => {
                    if (!file) {
                      removeAudioBlock(view, placeholderId);
                      return;
                    }
                    try {
                      const url = await audioHandler(file);
                      updateAudioBlockSrc(view, placeholderId, url, file.name);
                    } catch (error) {
                      console.error('[CrepeEditor] Failed to upload audio:', error);
                      removeAudioBlock(view, placeholderId);
                    }
                  });
                },
              });
            }
          },
        },
      }),
    },
  };
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
}: CrepeEditorProps) {
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
  const contentRef = useRef<string>('');
  const initializedNoteIdRef = useRef<string | null>(null);

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
    const view = (window as Window & { __milkdownEditorView?: EditorView }).__milkdownEditorView;
    if (!view) return;
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
    const view = (window as Window & { __milkdownEditorView?: EditorView }).__milkdownEditorView;
    if (!view) return;
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
      return undefined;
    }
    return createAudioUploadHandler(contentType, contentId, organizationId, onFileUploaded);
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

    // ── Insert mention chip ─────────────────────────────────────
    // All @mentions create chips. Media files can be converted to
    // inline embeds via the "Embed" button in the hover preview.
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
      enableComments ? () => commentCallbackRef.current() : undefined,
      () => highlightCallbackRef.current(),
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
      // Register mention plugins (includes view capture plugin)
      editor.use(mentionPlugins);
      // Register highlight mark plugin (both edit and readonly - highlights are content)
      editor.use(highlightPlugins);
      // Register comment highlight decorations (edit mode with comments enabled only)
      if (!readonly && enableComments) {
        editor.use(commentDecorationsPlugin);
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

      // Store the editor reference globally so we can access it in plugins
      (window as Window & { __milkdownEditor?: unknown }).__milkdownEditor = editor;
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
            (window as Window & { __milkdownEditorView?: unknown }).__milkdownEditorView = view;

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
        crepe.on((listener) => {
          listener.markdownUpdated((_ctx, markdown, prevMarkdown) => {
            // Guard against callbacks firing after editor is destroyed
            if (cancelled || !crepeRef.current) return;
            if (markdown !== prevMarkdown) {
              handleContentChange(markdown);
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
      // Also clear container on cleanup to handle Strict Mode remount
      clearContainer(container);
      initializedNoteIdRef.current = null;
    };
    // Only recreate when content ID, readonly mode, or upload handlers change
    // Content changes in edit mode are handled by editor's internal state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentId, readonly, imageUploadHandler, videoUploadHandler, audioUploadHandler]);

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
    const crepe = new Crepe(createCrepeConfig(container, content, true, compact, placeholder));

    // Register plugins before create (same as above)
    try {
      const editor = crepe.editor;
      editor.use(videoPlugins);
      editor.use(audioPlugins);
      editor.use(tagPlugins);
      editor.use(mentionPlugins);
      editor.use(highlightPlugins);
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
            (window as Window & { __milkdownEditorView?: unknown }).__milkdownEditorView = view;
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
  }, [content, readonly, compact, placeholder]);

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

  // Handle highlight color selection from the picker
  const handleHighlightColor = useCallback((color: string | null) => {
    if (!crepeRef.current || !highlightPicker) return;

    try {
      crepeRef.current.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        if (!view) return;

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
        <div
          ref={editorRef}
          className={`crepe-editor prose max-w-none ${compact ? 'crepe-editor-compact px-3 py-2' : ''}`}
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
