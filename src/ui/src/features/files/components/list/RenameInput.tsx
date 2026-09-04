import { useState, useRef, useEffect } from "react";
import { Check, X } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { cn } from "@/shared/utils/cn";

const MAX_NAME_LENGTH = 255;

interface RenameInputProps {
  /** Initial name value */
  initialValue: string;
  /** Called when rename is confirmed */
  onConfirm: (newName: string) => void;
  /** Called when rename is cancelled */
  onCancel: () => void;
  /** Optional className for styling */
  className?: string;
  /** Whether to show as inline in grid or list view */
  variant?: "grid" | "list";
}

export function RenameInput({
  initialValue,
  onConfirm,
  onCancel,
  className,
  variant = "grid",
}: RenameInputProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus and select text on mount
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const handleConfirm = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== initialValue) {
      onConfirm(trimmed);
    } else {
      onCancel();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleConfirm();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  if (variant === "list") {
    return (
      <div className={cn("flex items-center gap-2 flex-1 min-w-0", className)}>
        <Input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleConfirm}
          maxLength={MAX_NAME_LENGTH}
          className="h-8 flex-1 min-w-0 px-2 py-1"
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleConfirm();
          }}
          className="p-1 rounded hover:bg-muted"
          title="Confirm"
          type="button"
          onMouseDown={(e) => e.preventDefault()} // Prevent blur
        >
          <Check size={16} style={{ color: "var(--status-success)" }} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          className="p-1 rounded hover:bg-muted"
          title="Cancel"
          type="button"
          onMouseDown={(e) => e.preventDefault()} // Prevent blur
        >
          <X size={16} className="text-destructive" />
        </button>
      </div>
    );
  }

  // Grid variant - constrained to card width
  return (
    <div className={cn("flex items-center gap-1 min-w-0", className)}>
      <Input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleConfirm}
        onClick={(e) => e.stopPropagation()}
        maxLength={MAX_NAME_LENGTH}
        className="h-7 min-w-0 px-1.5 py-0.5"
      />
    </div>
  );
}
