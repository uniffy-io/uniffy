import { useEffect, useLayoutEffect, useRef, useCallback, useState, useMemo } from "react";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx, parserCtx, serializerCtx } from "@milkdown/core";
import { Plugin, Selection } from "@milkdown/prose/state";
import type { Node } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";
import { upload, uploadConfig, type Uploader } from "@milkdown/kit/plugin/upload";
import { $prose } from "@milkdown/kit/utils";
import { ySyncPlugin, ySyncPluginKey, yCursorPlugin, yUndoPlugin } from "y-prosemirror";
import * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import {
  MARKDOWN_MIRROR_ORIGIN,
  MARKDOWN_MIRROR_FIELD,
  MARKDOWN_TEXT_FIELD,
  MIRROR_ACTIVE_KEY,
  PROSEMIRROR_FRAGMENT_FIELD,
  fragmentHasRealContent,
  replaceMarkdownYText,
  replaceProsemirrorFragment,
  isMarkdownMirrorLeader,
  normalizeSerializedMarkdown,
} from "@/features/realtime/markdown";
import {
  observeFragmentSeedDuplicates,
  seedProsemirrorFragment,
  waitForFragmentSeed,
} from "@/features/realtime/fragmentSeeding";
import type { FragmentSeeder } from "@/features/realtime/multiplexer";
import { HYDRATION_ORIGIN } from "@/features/realtime";
import { identityPaint } from "@/config/theme/brandGradients";
import { randomUUID } from "@/shared/utils/uuid";
import { oneDark } from "@codemirror/theme-one-dark";
import { languages } from "@codemirror/language-data";
import { basicSetup } from "codemirror";
import { useAppSelector, useAppDispatch } from "@/app/hooks";
import { openViewerWithFetch } from "@/features/files/store/viewerThunks";
import { parseFileUrl, buildFileUrl, buildMediaUrl } from "@/shared/utils/fileUrls";
import { parseUrn, UrnType } from "@/shared/utils/urn";
import { searchApi } from "@/features/search";
import { tagPlugins } from "@/components/editor/plugins/tag";
import {
  mentionPlugins,
  onMentionTrigger,
  type MentionTriggerEvent,
} from "@/components/editor/plugins/mention";
import { videoPlugins } from "@/components/editor/plugins/video";
import { MentionSearch } from "@/components/editor/plugins/mention/MentionSearch";
import { createPortal } from "react-dom";
import { openSpotlightSearch } from "@/features/search";
import { useGlobalShortcuts } from "@/features/settings";
import { createImageUploadHandler, uploadImage } from "@/components/editor/utils/imageUploader";
import { createVideoUploadHandler, uploadVideo } from "@/components/editor/utils/videoUploader";
import { createAudioUploadHandler, uploadAudio } from "@/components/editor/utils/audioUploader";
import { findHeadingBySlug } from "@/components/editor/utils/headingScroll";
import { audioPlugins, setAudioRecordingUploadHandler } from "@/components/editor/plugins/audio";
import { tocPlugins } from "@/components/editor/plugins/toc";
import { highlightPlugins, highlightMark } from "@/components/editor/plugins/highlight";
import { HighlightPicker } from "@/components/editor/plugins/highlight/HighlightPicker";
import { underlinePlugins } from "@/components/editor/plugins/underline";
import { imageResizeView } from "@/components/editor/plugins/image";
import { slashMenuGridNavigation } from "@/components/editor/plugins/slashMenuGridNavigation";
import {
  insertTocBlock,
  insertVideoBlock,
  insertAudioBlock,
  insertAudioRecording,
} from "@/components/editor/commands/insertBlocks";
import {
  createSelectionVersionPlugin,
  disposeSelectionScope,
} from "@/components/editor/utils/selectionVersionPlugin";
import type { EditorHandle } from "@/components/editor/EditorHandle";
import { registerEditor } from "@/components/editor/editorRegistry";
import type { SearchResultItem } from "@uniffy/proto/search/v1/search_pb";
import { InlineCommentPopover } from "@/features/comments/components/InlineCommentPopover";
import { CommentThreadPopover } from "@/features/comments/components/CommentThreadPopover";
import {
  commentDecorationsPlugin,
  updateCommentDecorations,
  setCommentClickHandler,
} from "@/features/comments/plugins/commentDecorations";
import type { CommentAnchor } from "@/features/comments/plugins/commentDecorations";
import { useComments } from "@/features/comments/hooks/useComments";
import { setActiveComment } from "@/features/comments/store/commentsSlice";
import { CommentAnchorType } from "@uniffy/proto/comments/v1/comments_pb";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";

