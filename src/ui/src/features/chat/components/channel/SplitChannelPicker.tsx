import { useRef, useEffect, useCallback } from "react";
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const filterChannel = useCallback(
    (channel: ChatChannel) => channel.id !== currentChannelId,
    [currentChannelId],
  );

  return (
    <div
      ref={containerRef}
      className="absolute top-full right-0 mt-1 w-64 bg-card border border-border rounded-lg shadow-xl z-50 py-1 max-h-80 overflow-hidden flex flex-col"
    >
      <ChannelSelectList onSelect={onSelect} filterChannel={filterChannel} autoFocus />
    </div>
  );
}
