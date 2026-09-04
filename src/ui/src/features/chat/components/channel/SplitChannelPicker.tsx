import { useRef, useEffect, useCallback } from "react";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { popoverShellClass } from "@/components/ui/popover";
import { cn } from "@/shared/utils/cn";
import { ChannelSelectList } from "@/features/chat/components/channel/ChannelSelectList";
import type { ChatChannel } from "@/features/chat/types";

interface SplitChannelPickerProps {
  onSelect: (channelId: string) => void;
  onClose: () => void;
  currentChannelId: string;
}

export function SplitChannelPicker({
  onSelect,
  onClose,
  currentChannelId,
}: SplitChannelPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Defer registration so the opening click doesn't immediately close the picker.
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [onClose]);

  useOverlayEscape(onClose);

  const filterChannel = useCallback(
    (channel: ChatChannel) => channel.id !== currentChannelId,
    [currentChannelId],
  );

  return (
    <div
      ref={containerRef}
      className={cn(
        popoverShellClass,
        "absolute top-full right-0 mt-1 w-64 z-50 py-1 max-h-80 overflow-hidden flex flex-col",
      )}
    >
      <ChannelSelectList onSelect={onSelect} filterChannel={filterChannel} autoFocus />
    </div>
  );
}