// Import only common Crepe styles - frame themes set global html/body styles that break our app
import "@milkdown/crepe/theme/common/style.css";

// Comment highlight styles
import "@/features/comments/styles/comments.css";

// Import our custom overrides that handle theming
import "@/components/editor/styles/editor.css";

export interface CrepeRealtimeBinding {
  ydoc: Y.Doc;
  awareness: Awareness;
  undoManager: Y.UndoManager | null;
  sessionId: string;
  fragmentSeeder: FragmentSeeder;
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
  /** Fires once the realtime cold-start seed is settled and the editor accepts input; hosts keep a
   * read-only preview up until then. Realtime editable editors only. */
  onRealtimeSeeded?: () => void;
  /** In-doc content rendered above the editor surface (e.g. title, cover) that scrolls with the document. */
  headerSlot?: React.ReactNode;
  /** Default true; notes opt out because they ship their own floating toolbar. */
  floatingToolbar?: boolean;
  /** Default true; surfaces whose markdown feeds an LLM prompt turn it off - not every model accepts images. */
  allowImages?: boolean;
}

const VIDEO_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256" fill="currentColor"><path d="M164,104v48a4,4,0,0,1-4,4H48a4,4,0,0,1-4-4V104a4,4,0,0,1,4-4H160A4,4,0,0,1,164,104Zm48-8a4,4,0,0,0-4.22.43L172,122.75V133.25l35.78,26.32A4,4,0,0,0,212,160a4,4,0,0,0,4-4V100A4,4,0,0,0,212,96Z"/></svg>';
const AUDIO_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256" fill="currentColor"><path d="M155.51,24.81a8,8,0,0,0-8.42.88L77.25,80H32A16,16,0,0,0,16,96v64a16,16,0,0,0,16,16H77.25l69.84,54.31A8,8,0,0,0,160,224V32A8,8,0,0,0,155.51,24.81ZM144,207.64,84.91,161.69A7.94,7.94,0,0,0,80,160H32V96H80a7.94,7.94,0,0,0,4.91-1.69L144,48.36Zm64-79.64a24,24,0,0,0-24-24,8,8,0,0,0,0,16,8,8,0,0,1,0,16,8,8,0,0,0,0,16A24,24,0,0,0,208,128Z"/></svg>';
const RECORD_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256" fill="currentColor"><path d="M128,176a48.05,48.05,0,0,0,48-48V64a48,48,0,0,0-96,0v64A48.05,48.05,0,0,0,128,176ZM96,64a32,32,0,0,1,64,0v64a32,32,0,0,1-64,0Zm40,143.6V232a8,8,0,0,1-16,0V207.6A80.11,80.11,0,0,1,48,128a8,8,0,0,1,16,0,64,64,0,0,0,128,0,8,8,0,0,1,16,0A80.11,80.11,0,0,1,136,207.6Z"/></svg>';
const TOC_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 256 256" fill="currentColor"><path d="M88,64a8,8,0,0,1,8-8H216a8,8,0,0,1,0,16H96A8,8,0,0,1,88,64Zm128,56H96a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Zm0,64H96a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16ZM44,52A12,12,0,1,0,56,64,12,12,0,0,0,44,52Zm0,64a12,12,0,1,0,12,12A12,12,0,0,0,44,116Zm0,64a12,12,0,1,0,12,12A12,12,0,0,0,44,180Z"/></svg>';

// A missing seeder must not leave the editor read-only indefinitely.
// An unassigned editor waits this long for the server's seeder before seeding itself.
// A closing non-leader gives the leader this long to mirror before writing itself.
const MIRROR_LEAVE_SETTLE_MS = 600;

function clearContainer(container: HTMLElement) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

// crepe.destroy() is async and tears the Milkdown ctx ahead of the
// EditorView, so a binding left observing the shared fragment dispatches
// into a view whose plugins read disposed ctx slices and throw.
// y-prosemirror's deferred metadata flush gates on `binding.isDestroyed`,
// but binding.destroy() never sets it - set it ourselves.
function muteSyncBinding(view: EditorView | null | undefined) {
  if (!view || view.isDestroyed) return;
  try {
    const syncState = ySyncPluginKey.getState(view.state) as {
      binding?: { destroy?: () => void; isDestroyed?: boolean };
    } | null;
    const binding = syncState?.binding;
    if (binding) {
      binding.isDestroyed = true;
      binding.destroy?.();
    }
  } catch {
    // best effort
  }
}

