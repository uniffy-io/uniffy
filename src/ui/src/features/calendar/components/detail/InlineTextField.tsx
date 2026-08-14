import { useState, useEffect, useRef } from "react";
import { PencilSimple } from "@phosphor-icons/react";
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
  inputClassName,
}: InlineTextFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resync when the value changes externally
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
      <input
        ref={inputRef}
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleCommit}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn(
          "w-full px-3 py-2 text-sm border border-border rounded-lg bg-background text-foreground",
          "placeholder-muted-foreground transition-all",
          "focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary",
          inputClassName,
        )}
      />
    );
  }

  if (readOnly) {
    return (
      <span
        className={cn(
          "text-sm",
          value ? "text-foreground" : "text-muted-foreground italic",
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
