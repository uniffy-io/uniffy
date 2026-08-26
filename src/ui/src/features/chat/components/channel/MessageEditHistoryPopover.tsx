import { useEffect, useRef, useState } from "react";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { chatApi } from "@/features/chat/api/chatApi";
import { MessageContent } from "@/features/chat/components/channel/MessageContent";
import { formatMessageTimestamp } from "@/features/chat/utils/messageTime";
import { friendlyErrorMessage } from "@/config";
import { cn } from "@/shared/utils/cn";

interface RevisionRow {
  revisionNo: number;
  content: string;
  editedAt: string;
}

interface MessageEditHistoryPopoverProps {
  organizationId: string;
  channelId: string;
  messageId: string;
  currentContent: string;
  editedAt: string;
  onClose: () => void;
}

export function MessageEditHistoryPopover({
  organizationId,
  channelId,
  messageId,
  currentContent,
  editedAt,
  onClose,
}: MessageEditHistoryPopoverProps) {
  const [revisions, setRevisions] = useState<RevisionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    chatApi
      .getMessageRevisions({ organizationId, channelId, messageId })
      .then((response) => {
        if (cancelled) return;
        setRevisions(
          response.revisions
            .map((r) => ({
              revisionNo: r.revisionNo,
              content: r.content,
              editedAt: r.editedAt ? timestampDate(r.editedAt).toISOString() : "",
            }))
            .reverse(),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(
          friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
            "Could not load edit history",
        );
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, channelId, messageId]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEsc);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [onClose]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute left-0 top-full mt-1 z-[60] w-96 max-w-[calc(100vw-4rem)]",
        "bg-card border border-border rounded-lg shadow-lg",
      )}
      data-testid={`chat-message-edit-history-${messageId}`}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border text-sm font-semibold text-foreground">
        <ClockCounterClockwise size={14} />
        Edit history
      </div>
      <div className="max-h-80 overflow-y-auto py-1">
        {error && <div className="px-3 py-2 text-xs text-muted-foreground">{error}</div>}
        {!error && revisions === null && (
          <div className="px-3 py-2 text-xs text-muted-foreground">Loading...</div>
        )}
        {!error && revisions !== null && (
          <>
            <div className="px-3 py-2">
              <div className="text-[11px] text-muted-foreground mb-0.5">
                Current, edited {formatMessageTimestamp(editedAt)}
              </div>
              <MessageContent content={currentContent} className="!text-sm" />
            </div>
            {revisions.map((revision) => (
              <div
                key={revision.revisionNo}
                className="px-3 py-2 border-t border-border/60"
                data-testid={`chat-message-revision-${messageId}-${revision.revisionNo}`}
              >
                <div className="text-[11px] text-muted-foreground mb-0.5">
                  {revision.revisionNo === 1 ? "Original" : "Revision"}, until{" "}
                  {formatMessageTimestamp(revision.editedAt)}
                </div>
                <MessageContent content={revision.content} className="!text-sm opacity-80" />
              </div>
            ))}
            {revisions.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground border-t border-border/60">
                No earlier versions recorded.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
