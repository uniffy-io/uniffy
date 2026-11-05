import { useState, useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ArrowsOut, Check, PencilSimple } from "@phosphor-icons/react";
import { CrepeEditor } from "@/components/editor/CrepeEditor";
import { EditorHandleContext, type EditorHandle } from "@/components/editor/EditorHandle";
import { EditorFormattingToolbar } from "@/components/editor/toolbar/EditorFormattingToolbar";
import { FloatingFormattingToolbar } from "@/components/editor/toolbar/FloatingFormattingToolbar";
import { Button } from "@/components/ui/button";
import { dialogShellClass } from "@/components/ui/popover";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { ContentType } from "@uniffy/proto/common/v1/common_pb";
import { cn } from "@/shared/utils/cn";
import { RealtimeConnectionNotice } from "@/features/realtime/components/RealtimeConnectionNotice";
import { serializeEditorMarkdown } from "@/features/realtime/markdown";
import {
  docContentTypeName,
  RealtimeSessionStatus,
  RealtimeStatusBadge,
  useCheckpointPending,
  useDeviceStorage,
  useDocSaveState,
  useMarkdownDocSession,
  usePendingDocSync,
  useSessionReleasable,
} from "@/features/realtime";

// Reopening inside this window resumes the same session instead of re-hydrating.
const SESSION_CLOSE_GRACE_MS = 1000;

interface ExpandableEditorProps {
  contentType: ContentType;
  contentId: string;
  value: string;
  /** Fires on every keystroke. Hosts that only want one write per edit can skip it and use `onDone`. */
  onChange?: (markdown: string) => void;
  /** Fires once when editing finishes, carrying the final markdown. */
  onDone?: (markdown: string, meta: { realtimeOwned: boolean; baseContent: string }) => void;
  realtime?: boolean;
  /** "inline" edits in place over the full-height preview, whatever `fullPreview` says; "overlay" opens a large editor above the page. */
  editingPresentation?: "overlay" | "inline";
  placeholder?: string;
  /** Defaults to true when `contentId` is provided. */
  enableUpload?: boolean;
  readonly?: boolean;
  /** Overlay header label, e.g. "Description". */
  label?: string;
  onFileUploaded?: (fileId: string) => void;
  fullPreview?: boolean;
  /** Caps the `fullPreview` height so long content doesn't stretch the host (e.g. task detail modal); becomes scrollable. */
  previewMaxHeight?: string;
  /** When true, render the label as a header row with Edit aligned right; otherwise the host owns the heading. */
  showHeader?: boolean;
  /** Lets a read-only user open the large view to read; it shows the host's value and never writes. */
  expandReadonly?: boolean;
  /** Tone of the sheet the inline editor sits on; its sticky band paints it so text scrolls under unseen. */
  tone?: "surface" | "background";
}

