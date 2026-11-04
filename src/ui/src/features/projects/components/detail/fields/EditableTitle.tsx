import { useEffect, useRef, useState } from "react";
import { PencilSimple } from "@phosphor-icons/react";

export function EditableTitle({
  title,
  onSave,
  readOnly,
}: {
  title: string;
  onSave: (newTitle: string) => void;
  readOnly?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep local value in sync when title changes from outside
  useEffect(() => {
    if (!isEditing) {
      // Resync the draft when the title changes externally, but never mid-edit.
      // eslint-disable-next-line react/react-compiler
      setValue(title);
    }
  }, [title, isEditing]);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== title) {
      onSave(trimmed);
    } else {
      setValue(title);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleSave();
    } else if (e.key === "Escape") {
      setValue(title);
      setIsEditing(false);
    }
  };

  if (isEditing && !readOnly) {
    return (
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={handleKeyDown}
          className="flex-1 text-lg font-semibold bg-background border border-primary rounded px-2 py-1 outline-none text-foreground"
        />
      </div>
    );
  }

  if (readOnly) {
    return (
      <div className="px-2 py-1 -mx-2">
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
    );
  }

  return (
    <div
      className="group flex items-center gap-2 cursor-pointer rounded px-2 py-1 -mx-2 hover:bg-muted/50 transition-colors"
      onClick={() => setIsEditing(true)}
    >
      <h2 className="text-lg font-semibold text-foreground flex-1">{title}</h2>
      <PencilSimple
        size={14}
        className="text-muted-foreground opacity-0 group-hover:opacity-100 shrink-0 transition-opacity"
      />
    </div>
  );
}
