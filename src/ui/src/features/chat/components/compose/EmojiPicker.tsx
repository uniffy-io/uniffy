import { useRef, useEffect, useCallback, useState } from "react";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import { createPortal } from "react-dom";
import { SafeEmojiPicker } from "@/components/emoji/SafeEmojiPicker";
import { popoverShellClass } from "@/components/ui/popover";
import { cn } from "@/shared/utils/cn";
import { useTheme } from "@/config/theme/themeContext";

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement | null>;
}

export function EmojiPicker({ onSelect, onClose, anchorRef }: EmojiPickerProps) {
  const { resolvedTheme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const anchor = anchorRef?.current;
    if (!anchor) {
      setPosition({ top: window.innerHeight / 2 - 200, left: window.innerWidth / 2 - 176 });
      return;
    }

    const rect = anchor.getBoundingClientRect();
    const pickerHeight = 435;
    const pickerWidth = 352;

    // Prefer above, flip below if not enough room.
    let top = rect.top - pickerHeight - 8;
    let left = rect.left;

    if (top < 8) {
      top = rect.bottom + 8;
    }
    top = Math.max(8, Math.min(top, window.innerHeight - pickerHeight - 8));

    if (left + pickerWidth > window.innerWidth - 8) {
      left = window.innerWidth - pickerWidth - 8;
    }

    if (left < 8) {
      left = 8;
    }

    setPosition({ top, left });
  }, [anchorRef]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onClose]);

  useOverlayEscape(onClose);

  const handleEmojiSelect = useCallback(
    (emoji: { native: string }) => {
      onSelect(emoji.native);
      onClose();
    },
    [onSelect, onClose],
  );

  if (!position) return null;

  return createPortal(
    <div
      ref={containerRef}
      className="fixed z-[1000] max-h-[calc(100dvh-1rem)] overflow-y-auto"
      style={{ top: position.top, left: position.left }}
      data-testid="chat-emoji-picker"
    >
      <div className={cn(popoverShellClass, "rounded-xl overflow-hidden")}>
        <SafeEmojiPicker
          onEmojiSelect={handleEmojiSelect}
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          previewPosition="none"
          skinTonePosition="search"
          perLine={8}
          maxFrequentRows={2}
          navPosition="bottom"
        />
      </div>
    </div>,
    document.body,
  );
}