function destroyCrepeAfterPendingViews(crepe: Crepe, view?: EditorView | null) {
  // Milkdown leaves debounced listener callbacks queued after context teardown.
  crepe.on((listener) => {
    listener.listeners.markdownUpdated.length = 0;
    listener.listeners.updated.length = 0;
  });
  // Crepe list node views restore their selection in a RAF that their destroy hook does not cancel.
  // Register teardown after those callbacks so they cannot dispatch into a disposed Milkdown context.
  requestAnimationFrame(() => {
    if (view) {
      muteSyncBinding(view);
    } else {
      try {
        crepe.editor.action((ctx) => muteSyncBinding(ctx.get(editorViewCtx)));
      } catch {
        // The editor did not finish creating a view.
      }
    }
    void crepe.destroy();
  });
}

// Custom y-prosemirror cursor builder: colored caret with an
// auto-hiding name flag so static labels do not clutter the editor.
// Peer paint is derived from the display name, the same way avatars are, so a
// caret and its owner's avatar always carry one identity.
function buildRealtimeCursor(user: { name?: string } | null): HTMLElement {
  const name = user?.name ?? "Anonymous";
  const paint = identityPaint(name);

  const caret = document.createElement("span");
  caret.classList.add("uniffy-yjs-cursor");
  caret.setAttribute("style", `background-color: ${paint.solid}`);

  const flag = document.createElement("div");
  flag.classList.add("uniffy-yjs-cursor__flag");
  flag.setAttribute("style", `background-image: ${paint.gradient}`);
  flag.textContent = name;

  caret.appendChild(flag);
  return caret;
}

