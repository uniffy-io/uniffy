import type { ReactNode } from "react";
import { MagnifyingGlass, UserPlus, X } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { SubjectAvatar } from "@/components/subject/SubjectAvatar";
import { SUBJECT_TYPE, type Subject } from "@/components/subject/types";

interface SubjectSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Flat search row for surfaces that list results inline. `SubjectPicker` is a
 * floating dropdown and renders a box inside a box when placed in a form.
 */
export function SubjectSearchInput({
  value,
  onChange,
  placeholder = "Search people by name or email...",
  disabled = false,
  className,
}: SubjectSearchInputProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2",
        "focus-within:ring-2 focus-within:ring-primary",
        disabled && "opacity-50",
        className,
      )}
    >
      <MagnifyingGlass size={16} className="shrink-0 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Clear search"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

interface SubjectSearchResultsProps {
  results: Subject[];
  loading: boolean;
  query: string;
  onSelect: (subject: Subject) => void;
  actionLabel?: string;
  busyId?: string | null;
  emptyLabel?: ReactNode;
  className?: string;
}

export function SubjectSearchResults({
  results,
  loading,
  query,
  onSelect,
  actionLabel = "Add",
  busyId = null,
  emptyLabel,
  className,
}: SubjectSearchResultsProps) {
  if (loading && results.length === 0) {
    return (
      <div className={cn("py-8 text-center", className)}>
        <div className="mx-auto mb-2 h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Searching...</p>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className={cn("py-8 text-center", className)}>
        <p className="text-sm text-muted-foreground">
          {emptyLabel ?? <>No one found for &ldquo;{query}&rdquo;</>}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-1", className)}>
      {results.map((subject) => (
        <button
          key={subject.id}
          type="button"
          onClick={() => onSelect(subject)}
          disabled={busyId !== null}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors
                        hover:bg-muted/50 disabled:opacity-50"
        >
          <SubjectAvatar subject={subject} size="md" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{subject.name}</p>
            {subject.type === SUBJECT_TYPE.USER && subject.email && (
              <p className="truncate text-xs text-muted-foreground">{subject.email}</p>
            )}
            {subject.type === SUBJECT_TYPE.GROUP && subject.memberCount != null && (
              <p className="text-xs text-muted-foreground">
                {subject.memberCount} member{subject.memberCount !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          {busyId === subject.id ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          ) : (
            <span className="flex items-center gap-1 text-xs font-medium text-primary">
              <UserPlus size={14} />
              {actionLabel}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
