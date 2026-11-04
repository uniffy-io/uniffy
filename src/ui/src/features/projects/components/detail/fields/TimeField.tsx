import { useRef, useState } from "react";
import { Clock } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Input } from "@/components/ui/input";
import { formatMinutes, parseTimeInput } from "@/features/projects/utils/timeFormatting";

interface TimeFieldProps {
  label: string;
  minutes: number | null;
  onSave: (minutes: number | null) => void;
  disabled?: boolean;
  triggerClassName?: string;
  /** Value only, for a pill row that labels it elsewhere. */
  compact?: boolean;
}

export function TimeField({
  label,
  minutes,
  onSave,
  disabled,
  compact,
  triggerClassName,
}: TimeFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleStartEdit = () => {
    if (disabled) return;
    setInputValue(minutes ? formatMinutes(minutes) : "");
    setIsEditing(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSave = () => {
    setIsEditing(false);
    const parsed = parseTimeInput(inputValue);
    if (parsed !== null || inputValue.trim() === "") {
      onSave(parsed);
    }
  };

  return (
    <div className="flex items-center gap-3">
      {!compact && (
        <span className="text-sm text-muted-foreground w-20 flex items-center gap-1.5">
          <Clock size={12} />
          {label}
        </span>
      )}
      {isEditing ? (
        <Input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") setIsEditing(false);
          }}
          placeholder="e.g. 2h 30m"
          className={cn("h-6 w-24 px-2 text-xs", triggerClassName)}
        />
      ) : (
        <button
          type="button"
          onClick={handleStartEdit}
          disabled={disabled}
          aria-label={compact ? label : undefined}
          className={cn(
            "text-xs text-foreground hover:text-primary transition-colors disabled:cursor-not-allowed disabled:hover:text-foreground",
            triggerClassName,
          )}
        >
          {minutes ? formatMinutes(minutes) : "Not set"}
        </button>
      )}
    </div>
  );
}
