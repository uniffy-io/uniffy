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
import { canReleaseSession } from "@/features/realtime/hooks/useDocSession";
import {
  docContentTypeName,
  RealtimeSessionStatus,
  RealtimeStatusBadge,
  useDeviceRecoveryState,
  useDocSaveState,
  useMarkdownDocSession,
  usePendingDocSync,
  useRealtimeDocState,
} from "@/features/realtime";

// Reopening inside this window resumes the same session instead of re-hydrating.
const SESSION_CLOSE_GRACE_MS = 1000;

interface ExpandableEditorProps {
  contentType: ContentType;
  contentId: string;
  value: string;
  /** Fires on every keystroke. Hosts that only want one write per edit can skip it and use `onDone`. */
  onChange?: (markdown: string) => void;
  /** Fires once when the overlay closes, carrying the final markdown. */
  onDone?: (markdown: string, meta: { realtimeOwned: boolean; baseContent: string }) => void;
  realtime?: boolean;
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
  label = "Description",
  onFileUploaded,
  fullPreview = false,
  previewMaxHeight,
  showHeader = false,
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

  // Follows whichever attachment holds the doc: this session, then the drain after Done.
  const docState = useRealtimeDocState(realtimeActive ? docName : null);
  const saveState = useDocSaveState(realtimeActive && !readonly ? docName : null);
  const device = useDeviceRecoveryState(realtimeActive ? docName : null);
  const strandedSync = usePendingDocSync(realtimeContentType, realtimeActive ? contentId : null);
  const transportDown = status === "disconnected" || status === "offline";
  // Unaccepted edits only reach the server through this attached doc, so Done holds the session
  // for them, and for accepted ones this device has not stored. Other accepted edits wait for
  // their checkpoint in the drain; a parent unmount still falls back to IDB.
  const releasable = canReleaseSession(status, docState, device);
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

  const handleOpen = useCallback(() => {
    if (readonly) return;
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

    // Defer editor mount so the overlay can animate in first.
    openTimerRef.current = setTimeout(() => {
      setEditorReady(true);
    }, 50);
  }, [readonly, value]);

  const handleClose = useCallback(() => {
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
    onDone?.(markdown, {
      realtimeOwned: realtimeActive && realtimeOwned,
      baseContent: draftInitial,
    });
  }, [
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
  const afterDoneChip = !isExpanded && (docState.checkpointPending || strandedSync) && (
    <RealtimeStatusBadge
      status={waitingForNetwork ? "offline" : sessionOpen ? status : "idle"}
      save={docState.checkpointPending ? saveState : "syncing"}
      storage={device.storage}
    />
  );

  const connectingPreview = (
    <div className="h-full overflow-y-auto p-6">
      <RealtimeConnectionNotice
        key={editorKey}
        waiting
        status={status}
        onEditWithoutLive={
          !readonly &&
          !realtimeOwned &&
          !replacedNotice &&
          !docState.checkpointPending &&
          !strandedSync
            ? () => setEditWithoutLive(true)
            : undefined
        }
      />
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
  // After a generation change the open-time text is stale; the new session lands in a moment,
  // so the gap stays blank rather than flashing old content under "Connecting...".
  const waitingBody = replacedNotice ? (
    <RealtimeConnectionNotice key={editorKey} waiting status={status} />
  ) : (
    connectingPreview
  );

  return (
    <>
      {showHeader && (
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {label}
          </h3>
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
          </div>
        </div>
      )}
      {/* Collapsed preview - clickable area with rendered content */}
      {fullPreview ? (
        <div className="relative group">
          {hasContent ? (
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
          )}

          {/* Edit button - floats at top-right only when the host did not opt into showHeader; otherwise the header renders it next to the label so it never sits over the preview scrollbar */}
          {!showHeader && (
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
          )}
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

      {/* Expanded overlay */}
      {isExpanded &&
        createPortal(
          <div className="fixed inset-0 z-[200] flex items-center justify-center">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

            {/* Editor panel */}
            <EditorHandleContext.Provider value={editorHandle}>
              <div
                className={cn(
                  dialogShellClass,
                  "relative w-full max-w-5xl mx-4 rounded-xl flex flex-col h-[85vh]",
                )}
              >
                <div className="shrink-0 rounded-t-xl overflow-hidden">
                  <EditorFormattingToolbar
                    contentType={contentType}
                    contentId={contentId}
                    enableUpload={enableUpload}
                    onFileUploaded={onFileUploaded}
                    trailing={
                      <>
                        {replacedNotice && (
                          <span className="text-xs text-muted-foreground" role="status">
                            {replacedNotice === "draft"
                              ? `This ${label.toLowerCase()} was changed elsewhere. Your unsaved text is under Recovered draft.`
                              : `This ${label.toLowerCase()} was changed elsewhere.`}
                          </span>
                        )}
                        {editWithoutLive && (
                          <span className="text-xs text-muted-foreground">
                            Live updates unavailable. Done saves changes.
                          </span>
                        )}
                        <RealtimeSessionStatus
                          status={status}
                          awareness={binding?.awareness ?? null}
                          docName={docName}
                          readOnly={readonly}
                          whenSynced={binding?.whenSynced}
                        />
                        <Button type="button" size="md" onClick={handleClose}>
                          <Check size={14} weight="bold" />
                          Done
                        </Button>
                      </>
                    }
                  />
                </div>

                {/* Editor body - let CrepeEditor's own wrapper handle scrolling */}
                <div className="flex-1 min-h-0 relative">
                  {editorReady && (!realtimeActive || (binding && realtimeOwned)) ? (
                    <>
                      <div
                        className={cn(
                          "h-full",
                          realtimeActive && !seeded && "invisible absolute inset-0",
                        )}
                      >
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
                          className="pt-6"
                        />
                      </div>
                      {realtimeActive && !seeded && waitingBody}
                    </>
                  ) : realtimeActive ? (
                    waitingBody
                  ) : (
                    <div className="flex items-center justify-center h-full">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                    </div>
                  )}
                </div>
              </div>
              {/* Pinned bar above covers selection formatting; the floating one stays reachable via context menu. */}
              <FloatingFormattingToolbar showOnSelection={false} />
            </EditorHandleContext.Provider>
          </div>,
          document.body,
        )}
    </>
  );
}