function buildRealtimeSelection(user: { name?: string } | null): {
  class?: string;
  style?: string;
} {
  const paint = identityPaint(user?.name ?? "Anonymous");
  return {
    class: "uniffy-yjs-selection",
    style: `background-color: ${paint.translucent}`,
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
  allowImages: boolean = true,
) {
  return {
    root,
    // y-prosemirror owns the doc under realtime; seeding via
    // ``defaultValue`` would race the ySyncPlugin and dup content.
    defaultValue: realtime ? "" : content,
    features: {
      [Crepe.Feature.CodeMirror]: true,
      [Crepe.Feature.ListItem]: true,
      [Crepe.Feature.LinkTooltip]: false,
      [Crepe.Feature.ImageBlock]: allowImages,
      // BlockEdit supplies slash commands; its add and drag handles stay hidden via CSS.
      [Crepe.Feature.BlockEdit]: !readonly,
      [Crepe.Feature.Placeholder]: !readonly,
      // Crepe's own selection toolbar. Hosts that mount the React toolbars
      // (notes, ExpandableEditor) turn it off; the agents surfaces keep it.
      [Crepe.Feature.Toolbar]: !readonly && floatingToolbar,
      [Crepe.Feature.Cursor]: !readonly,
      [Crepe.Feature.Table]: true,
      [Crepe.Feature.Latex]: true,
    },
    featureConfigs: {
      [Crepe.Feature.Placeholder]: {
        text: placeholderText,
        mode: compact ? ("block" as const) : ("doc" as const),
      },
      [Crepe.Feature.CodeMirror]: {
        theme: oneDark,
        languages: languages,
        extensions: [basicSetup],
        searchPlaceholder: "Search language...",
        noResultText: "No language found",
      },
      ...(allowImages &&
        imageUploadHandler && {
          [Crepe.Feature.ImageBlock]: {
            onUpload: imageUploadHandler,
          },
        }),
      ...(!readonly && {
        [Crepe.Feature.BlockEdit]: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          buildMenu: (builder: any) => {
            const advancedGroup = builder.getGroup("advanced");
            if (!advancedGroup) return;

            advancedGroup.addItem("toc", {
              label: "Table of Contents",
              icon: TOC_ICON_SVG,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              onRun: (ctx: any) => insertTocBlock(ctx),
            });

            if (videoUploadHandler) {
              const videoHandler = videoUploadHandler;
              advancedGroup.addItem("video", {
                label: "Video",
                icon: VIDEO_ICON_SVG,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onRun: (ctx: any) => insertVideoBlock(ctx, videoHandler),
              });
            }

            if (audioUploadHandler) {
              const audioHandler = audioUploadHandler;
              advancedGroup.addItem("audio", {
                label: "Audio",
                icon: AUDIO_ICON_SVG,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onRun: (ctx: any) => insertAudioBlock(ctx, audioHandler),
              });

              advancedGroup.addItem("record", {
                label: "Record Audio",
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

  const fileMentions: Array<{
    pos: number;
    node: Node;
    urn: string;
    label: string;
    fileId: string;
  }> = [];

  view.state.doc.descendants((node, pos) => {
    if (node.type.name !== "mention") return;
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
    resolvedMap = (response.resolved ?? {}) as Record<
      string,
      { metadata?: Record<string, string> }
    >;
  } catch {
    return;
  }

  // Build replacements in reverse order so positions stay valid
  const replacements: Array<{
    pos: number;
    nodeSize: number;
    mediaType: "image" | "video" | "audio";
    url: string;
    title: string;
  }> = [];

  for (const mention of fileMentions) {
    const resolved = resolvedMap[mention.urn];
    const mime = resolved?.metadata?.mime_type;
    if (!mime) continue;

    let mediaType: "image" | "video" | "audio";
    let url: string;

    if (mime.startsWith("image/")) {
      mediaType = "image";
      url = buildFileUrl(organizationId, mention.fileId);
    } else if (mime.startsWith("video/")) {
      mediaType = "video";
      url = buildMediaUrl(organizationId, mention.fileId);
    } else if (mime.startsWith("audio/")) {
      mediaType = "audio";
      url = buildMediaUrl(organizationId, mention.fileId);
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

    if (rep.mediaType === "image") {
      const imageType = schema.nodes["image-block"] ?? schema.nodes.image;
      mediaNode = imageType?.createAndFill?.({ src: rep.url, alt: rep.title }) ?? null;
    } else if (rep.mediaType === "video") {
      const videoType = schema.nodes.video_block;
      mediaNode = videoType?.create({ src: rep.url, title: rep.title }) ?? null;
    } else if (rep.mediaType === "audio") {
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

      if (parentNode.textContent.trim() === "") {
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

const defaultSettings = {
  editorMode: "crepe" as const,
  showMarkdownPreview: true,
  fontSize: 16,
  lineHeight: 1.6,
  spellCheck: true,
};

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
  onRealtimeSeeded,
  headerSlot,
  floatingToolbar = true,
  allowImages = true,
  realtime,
}: CrepeEditorProps) {
  const realtimeRef = useRef<CrepeRealtimeBinding | undefined>(realtime);
  // The Crepe instance and its $prose plugins are built once - rebuilding them
  // would drop the ySync binding and the markdown mirror - so current props
  // reach the plugin closures through refs written here rather than in effects.
  // eslint-disable-next-line react/react-compiler -- latest-value ref for the one-shot editor plugins
  realtimeRef.current = realtime;
  const dispatch = useAppDispatch();
  const editorState = useAppSelector((state) => state.editor);
  const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

  // Comment decorations: fetch + read comments from Redux (only when comments enabled)
  const { comments: contentComments, refresh: refreshComments } = useComments(
    enableComments ? contentType : ContentType.NOTE,
    enableComments ? contentId : "",
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
        text: (c.anchorData?.text as string) ?? "",
        isResolved: c.isResolved,
      }));
  }, [enableComments, contentComments]);

  // Refs to pass current values into the plugin without re-creating the editor
  /* eslint-disable react/react-compiler -- latest-value refs for the one-shot editor plugins */
  const commentAnchorsRef = useRef(commentAnchors);
  commentAnchorsRef.current = commentAnchors;
  const activeCommentIdRef = useRef(activeCommentId);
  activeCommentIdRef.current = activeCommentId;
  /* eslint-enable react/react-compiler */

  const settings = editorState?.settings ?? defaultSettings;
  const editorRef = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const mirrorFlushRef = useRef<(() => void) | null>(null);
  const mirrorDisposeRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => () => mirrorDisposeRef.current?.(), []);
  const unregisterEditorRef = useRef<(() => void) | null>(null);
  const initializedNoteIdRef = useRef<string | null>(null);
  const handleScopeRef = useRef<object>({});
  const onEditorReadyRef = useRef(onEditorReady);
  // eslint-disable-next-line react/react-compiler -- latest-value ref for the one-shot editor plugins
  onEditorReadyRef.current = onEditorReady;
  const onRealtimeSeededRef = useRef(onRealtimeSeeded);
  // eslint-disable-next-line react/react-compiler -- latest-value ref for the one-shot editor plugins
  onRealtimeSeededRef.current = onRealtimeSeeded;

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
  // eslint-disable-next-line react/react-compiler -- latest-value ref for the one-shot editor plugins
  commentCallbackRef.current = () => {
    const view = viewRef.current;
    if (!view || view.isDestroyed) return;
    const { from, to } = view.state.selection;
    if (from === to) return;

    const text = view.state.doc.textBetween(from, to, " ");
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
  // eslint-disable-next-line react/react-compiler -- latest-value ref for the one-shot editor plugins
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
    const handler = createAudioUploadHandler(
      contentType,
      contentId,
      organizationId,
      onFileUploaded,
    );
    setAudioRecordingUploadHandler(handler);
    return handler;
  }, [readonly, enableUpload, organizationId, contentId, contentType, onFileUploaded]);

  // Handle content changes from the editor
  const handleContentChange = useCallback(
    (markdown: string) => {
      if (readonly) return;
      onChange?.(normalizeSerializedMarkdown(markdown));
    },
    [readonly, onChange],
  );

  // Handle mention selection
  const handleMentionSelect = useCallback(
    (result: SearchResultItem) => {
      if (!mentionPopup) return;

      const { view, from: storedFrom, query } = mentionPopup;
      const { state, dispatch: dispatchTransaction } = view;
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
      tr.insertText(" ", spacePos);

      // Set cursor after the space
      tr.setSelection(Selection.near(tr.doc.resolve(spacePos + 1)));

      dispatchTransaction(tr);
      view.focus();
      setMentionPopup(null);
    },
    [mentionPopup],
  );

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

  const readonlyContent = readonly ? content : null;

  useEffect(() => {
    if (!editorRef.current) return;

    const container = editorRef.current;
    let cancelled = false;
    const seedAbort = new AbortController();
    // The Y.Text mirror stays off until the cold-start seed confirms the
    // ProseMirror doc reflects ``Y.Text("markdown")``. Mirroring an
    // unseeded (empty) doc would overwrite real markdown with "".
    let markdownMirrorReady = false;

    // Clean up any existing instance first
    if (crepeRef.current) {
      destroyCrepeAfterPendingViews(crepeRef.current, viewRef.current);
      crepeRef.current = null;
    }

    // Clear the container to prevent duplication
    clearContainer(container);

    initializedNoteIdRef.current = contentId;

    const crepe = new Crepe(
      createCrepeConfig(
        container,
        content,
        readonly,
        compact,
        placeholder,
        imageUploadHandler,
        videoUploadHandler,
        audioUploadHandler,
        floatingToolbar,
        Boolean(realtimeRef.current),
        allowImages,
      ),
    );

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
      if (allowImages) editor.use(imageResizeView);
      // Arrow-key remap for the two column slash menu grid
      editor.use(slashMenuGridNavigation);
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
        editor.use(
          $prose(() =>
            yCursorPlugin(rt.awareness, {
              cursorBuilder: buildRealtimeCursor,
              selectionBuilder: buildRealtimeSelection,
            }),
          ),
        );
        if (rt.undoManager) {
          editor.use($prose(() => yUndoPlugin({ undoManager: rt.undoManager! })));
        }

        // One editor mirrors merged fragment state so simultaneous serializers cannot duplicate text.
        editor.use(
          $prose((ctx) => {
            let timer: ReturnType<typeof setTimeout> | null = null;
            let settleTimer: ReturnType<typeof setTimeout> | null = null;
            let pendingView: EditorView | null = null;
            let activeView: EditorView | null = null;
            let disposed = false;
            const mirrorOwner = randomUUID();
            const ownsMirror = () => !readonly && isMarkdownMirrorLeader(rt.awareness);
            const serialize = (view: EditorView): string | null => {
              try {
                return normalizeSerializedMarkdown(ctx.get(serializerCtx)(view.state.doc));
              } catch {
                // Serializer not ready yet - next update retries.
                return null;
              }
            };
            const flush = (view: EditorView) => {
              timer = null;
              pendingView = null;
              if (!markdownMirrorReady || !ownsMirror() || view.isDestroyed) return;
              const markdown = serialize(view);
              if (markdown !== null)
                replaceMarkdownYText(rt.ydoc, markdown, MARKDOWN_MIRROR_ORIGIN);
            };
            // A closing editor cannot rely on the leader being awake, or the column lags until
            // the next open. Serialize now; a non-leader gives the leader one settle window to
            // catch up, then writes itself. The leader's observer reconciles concurrent writes.
            const flushOnLeave = (settleMs: number) => {
              if (timer) {
                clearTimeout(timer);
                timer = null;
              }
              pendingView = null;
              const view = activeView;
              if (!markdownMirrorReady || readonly || !view || view.isDestroyed) return;
              const markdown = serialize(view);
              if (markdown === null) return;
              const fragmentState = fragment.toString();
              const ytext = rt.ydoc.getText(MARKDOWN_TEXT_FIELD);
              const write = () => {
                if (ytext.toString() !== markdown) {
                  replaceMarkdownYText(rt.ydoc, markdown, MARKDOWN_MIRROR_ORIGIN);
                }
              };
              if (settleMs === 0 || isMarkdownMirrorLeader(rt.awareness)) {
                write();
                return;
              }
              if (settleTimer) clearTimeout(settleTimer);
              settleTimer = setTimeout(() => {
                settleTimer = null;
                if (fragment.toString() !== fragmentState) return;
                write();
              }, settleMs);
            };
            const schedule = () => {
              if (!activeView || activeView.isDestroyed) return;
              pendingView = activeView;
              if (timer) clearTimeout(timer);
              timer = setTimeout(flushPending, 250);
            };
            const flushPending = () => {
              if (timer) {
                clearTimeout(timer);
                timer = null;
              }
              if (pendingView && !pendingView.isDestroyed) flush(pendingView);
              pendingView = null;
            };
            const leaveFlush = () => flushOnLeave(MIRROR_LEAVE_SETTLE_MS);
            mirrorFlushRef.current = leaveFlush;
            return new Plugin({
              view: (view) => {
                activeView = view;
                const mirrorMeta = rt.ydoc.getMap(MARKDOWN_MIRROR_FIELD);
                const markdown = rt.ydoc.getText(MARKDOWN_TEXT_FIELD);
                const stopSeedHealing = readonly
                  ? () => {}
                  : observeFragmentSeedDuplicates(rt.ydoc);
                const onMarkdown = () => {
                  if (!markdownMirrorReady || !ownsMirror()) return;
                  if (mirrorMeta.get(MIRROR_ACTIVE_KEY)) {
                    schedule();
                    return;
                  }
                  // Column writes and Markdown mode update text without a mirror marker.
                  const externalMarkdown = markdown.toString();
                  queueMicrotask(() => {
                    if (!activeView || activeView.isDestroyed || !ownsMirror()) return;
                    const node = ctx.get(parserCtx)(externalMarkdown);
                    if (node) replaceProsemirrorFragment(rt.ydoc, node, HYDRATION_ORIGIN);
                  });
                };
                markdown.observe(onMarkdown);
                // Awareness changes on every peer caret move; only a leadership
                // handoff needs the newly elected editor to catch the text up.
                let leader = false;
                const onAwareness = () => {
                  const next = ownsMirror();
                  if (next === leader) return;
                  leader = next;
                  if (next) schedule();
                };
                rt.awareness.on("change", onAwareness);
                if (!readonly) rt.awareness.setLocalStateField("markdownEditor", mirrorOwner);
                void rt.whenSynced.then(schedule);
                // Navigation does not destroy React node views before closing the document,
                // and a closing page cannot wait for the leader.
                const onPageHide = () => flushOnLeave(0);
                window.addEventListener("pagehide", onPageHide);
                const dispose = () => {
                  if (disposed) return;
                  window.removeEventListener("pagehide", onPageHide);
                  leaveFlush();
                  disposed = true;
                  stopSeedHealing();
                  activeView = null;
                  markdown.unobserve(onMarkdown);
                  rt.awareness.off("change", onAwareness);
                  if (rt.awareness.getLocalState()?.markdownEditor === mirrorOwner) {
                    rt.awareness.setLocalStateField("markdownEditor", null);
                  }
                  if (mirrorFlushRef.current === leaveFlush) mirrorFlushRef.current = null;
                  if (mirrorDisposeRef.current === dispose) mirrorDisposeRef.current = null;
                };
                mirrorDisposeRef.current = dispose;
                return {
                  update: (updatedView, prevState) => {
                    if (disposed) return;
                    if (updatedView.state.doc.eq(prevState.doc)) return;
                    activeView = updatedView;
                    schedule();
                  },
                  destroy: dispose,
                };
              },
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
            if (file.type.startsWith("image/")) {
              try {
                const url = await uploadImage({
                  file,
                  organizationId: orgIdCapture,
                  contentId: contentIdCapture,
                  contentType: contentTypeCapture,
                  onFileUploaded: onFileUploadedCapture,
                });

                const imageType = schema.nodes["image-block"] ?? schema.nodes.image;
                const node = imageType?.createAndFill({
                  src: url,
                  alt: file.name,
                });
                if (node) {
                  nodes.push(node);
                }
              } catch (error) {
                console.error("[CrepeEditor] Failed to upload pasted image:", error);
              }
            }

            // Handle video files
            if (file.type.startsWith("video/")) {
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
                console.error("[CrepeEditor] Failed to upload pasted video:", error);
              }
            }

            // Handle audio files
            if (file.type.startsWith("audio/")) {
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
                console.error("[CrepeEditor] Failed to upload pasted audio:", error);
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
      // If effect was cleaned up before create finished, destroy immediately.
      // The cleanup ran before this instance had a view, so detach its
      // ySync binding here or it lingers as a live fragment observer and
      // any fragment rebuild re-enters its half-destroyed view.
      if (cancelled) {
        destroyCrepeAfterPendingViews(crepe);
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
                flushMarkdownMirror: () => mirrorFlushRef.current?.(),
                run: (fn) => {
                  try {
                    return crepe.editor.action(fn);
                  } catch (error) {
                    console.error("[CrepeEditor] handle.run failed:", error);
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
                  setThreadPopover({
                    commentId,
                    rect: el.getBoundingClientRect(),
                  });
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

      // After sync, seed empty blocks or reconcile explicit markdown writes.
      // Mirror-derived text can lag the fragment during offline recovery.
      const rtBinding = realtimeRef.current;
      if (rtBinding && !readonly) {
        void rtBinding.whenSynced.then(async () => {
          if (cancelled || !crepeRef.current) return;
          try {
            const coldFragment = rtBinding.ydoc.get(PROSEMIRROR_FRAGMENT_FIELD, Y.XmlFragment);
            if (
              !fragmentHasRealContent(coldFragment) &&
              rtBinding.ydoc.get(MARKDOWN_TEXT_FIELD, Y.Text).toString()
            ) {
              // Hold input until server assignment or peer seed protects these blocks.
              crepe.setReadonly(true);
              await waitForFragmentSeed(coldFragment, rtBinding.fragmentSeeder, seedAbort.signal);
              if (cancelled || !crepeRef.current) return;
              if (fragmentHasRealContent(coldFragment)) {
                markdownMirrorReady = true;
                return;
              }
            }
            crepe.editor.action((ctx) => {
              const view = ctx.get(editorViewCtx);
              if (!view || view.isDestroyed) return;
              const fragment = rtBinding.ydoc.get(PROSEMIRROR_FRAGMENT_FIELD, Y.XmlFragment);
              const ytext = rtBinding.ydoc.get(MARKDOWN_TEXT_FIELD, Y.Text);
              const md = ytext.toString();
              // Empty Y.Text never wins over fragment content; the mirror
              // fills it from the next serialized doc instead.
              if (!md) {
                markdownMirrorReady = true;
                return;
              }
              const parser = ctx.get(parserCtx);
              const node = parser(md);
              if (!node) return;
              if (fragmentHasRealContent(fragment)) {
                // A rendered mirror can lag or conflict after offline merges. Preserve primary blocks.
                if (rtBinding.ydoc.getMap(MARKDOWN_MIRROR_FIELD).get(MIRROR_ACTIVE_KEY)) {
                  markdownMirrorReady = true;
                  return;
                }
                // Compare serialize-normalized forms. Markdown dialect
                // differences (bullet chars, escapes, spacing) make a raw
                // string compare against Y.Text useless.
                const serializer = ctx.get(serializerCtx);
                if (
                  normalizeSerializedMarkdown(serializer(view.state.doc)) ===
                  normalizeSerializedMarkdown(serializer(node))
                ) {
                  markdownMirrorReady = true;
                  return;
                }
                // With a live peer attached the fragment IS the current CRDT
                // state (their in-flight keystrokes); Y.Text merely trails it
                // by the mirror debounce. Rebuilding would broadcast a revert
                // of those keystrokes, so the divergence rebuild is a
                // solo-client self-heal only.
                const awareness = rtBinding.awareness;
                const hasPeer = Array.from(awareness.getStates().keys()).some(
                  (clientId) => clientId !== awareness.clientID,
                );
                if (hasPeer) {
                  markdownMirrorReady = true;
                  return;
                }
              }
              // Flag first: the rebuild's Y mutations commit even when a
              // foreign fragment observer throws mid-notification, and that
              // throw must not leave the mirror off for a doc that already
              // reflects Y.Text.
              markdownMirrorReady = true;
              if (fragmentHasRealContent(fragment)) {
                replaceProsemirrorFragment(rtBinding.ydoc, node, HYDRATION_ORIGIN);
              } else {
                seedProsemirrorFragment(rtBinding.ydoc, node);
              }
            });
          } catch (err) {
            // Parse or serialize failure: keep showing the fragment with the
            // mirror off rather than risk destroying content in Y.Text.
            console.warn("[CrepeEditor] realtime cold-start seed failed", err);
          } finally {
            if (!cancelled && crepeRef.current) {
              crepe.setReadonly(false);
              onRealtimeSeededRef.current?.();
            }
          }
        });
      }

      if (readonly || rtBinding) {
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
      seedAbort.abort();
      mirrorDisposeRef.current?.();
      if (unregisterEditorRef.current) {
        unregisterEditorRef.current();
        unregisterEditorRef.current = null;
      }
      const view = viewRef.current;
      viewRef.current = null;
      if (crepeRef.current) {
        destroyCrepeAfterPendingViews(crepeRef.current, view);
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
  }, [
    contentId,
    readonly,
    readonlyContent,
    imageUploadHandler,
    videoUploadHandler,
    audioUploadHandler,
    realtime?.ydoc,
  ]);

  // Get shortcut matching function from settings
  const { matches } = useGlobalShortcuts();

  // Handle keyboard shortcuts within the editor (where global shortcuts don't work)
  useEffect(() => {
    const container = editorRef.current;
    if (!container) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Check if this matches the nav.search shortcut
      if (matches("nav.search", e)) {
        e.preventDefault();
        e.stopPropagation();
        openSpotlightSearch();
      }
    };

    container.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => container.removeEventListener("keydown", handleKeyDown, { capture: true });
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
      const img = target.closest("img") || (target.tagName === "IMG" ? target : null);
      if (!img) return;

      const src = (img as HTMLImageElement).src;
      const parsed = parseFileUrl(src);
      if (!parsed) return;

      e.preventDefault();
      e.stopPropagation();
      dispatch(openViewerWithFetch({ fileId: parsed.fileId }));
    };

    container.addEventListener("click", handleClick, { capture: true });
    return () => container.removeEventListener("click", handleClick, { capture: true });
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
      const anchor = target?.closest("a");
      if (!anchor) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      // In-doc hash link (`#slug`) - resolve locally.
      let slug: string | null = null;
      let parsedUrl: URL | null = null;
      if (href.startsWith("#")) {
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
        heading.scrollIntoView({ behavior: "smooth", block: "start" });
        // Keep the URL shareable without polluting browser history.
        const nextUrl = `${window.location.pathname}${window.location.search}#${slug}`;
        window.history.replaceState(window.history.state, "", nextUrl);
        return;
      }

      // External link (or any non-anchor URL): open in a new tab. Skip
      // unsupported schemes (mailto:, tel:, etc.) so the browser default
      // still launches the right handler in the same tab.
      const scheme = parsedUrl?.protocol ?? "";
      if (scheme === "http:" || scheme === "https:") {
        e.preventDefault();
        e.stopPropagation();
        window.open(parsedUrl!.href, "_blank", "noopener,noreferrer");
      }
    };

    container.addEventListener("click", handleAnchorClick, { capture: true });
    return () => container.removeEventListener("click", handleAnchorClick, { capture: true });
  }, []);

  // Handle highlight color selection from the picker
  const handleHighlightColor = useCallback(
    (color: string | null) => {
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
    },
    [highlightPicker],
  );

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
      <div
        className={`crepe-editor-wrapper ${compact ? "" : "h-full"} overflow-y-auto ${className || ""}`}
        style={{
          ...(minHeight ? { minHeight } : {}),
          ...(maxHeight ? { maxHeight } : {}),
        }}
      >
        {headerSlot}
        <div
          ref={editorRef}
          className={`crepe-editor prose max-w-none ${compact ? "crepe-editor-compact px-3 py-2" : ""}`}
          style={
            className?.includes("chat-bubble-editor")
              ? undefined
              : {
                  fontSize: `${settings?.fontSize || 16}px`,
                  lineHeight: settings?.lineHeight || 1.6,
                }
          }
        />
      </div>

      {/* Mention search popup - only for editable mode */}
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
            onQueryChange={(newQuery) =>
              setMentionPopup((prev) => (prev ? { ...prev, query: newQuery } : null))
            }
          />,
          document.body,
        )}

      {/* Highlight color picker - triggered from toolbar highlight button */}
      {!readonly &&
        highlightPicker &&
        createPortal(
          <HighlightPicker
            anchorRect={highlightPicker.rect}
            onSelect={handleHighlightColor}
            onClose={() => setHighlightPicker(null)}
          />,
          document.body,
        )}

      {/* Inline comment form - triggered from toolbar comment button */}
      {!readonly &&
        enableComments &&
        commentSelection &&
        createPortal(
          <InlineCommentPopover
            selection={commentSelection}
            contentType={contentType}
            contentId={contentId}
            onClose={() => setCommentSelection(null)}
          />,
          document.body,
        )}

      {/* Comment thread popover - triggered from clicking highlighted text */}
      {enableComments &&
        threadPopover &&
        (() => {
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
