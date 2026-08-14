// Inline-only markup so the card stays HTML-valid as a descendant of `<p>`.
import { useState, useCallback } from "react";
import { Clock, ArrowSquareOut, CopySimple, Check, Folder } from "@phosphor-icons/react";
import { formatRelativeTime, formatFileSize } from "@/shared/utils/dateFormatting";
import { cn } from "@/shared/utils/cn";
import { UrnType } from "@/shared/utils/urn";
import { getUrnTypeTheme } from "@/config/theme/urnColors";
import { ParentBadge, MetaSeparator } from "@/components/mention/previews/ParentBadge";
import type { MentionLiveState } from "@/components/mention/types";

const theme = getUrnTypeTheme(UrnType.FOLDER);

interface FolderMentionPreviewProps {
  urn: string;
  title: string;
  liveState: MentionLiveState;
  onClose: () => void;
  onCopyLink: () => void;
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export function FolderMentionPreview({
  urn,
  title,
  liveState,
  onCopyLink,
}: FolderMentionPreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(urn);
    setCopied(true);
    onCopyLink();
    setTimeout(() => setCopied(false), 2000);
  }, [urn, onCopyLink]);

  const fileCount = liveState.folderFileCount ?? 0;
  const subfolderCount = liveState.folderSubfolderCount ?? 0;
  const totalSize = liveState.folderTotalSize ?? 0;
  const hasStats = liveState.folderFileCount != null;

  return (
    <>
      <span className="block relative px-4 pr-10 pt-3 pb-1 pl-5">
        <span className="flex items-center gap-2.5">
          <span
            className={cn(
              "grid place-items-center shrink-0 w-7 h-7 rounded-md border",
              theme.border,
              theme.badgeBg,
              theme.accentText,
            )}
          >
            <Folder size={16} weight="duotone" />
          </span>
          <span className="block flex-1 min-w-0">
            <span className="block font-semibold text-sm truncate">{title}</span>
            <span className="flex items-center gap-1.5 flex-wrap">
              {liveState.parentLabel && (
                <>
                  <ParentBadge label={liveState.parentLabel} />
                  <MetaSeparator />
                </>
              )}
              <span className={cn("text-[10px] font-medium", theme.accentText)}>Folder</span>
            </span>
          </span>
        </span>
      </span>

      {hasStats && (
        <span className="block px-4 pb-2 pl-[3.125rem]">
          <span className="block text-xs text-muted-foreground">
            {countLabel(fileCount, "file")}
            {" · "}
            {countLabel(subfolderCount, "folder")}
            {totalSize > 0 && (
              <>
                {" · "}
                {formatFileSize(totalSize)}
              </>
            )}
          </span>
        </span>
      )}

      <span className="flex px-4 py-1.5 pl-5 bg-muted/30 border-t border-border/50 items-center justify-between">
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
