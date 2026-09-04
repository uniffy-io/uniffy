import { useState, useEffect, useRef } from "react";
import { PencilSimple } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { cn } from "@/shared/utils/cn";

interface InlineTextFieldProps {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  /** Blocks committing an empty value, for fields like title that must stay set. */
  required?: boolean;
  type?: "text" | "url";
  className?: string;
  /** Classes for the rendered text itself (size, weight, strike-through). */
  textClassName?: string;
  inputClassName?: string;
}

/** Click-to-edit text. Commits on blur or Enter, reverts on Escape. */
export function InlineTextField({
  value,
  onCommit,
  placeholder = "Not set",
  readOnly = false,
  required = false,
  type = "text",
  className,
  textClassName,
  inputClassName,
}: InlineTextFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      // Resync the draft when the value changes externally, but never mid-edit.
      // eslint-disable-next-line react/react-compiler
      setDraft(value);
    }
  }, [value, isEditing]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleCommit = () => {
    const trimmed = draft.trim();
    if (required && !trimmed) {
      setDraft(value);
    } else if (trimmed !== value.trim()) {
      onCommit(trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleCommit();
    } else if (e.key === "Escape") {
      e.stopPropagation();
      setDraft(value);
      setIsEditing(false);
    }
  };

  if (isEditing && !readOnly) {
    return (
      <Input
        ref={inputRef}
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleCommit}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn("rounded-lg", inputClassName)}
      />
    );
  }

  if (readOnly) {
    return (
      <span
        className={cn(
          "text-sm",
          value ? "text-foreground" : "text-muted-foreground italic",
          textClassName,
          className,
        )}
      >
        {value || placeholder}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setIsEditing(true)}
      className={cn(
        "group flex items-center gap-2 w-full text-left rounded px-2 py-1 -mx-2 hover:bg-muted/50 transition-colors",
        className,
      )}
    >
      <span
        className={cn(
          "text-sm flex-1 truncate",
          value ? "text-foreground" : "text-muted-foreground italic",
          textClassName,
        )}
      >
        {value || placeholder}
      </span>
      <PencilSimple
        size={12}
        className="text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 transition-opacity"
      />
    </button>
  );
}
