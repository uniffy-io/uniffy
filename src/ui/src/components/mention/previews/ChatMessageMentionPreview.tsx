// Inline-only markup so the card stays HTML-valid as a descendant of `<p>`.
import { useState, useCallback } from "react";
import { Clock, ArrowSquareOut, CopySimple, Check, ChatTeardropText } from "@phosphor-icons/react";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { ParentBadge, MetaSeparator } from "@/components/mention/previews/ParentBadge";
import { getInitials } from "@/components/subject/utils";
import type { MentionLiveState } from "@/components/mention/types";

interface ChatMessageMentionPreviewProps {
  urn: string;
  title: string;
  description?: string;
  liveState: MentionLiveState;
  onClose: () => void;
  onCopyLink: () => void;
}

export function ChatMessageMentionPreview({
  urn,
  liveState,
  description,
  onCopyLink,
}: ChatMessageMentionPreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(urn);
    setCopied(true);
    onCopyLink();
    setTimeout(() => setCopied(false), 2000);
  }, [urn, onCopyLink]);

  const senderName = liveState.chatSenderName || "Unknown";
  const initials = getInitials(senderName);

  return (
    <>
      {/* Header: avatar (initials) + sender name + parent channel + timestamp */}
      <span className="block relative px-4 pr-10 pt-3 pb-1.5 pl-5">
        <span className="flex items-start gap-3">
          <span
            className="grid place-items-center shrink-0 w-8 h-8 rounded-full text-[10px] font-semibold border border-violet-500/40 bg-violet-500/10 text-violet-600 dark:text-violet-300"
            aria-hidden
          >
            {initials || <ChatTeardropText size={14} weight="duotone" />}
          </span>
          <span className="block flex-1 min-w-0 pt-0.5">
            <span className="block font-semibold text-sm truncate">{senderName}</span>
            <span className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {liveState.parentLabel && (
                <>
                  <ParentBadge label={liveState.parentLabel} />
                  <MetaSeparator />
                </>
              )}
              <span className="text-xs font-medium text-violet-600 dark:text-violet-400">
                Message
              </span>
            </span>
          </span>
        </span>
      </span>

      {/* Message body snippet */}
      {description && (
        <span className="block px-4 pb-2.5 pl-[3.625rem]">
          <span className="block text-xs text-muted-foreground leading-relaxed line-clamp-4 whitespace-pre-wrap break-words">
            {description}
          </span>
        </span>
      )}

      {/* Footer */}
      <span className="flex px-4 py-2 pl-5 bg-muted/30 border-t border-border/50 items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock size={12} weight="duotone" />
          <span>{formatRelativeTime(liveState.updatedAt) || "No date"}</span>
        </span>
        <span className="flex items-center gap-1">
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleCopy();
            }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            className="p-1 rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title="Copy URN"
          >
            {copied ? (
              <Check size={12} weight="bold" className="text-green-500" />
            ) : (
              <CopySimple size={12} weight="bold" />
            )}
          </button>
          <span className="flex items-center gap-1 text-xs text-muted-foreground/70">
            <ArrowSquareOut size={11} weight="bold" />
            <span>Open</span>
          </span>
        </span>
      </span>
    </>
  );
}
