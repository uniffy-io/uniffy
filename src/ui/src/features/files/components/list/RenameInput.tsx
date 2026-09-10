import { useState, useRef, useEffect } from "react";
import { Check, X } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { cn } from "@/shared/utils/cn";

const MAX_NAME_LENGTH = 255;

interface RenameInputProps {
  /** Initial name value */
  initialValue: string;
  /** Read-only tail kept out of the editable text, e.g. a file's extension. */
  lockedSuffix?: string;
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
  lockedSuffix = "",
  onConfirm,
  onCancel,
  className,
  variant = "grid",
}: RenameInputProps) {
  const suffix = lockedSuffix && initialValue.endsWith(lockedSuffix) ? lockedSuffix : "";
  const editableInitial = initialValue.slice(0, initialValue.length - suffix.length);
  const [value, setValue] = useState(editableInitial);
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
    if (trimmed && trimmed !== editableInitial) {
      onConfirm(trimmed + suffix);
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

  const maxLength = MAX_NAME_LENGTH - suffix.length;

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
          maxLength={maxLength}
          className="h-8 flex-1 min-w-0 px-2 py-1"
        />
        {suffix && <span className="shrink-0 text-sm text-subtle-foreground">{suffix}</span>}
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
        maxLength={maxLength}
        className="h-7 min-w-0 px-1.5 py-0.5"
      />
      {suffix && <span className="shrink-0 text-xs text-subtle-foreground">{suffix}</span>}
    </div>
  );
}
