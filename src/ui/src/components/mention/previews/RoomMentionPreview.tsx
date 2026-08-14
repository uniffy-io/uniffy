// Inline-only markup so the card stays HTML-valid as a descendant of `<p>`.
import { useState, useCallback } from "react";
import { Clock, ArrowSquareOut, CopySimple, Check, Door } from "@phosphor-icons/react";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { cn } from "@/shared/utils/cn";
import { UrnType } from "@/shared/utils/urn";
import { getUrnTypeTheme } from "@/config/theme/urnColors";
import { MetaSeparator } from "@/components/mention/previews/ParentBadge";
import { ROOM_TYPE_LABELS } from "@/features/rooms/types/room";
import type { RoomType } from "@/features/rooms/types/room";
import type { MentionLiveState } from "@/components/mention/types";

const theme = getUrnTypeTheme(UrnType.ROOM);

interface RoomMentionPreviewProps {
  urn: string;
  title: string;
  description?: string;
  liveState: MentionLiveState;
  onClose: () => void;
  onCopyLink: () => void;
}

/** Index metadata carries the backend enum value ("MEETING_ROOM"). */
function roomTypeLabel(value?: string): string {
  if (!value) return "Room";
  return ROOM_TYPE_LABELS[value.toLowerCase() as RoomType] ?? "Room";
}

export function RoomMentionPreview({
  urn,
  title,
  description,
  liveState,
  onCopyLink,
}: RoomMentionPreviewProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(urn);
    setCopied(true);
    onCopyLink();
    setTimeout(() => setCopied(false), 2000);
  }, [urn, onCopyLink]);

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
            <Door size={16} weight="duotone" />
          </span>
          <span className="block flex-1 min-w-0">
            <span className="block font-semibold text-sm truncate">{title}</span>
            <span className="flex items-center gap-1.5 flex-wrap">
              <span className={cn("text-[10px] font-medium", theme.accentText)}>
                {roomTypeLabel(liveState.roomType)}
              </span>
              {(liveState.roomCapacity ?? 0) > 0 && (
                <>
                  <MetaSeparator />
                  <span className="text-[10px] text-muted-foreground">
                    {liveState.roomCapacity} seat{liveState.roomCapacity === 1 ? "" : "s"}
                  </span>
                </>
              )}
              {liveState.roomBuilding && (
                <>
                  <MetaSeparator />
                  <span className="text-[10px] text-muted-foreground truncate">
                    {liveState.roomBuilding}
                  </span>
                </>
              )}
              {liveState.roomFloor && (
                <>
                  <MetaSeparator />
                  <span className="text-[10px] text-muted-foreground">
                    Floor {liveState.roomFloor}
                  </span>
                </>
              )}
            </span>
          </span>
        </span>
      </span>

      {(liveState.roomAmenities || liveState.roomLocation || description) && (
        <span className="block px-4 pb-2 pl-[3.125rem]">
          {liveState.roomAmenities && (
            <span className="block text-xs text-muted-foreground truncate">
              {liveState.roomAmenities}
            </span>
          )}
          {liveState.roomLocation && (
            <span className="block text-xs text-muted-foreground/70 truncate">
              {liveState.roomLocation}
            </span>
          )}
          {!liveState.roomAmenities && !liveState.roomLocation && description && (
            <span className="block text-xs text-muted-foreground/70 leading-relaxed line-clamp-2">
              {description}
            </span>
          )}
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
