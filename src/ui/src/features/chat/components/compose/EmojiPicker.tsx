import { useRef, useEffect, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import data from '@emoji-mart/data';
import Picker from '@emoji-mart/react';
import { useTheme } from '@/config/theme/ThemeProvider';

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
      // eslint-disable-next-line react-hooks/set-state-in-effect -- fallback position when no anchor ref is provided
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
      document.addEventListener('mousedown', handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  const handleEmojiSelect = useCallback((emoji: { native: string }) => {
    onSelect(emoji.native);
    onClose();
  }, [onSelect, onClose]);

  if (!position) return null;

  return createPortal(
    <div
      ref={containerRef}
      className="fixed z-[1000]"
      style={{ top: position.top, left: position.left }}
      data-testid="chat-emoji-picker"
    >
      <div className="rounded-xl border border-border bg-card shadow-xl overflow-hidden">
        <Picker
          data={data}
          onEmojiSelect={handleEmojiSelect}
          theme={resolvedTheme === 'dark' ? 'dark' : 'light'}
          previewPosition="none"
          skinTonePosition="search"
          perLine={8}
          maxFrequentRows={2}
          navPosition="bottom"
          set="native"
        />
      </div>
    </div>,
    document.body,
  );
}
