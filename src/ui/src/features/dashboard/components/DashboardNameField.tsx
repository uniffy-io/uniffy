import { useState, type KeyboardEvent } from "react";
import { PencilSimple } from "@phosphor-icons/react";
import { Input } from "@/components/ui/input";
import { cn } from "@/shared/utils/cn";

export const MAX_DASHBOARD_NAME_LENGTH = 80;

interface DashboardNameFieldProps {
  value: string;
  onSave: (name: string) => void;
  /** Shown as the button label while there is no name. */
  emptyLabel: string;
  disabled?: boolean;
  className?: string;
  inputClassName?: string;
  testId: string;
}

/** A dashboard name that edits in place: Enter or leaving the field saves, Escape cancels. */
export function DashboardNameField({
  value,
  onSave,
  emptyLabel,
  disabled = false,
  className,
  inputClassName,
  testId,
}: DashboardNameFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const next = draft.split(/\s+/).filter(Boolean).join(" ");
    setDraft(null);
    if (next !== value) onSave(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(null);
    }
  };

  if (draft !== null) {
    return (
      <Input
        autoFocus
        value={draft}
        maxLength={MAX_DASHBOARD_NAME_LENGTH}
        placeholder="Dashboard name"
        aria-label="Dashboard name"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        className={cn("h-8 max-w-sm", inputClassName)}
        data-testid={`${testId}-input`}
      />
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setDraft(value)}
      title="Rename"
      className={cn(
        "focus-ring group -mx-1 flex min-h-11 max-w-full items-center gap-1.5 rounded-md px-1 text-left lg:min-h-0",
        "disabled:cursor-not-allowed",
        className,
      )}
      data-testid={testId}
    >
      <span className={cn("truncate", !value && "text-sm font-normal text-muted-foreground")}>
        {value || emptyLabel}
      </span>
      <PencilSimple
        size={14}
        className="shrink-0 text-subtle-foreground transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-visible:opacity-100"
        aria-hidden
      />
    </button>
  );
}
