// Inline-only markup so the card stays HTML-valid as a descendant of `<p>`.
import { useState, useCallback } from "react";
import { Clock, ArrowSquareOut, CopySimple, Check, Phone } from "@phosphor-icons/react";
import { formatRelativeTime, formatSmartDateTime } from "@/shared/utils/dateFormatting";
import { cn } from "@/shared/utils/cn";
import { MENTION_ACCENT } from "@/components/mention/mentionConstants";
import { MetaSeparator } from "@/components/mention/previews/ParentBadge";
import type { MentionLiveState } from "@/components/mention/types";

const theme = MENTION_ACCENT;

interface CallMentionPreviewProps {
  urn: string;
  title: string;
  liveState: MentionLiveState;
  onClose?: () => void;
  onCopyLink?: () => void;
}

export function CallMentionPreview({ urn, title, liveState, onCopyLink }: CallMentionPreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(urn);
    setCopied(true);
    onCopyLink?.();
    setTimeout(() => setCopied(false), 2000);
  }, [urn, onCopyLink]);

  const ended = !!liveState.callEndedAt;
  const activity = liveState.callEndedAt ?? liveState.callStartedAt;

  return (
    <>
      <span className="block relative px-4 pr-10 pt-3 pb-2 pl-5">
        <span className="flex items-center gap-2.5">
          <span
            className={cn(
              "grid place-items-center shrink-0 w-7 h-7 rounded-md border",
              theme.border,
              theme.badgeBg,
              theme.accentText,
            )}
          >
            <Phone size={16} weight="duotone" />
          </span>
          <span className="block flex-1 min-w-0">
            <span className="block font-semibold text-sm truncate">{title}</span>
            <span className="flex items-center gap-1.5 flex-wrap">
              <span className={cn("text-[10px] font-medium", theme.accentText)}>
                {ended ? "Ended call" : "Live call"}
              </span>
              {liveState.callStartedAt && (
                <>
                  <MetaSeparator />
                  <span className="text-[10px] text-muted-foreground">
                    {formatSmartDateTime(liveState.callStartedAt)}
                  </span>
                </>
              )}
            </span>
          </span>
        </span>
      </span>

      <span className="flex px-4 py-1.5 pl-5 bg-background/60 items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock size={12} weight="duotone" />
          <span>{formatRelativeTime(activity) || "No date"}</span>
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
              <Check size={11} weight="bold" className="text-green-500" />
            ) : (
              <CopySimple size={11} weight="bold" />
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
