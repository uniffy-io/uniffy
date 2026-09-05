import { useState } from "react";
import { cn } from "@/shared/utils/cn";

interface InlineTextEditProps {
  value: string;
  onSave: (next: string) => void;
  canEdit: boolean;
  allowEmpty?: boolean;
  placeholder?: string;
  className?: string;
  testId?: string;
  startEditing?: boolean;
}

/** Click-to-edit text that commits on blur or Enter and restores on Escape. */
export function InlineTextEdit({
  value,
  onSave,
  canEdit,
  allowEmpty = false,
  placeholder,
  className,
  testId,
  startEditing = false,
}: InlineTextEditProps) {
  const [editing, setEditing] = useState(startEditing);
  const [text, setText] = useState(value);

  if (editing) {
    const commit = () => {
      setEditing(false);
      const next = text.trim();
      if (!next && !allowEmpty) return;
      if (next !== value) onSave(next);
    };
    return (
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setText(value);
            setEditing(false);
          }
        }}
        placeholder={placeholder}
        data-testid={testId}
        className={cn(
          "w-full bg-transparent border-b border-primary/50 focus:outline-none",
          className,
        )}
      />
    );
  }

  if (!canEdit) {
    return (
      <span
        className={cn("block", className, !value && "text-subtle-foreground italic")}
        data-testid={testId}
      >
        {value || placeholder}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setText(value);
        setEditing(true);
      }}
      title="Click to edit"
      data-testid={testId}
      className={cn(
        "block w-full text-left rounded px-1 -mx-1 cursor-text hover:bg-muted/60 transition-colors",
        className,
        !value && "text-subtle-foreground italic",
      )}
    >
      {value || placeholder}
    </button>
  );
}