export function ExpandableEditor({
  contentType,
  contentId,
  value,
  onChange,
  onDone,
  placeholder = "Click to add a description...",
  enableUpload = !!contentId,
  readonly = false,
  realtime = false,
  editingPresentation = "overlay",
  label = "Description",
  onFileUploaded,
  fullPreview = false,
  previewMaxHeight,
  showHeader = false,
  expandReadonly = false,
  tone = "surface",
}: ExpandableEditorProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [editorReady, setEditorReady] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [draftInitial, setDraftInitial] = useState(value);
  const latestMarkdownRef = useRef(value);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editWithoutLive, setEditWithoutLive] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  // The cold-start seed is elected after sync; the read-only preview stays up until then.
  const [seeded, setSeeded] = useState(false);
  const [syncedSessionId, setSyncedSessionId] = useState<string | null>(null);
  // Set when the server replaced the document mid-session; "draft" when this session typed.
  const [replacedNotice, setReplacedNotice] = useState<"plain" | "draft" | null>(null);
  const realtimeConfigured = Boolean(realtime && contentId);
  const realtimeActive = realtimeConfigured && !editWithoutLive;
  const realtimeContentType = docContentTypeName(contentType);
  const { binding, status, docName } = useMarkdownDocSession({
    contentType: realtimeContentType,
    contentId,
    enabled: realtimeActive && sessionOpen,
    canEdit: !readonly,
    // Descriptions have many plain writers (mobile, agents, API); a cache kept past a
    // clean close would replay over their later writes on the next open.
    discardLocalOnCleanClose: true,
    onGenerationReset: (info) => setReplacedNotice(info.hasLocalEdits ? "draft" : "plain"),
  });
  const whenSynced = binding?.whenSynced;
  const sessionId = binding?.sessionId;
  const realtimeOwned = Boolean(sessionId && syncedSessionId === sessionId);
  useEffect(() => {
    if (!whenSynced || !sessionId) return;
    // eslint-disable-next-line react/react-compiler -- reset editor readiness with document identity
    setSeeded(false);
    let cancelled = false;
    void whenSynced.then(() => {
      if (!cancelled) setSyncedSessionId(sessionId);
    });
    return () => {
      cancelled = true;
    };
  }, [whenSynced, sessionId]);

  // Follows whichever attachment holds the doc: this session, then the drain after Done. Each value
  // changes rarely, so typing does not re-render the editor tree on every batch and receipt.
  const checkpointPending = useCheckpointPending(realtimeActive ? docName : null);
  const saveState = useDocSaveState(realtimeActive && !readonly ? docName : null);
  const storage = useDeviceStorage(realtimeActive ? docName : null);
  const strandedSync = usePendingDocSync(realtimeContentType, realtimeActive ? contentId : null);
  const transportDown = status === "disconnected" || status === "offline";
  // Unaccepted edits only reach the server through this attached doc, so Done holds the session
  // for them, and for accepted ones this device has not stored. Other accepted edits wait for
  // their checkpoint in the drain; a parent unmount still falls back to IDB.
  const releasable = useSessionReleasable(realtimeActive && closing ? docName : null, status);
  useEffect(() => {
    if (!closing || !releasable) return;
    const timer = setTimeout(() => {
      setSessionOpen(false);
      setClosing(false);
    }, SESSION_CLOSE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [closing, releasable]);
  useEffect(
    () => () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
    },
    [],
  );
  const [editorHandle, setEditorHandle] = useState<EditorHandle | null>(null);

  const inline = editingPresentation === "inline";
  const readView = readonly && expandReadonly;
  // A session still draining after Done does not count as editing.
  const editing = sessionOpen && !closing;
  const inlineEditing = inline && isExpanded && editing;

  const handleOpen = useCallback(() => {
    if (readonly) {
      // A reader gets the overlay without a realtime session: nothing to send, and a viewer
      // cannot seed a description no editor has opened yet.
      if (expandReadonly) setIsExpanded(true);
      return;
    }
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    setClosing(false);
    setSessionOpen(true);
    setEditWithoutLive(false);
    setSeeded(false);
    setReplacedNotice(null);
    setDraftInitial(value);
    latestMarkdownRef.current = value;
    setEditorReady(false);
    setEditorKey((k) => k + 1);
    setIsExpanded(true);

    // Let the editor shell paint before mounting the rich editor.
    openTimerRef.current = setTimeout(() => {
      setEditorReady(true);
    }, 50);
  }, [readonly, expandReadonly, value]);

  const handleClose = useCallback(() => {
    // The read view opened no session; an editor demoted mid-edit still closes and saves.
    if (!editing) {
      setIsExpanded(false);
      return;
    }
    setIsExpanded(false);
    setEditorReady(false);
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    setClosing(true);
    if (editWithoutLive) setSessionOpen(false);
    // Before the seed lands the editor holds nothing of the user's; reporting it would blank
    // the host's description.
    if (realtimeActive && !seeded) return;
    if (
      realtimeActive &&
      ["access_lost", "permission_lost", "token_revoked", "update_rejected"].includes(status)
    )
      return;
    editorHandle?.flushMarkdownMirror?.();
    const markdown = editorHandle?.run(serializeEditorMarkdown) ?? latestMarkdownRef.current;
    // Milkdown debounces change listeners, so closing must deliver the final edit to the host.
    if (markdown !== latestMarkdownRef.current) {
      latestMarkdownRef.current = markdown;
      onChange?.(markdown);
    }
    onDone?.(markdown, {
      realtimeOwned: realtimeActive && realtimeOwned,
      baseContent: draftInitial,
    });
  }, [
    editing,
    onChange,
    onDone,
    editorHandle,
    realtimeOwned,
    realtimeActive,
    seeded,
    editWithoutLive,
    status,
    draftInitial,
  ]);

  const handleRealtimeSeeded = useCallback(() => setSeeded(true), []);

  const handleEditorChange = useCallback(
    (markdown: string) => {
      latestMarkdownRef.current = markdown;
      onChange?.(markdown);
    },
    [onChange],
  );

  // The editor reports its handle once the ProseMirror view exists and clears it on unmount.
  const handleEditorReady = useCallback((handle: EditorHandle | null) => {
    setEditorHandle(handle);
  }, []);

  useEffect(() => {
    if (!isExpanded || !editorHandle) return;
    if (realtimeActive && !seeded) return;
    editorHandle.focus();
  }, [isExpanded, editorHandle, realtimeActive, seeded]);

  useOverlayEscape(handleClose, isExpanded);

  const hasContent = value && value.trim().length > 0;
  const waitingForNetwork =
    transportDown || (typeof navigator !== "undefined" && navigator.onLine === false);
  // After Done the chip follows the held session, then the drain; a registry entry with nothing
  // attached is still waiting to be sent.
  const afterDoneChip = !isExpanded && (checkpointPending || strandedSync) && (
    <RealtimeStatusBadge
      status={waitingForNetwork ? "offline" : sessionOpen ? status : "idle"}
      save={checkpointPending ? saveState : "syncing"}
      storage={storage}
    />
  );

  // Plain editing is offered only before this session holds the document.
  const editWithoutLiveAction =
    !readonly && !realtimeOwned && !replacedNotice && !checkpointPending && !strandedSync
      ? () => setEditWithoutLive(true)
      : undefined;
  // The toolbar chip already says Connecting, so the body copy waits for a slow connect. After a
  // generation change the body is blank, so there it explains the wait at once.
  const connectionNotice = (
    <RealtimeConnectionNotice
      key={editorKey}
      waiting
      status={status}
      quiet={!replacedNotice}
      onEditWithoutLive={editWithoutLiveAction}
    />
  );
  // After a generation change the open-time text is stale; the new session lands in a moment,
  // so the gap stays blank rather than flashing old content under "Connecting...".
  const waitingBody = replacedNotice ? (
    connectionNotice
  ) : (
    <div className="h-full overflow-y-auto p-6">
      {connectionNotice}
      <CrepeEditor
        contentType={contentType}
        contentId={contentId}
        value={draftInitial}
        readonly
        enableUpload={false}
        floatingToolbar={false}
      />
    </div>
  );
  const notices = [
    replacedNotice === "draft"
      ? `This ${label.toLowerCase()} was changed elsewhere. Your unsaved text is under Recovered draft.`
      : replacedNotice === "plain"
        ? `This ${label.toLowerCase()} was changed elsewhere.`
        : null,
    editWithoutLive ? "Live updates unavailable. Done saves changes." : null,
  ].filter((notice): notice is string => notice !== null);

  const liveMounted = editorReady && (!realtimeActive || Boolean(binding && realtimeOwned));
  // Inline, the preview stays up until the editor holds the document, so the two swap in one
  // frame instead of passing through a blank or half-built editor.
  const liveShown =
    inlineEditing && liveMounted && (realtimeActive ? seeded : editorHandle !== null);

  // A header row carries these where Edit was, so the inline bar keeps one row of tools.
  const controlsInHeader = inline && showHeader;
  const editingControls = (
    <>
      {/* Phones show these under the bar, so the chip and Done keep their row. */}
      {notices.map((notice) => (
        <span key={notice} className="hidden text-xs text-muted-foreground sm:inline" role="status">
          {notice}
        </span>
      ))}
      <RealtimeSessionStatus
        status={status}
        awareness={binding?.awareness ?? null}
        docName={docName}
        readOnly={readonly}
        whenSynced={binding?.whenSynced}
      />
      <Button
        type="button"
        size={inline ? "xs" : "md"}
        className={inline ? "touch:min-h-11 touch:min-w-11" : undefined}
        onClick={handleClose}
      >
        <Check size={inline ? 12 : 14} weight="bold" />
        Done
      </Button>
    </>
  );

  const toolbar = (
    <div className={cn("shrink-0 overflow-hidden", inline ? "rounded-lg" : "rounded-t-xl")}>
      <EditorFormattingToolbar
        contentType={contentType}
        contentId={contentId}
        enableUpload={enableUpload}
        onFileUploaded={onFileUploaded}
        className={inline ? "border-b-0" : undefined}
        trailing={controlsInHeader ? undefined : editingControls}
      />
      {notices.length > 0 && (
        <p
          className="border-b border-border/50 px-3 py-1.5 text-xs text-muted-foreground sm:hidden"
          role="status"
        >
          {notices.join(" ")}
        </p>
      )}
    </div>
  );

  // Inline takes the preview's compact metrics, so the text stays where it was being read.
  const liveEditor = (
    <CrepeEditor
      key={`${editorKey}:${sessionId ?? "local"}`}
      contentType={contentType}
      contentId={contentId}
      value={draftInitial}
      realtime={realtimeActive ? (binding ?? undefined) : undefined}
      readonly={
        readonly ||
        status === "permission_lost" ||
        status === "access_lost" ||
        status === "update_rejected" ||
        status === "token_revoked"
      }
      onChange={handleEditorChange}
      onEditorReady={handleEditorReady}
      onRealtimeSeeded={handleRealtimeSeeded}
      placeholder={placeholder}
      enableUpload={enableUpload}
      onFileUploaded={onFileUploaded}
      floatingToolbar={false}
      compact={inline}
      placeholderMode="doc"
      className={inline ? "crepe-editor-grows" : "pt-6"}
    />
  );

  const overlayEditor = (
    <EditorHandleContext.Provider value={editorHandle}>
      <div
        className={cn(
          dialogShellClass,
          "relative mx-4 flex h-[85vh] w-full min-w-0 max-w-5xl flex-col rounded-xl",
        )}
      >
        {toolbar}
        {/* Each part keeps its slot, so the waiting preview is not remounted when the editor
            mounts behind it. CrepeEditor's own wrapper handles scrolling. */}
        <div className="relative min-h-0 flex-1">
          {liveMounted && (
            <div
              className={cn("h-full", realtimeActive && !seeded && "invisible absolute inset-0")}
            >
              {liveEditor}
            </div>
          )}
          {realtimeActive && !(liveMounted && seeded) && waitingBody}
          {!realtimeActive && !liveMounted && (
            <div className="flex h-full items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
            </div>
          )}
        </div>
      </div>
      {/* Pinned bar above covers selection formatting; the floating one stays reachable via context menu. */}
      <FloatingFormattingToolbar showOnSelection={false} />
    </EditorHandleContext.Provider>
  );

  const fullPreviewBody = hasContent ? (
    <div
      className={cn(
        "expandable-editor-preview [&_.ProseMirror]:pointer-events-none [&_.mention-wrapper]:pointer-events-auto",
        previewMaxHeight && "overflow-y-auto",
      )}
      style={previewMaxHeight ? { maxHeight: previewMaxHeight } : undefined}
    >
      <CrepeEditor
        contentType={contentType}
        contentId={contentId}
        value={value}
        readonly
        enableUpload={false}
        compact
        className="border-none bg-transparent"
      />
    </div>
  ) : readView ? (
    <p className="text-sm text-subtle-foreground italic rounded-md bg-muted/50 px-3 py-2">
      No {label.toLowerCase()}
    </p>
  ) : (
    <div
      role="button"
      tabIndex={readonly ? undefined : 0}
      onClick={handleOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") handleOpen();
      }}
      className="text-sm text-muted-foreground italic cursor-pointer hover:text-foreground transition-colors rounded-md bg-muted/50 px-3 py-2"
    >
      {placeholder}
    </div>
  );

  // Without showHeader the Edit button floats at top-right; otherwise the header renders it next
  // to the label so it never sits over the preview scrollbar.
  const floatingEdit = !showHeader && (
    <div className="absolute top-0 right-0 flex items-center gap-3">
      {afterDoneChip}
      {!readonly && hasContent && (
        <button
          type="button"
          onClick={handleOpen}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
        >
          <PencilSimple size={12} />
          Edit
        </button>
      )}
    </div>
  );

  const headerRow = showHeader && (
    <div className={cn("mb-2 flex items-center justify-between gap-3", inline && "min-h-6")}>
      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {label}
      </h3>
      {inlineEditing ? (
        <div className="flex items-center gap-2">{editingControls}</div>
      ) : (
        <div className="flex items-center gap-3">
          {afterDoneChip}
          {!readonly && hasContent && (
            <button
              type="button"
              onClick={handleOpen}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <PencilSimple size={12} />
              Edit
            </button>
          )}
          {readView && hasContent && (
            <button
              type="button"
              onClick={handleOpen}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="expandable-editor-expand"
            >
              <ArrowsOut size={12} />
              Expand
            </button>
          )}
        </div>
      )}
    </div>
  );

  const inlineDocument = (
    <EditorHandleContext.Provider value={editorHandle}>
      <div
        data-testid={inlineEditing ? "expandable-editor-inline" : undefined}
        className="group relative min-w-0"
      >
        {/* Header and bar stay in reach as one band while the document scrolls under them. */}
        <div
          className={cn(
            inlineEditing && "sticky top-[var(--sticky-top,0px)] z-10",
            inlineEditing && (tone === "background" ? "bg-background" : "bg-surface"),
          )}
        >
          {headerRow}
          {inlineEditing && toolbar}
        </div>
        {/* The editing surface takes its full height on Edit, so the swap below moves nothing. */}
        <div
          className={cn(
            "relative flex flex-col",
            inlineEditing && "min-h-[clamp(20rem,60dvh,40rem)]",
          )}
        >
          {inlineEditing && liveMounted && (
            <div
              className={cn(
                "expandable-editor-live flex flex-1 flex-col",
                !liveShown && "invisible absolute inset-0 overflow-hidden",
              )}
            >
              {liveEditor}
            </div>
          )}
          {inlineEditing && !liveShown && realtimeActive && connectionNotice}
          {/* One slot in both states, so the preview read before Edit stays mounted until the swap. */}
          {!liveShown && !(inlineEditing && replacedNotice) && fullPreviewBody}
        </div>
        {!inlineEditing && floatingEdit}
      </div>
      {inlineEditing && <FloatingFormattingToolbar showOnSelection={false} />}
    </EditorHandleContext.Provider>
  );

  return (
    <>
      {!inline && headerRow}
      {inline ? (
        inlineDocument
      ) : fullPreview ? (
        <div className="relative group">
          {fullPreviewBody}
          {floatingEdit}
        </div>
      ) : (
        <div
          role="button"
          tabIndex={readonly ? undefined : 0}
          onClick={handleOpen}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") handleOpen();
          }}
          className={cn(
            "relative border border-border rounded-lg transition-colors overflow-hidden",
            readonly
              ? "cursor-default bg-muted/30"
              : "cursor-pointer hover:border-primary/40 hover:bg-muted/30",
          )}
        >
          {hasContent ? (
            <div className="max-h-[100px] overflow-hidden expandable-editor-preview [&_.ProseMirror]:pointer-events-none [&_.mention-wrapper]:pointer-events-auto">
              <CrepeEditor
                contentType={contentType}
                contentId={contentId}
                value={value}
                readonly
                enableUpload={false}
                compact
                className="border-none bg-transparent"
              />
              {/* Fade-out gradient at the bottom when content overflows */}
              <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-card to-transparent" />
            </div>
          ) : (
            <div className="px-3 py-2.5 min-h-[80px] flex items-start">
              <p className="text-sm text-muted-foreground">{placeholder}</p>
            </div>
          )}

          {/* Expand icon */}
          {!readonly && (
            <div className="absolute top-2 right-2 flex items-center gap-3">
              {afterDoneChip}
              <ArrowsOut size={16} weight="bold" className="text-muted-foreground" />
            </div>
          )}
        </div>
      )}

      {isExpanded &&
        !editing &&
        createPortal(
          <div className="fixed inset-0 z-[200] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={label}
              className={cn(
                dialogShellClass,
                "relative w-full max-w-5xl mx-4 rounded-xl flex flex-col h-[85vh]",
              )}
              data-testid="expandable-editor-read-view"
            >
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
                <h2 className="text-sm font-semibold text-foreground">{label}</h2>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-subtle-foreground">View only</span>
                  <Button type="button" size="md" onClick={handleClose}>
                    Close
                  </Button>
                </div>
              </div>
              <div className="flex-1 min-h-0 relative">
                <CrepeEditor
                  contentType={contentType}
                  contentId={contentId}
                  value={value}
                  readonly
                  enableUpload={false}
                  floatingToolbar={false}
                  className="pt-6"
                />
              </div>
            </div>
          </div>,
          document.body,
        )}

      {isExpanded &&
        !inline &&
        editing &&
        createPortal(
          <div className="fixed inset-0 z-[200] flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

            {/* Editor panel */}
            {overlayEditor}
          </div>,
          document.body,
        )}
    </>
  );
}
