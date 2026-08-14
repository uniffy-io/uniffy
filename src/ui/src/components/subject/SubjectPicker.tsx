import { useState, useRef, useEffect, useCallback, type RefObject } from "react";
import { createPortal } from "react-dom";
import { MagnifyingGlass, Check, LockSimple } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import {
  SUBJECT_TYPE,
  type Subject,
  type SubjectPickerMode,
  type SubjectTypeFilter,
} from "@/components/subject/types";
import { SubjectAvatar } from "@/components/subject/SubjectAvatar";
import { partitionSubjects } from "@/components/subject/utils";
import { useSubjectSearch } from "@/components/subject/hooks/useSubjectSearch";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";

interface SubjectPickerProps {
  mode: SubjectPickerMode;
  subjectTypes?: SubjectTypeFilter;
  value: string[];
  onChange: (ids: string[], subjects: Subject[]) => void;
  excludeIds?: string[];
  /** Render as a portal anchored to anchorRef. */
  portal?: boolean;
  anchorRef?: RefObject<HTMLElement | null>;
  onClose?: () => void;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  dropdownWidth?: number;
}

export function SubjectPicker({
  mode,
  subjectTypes = "all",
  value,
  onChange,
  excludeIds = [],
  portal = false,
  anchorRef,
  onClose,
  placeholder,
  disabled = false,
  autoFocus = false,
  dropdownWidth = 240,
}: SubjectPickerProps) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { results, loading, search } = useSubjectSearch({
    subjectTypes,
    excludeIds,
  });

  const { subjects: resolvedSelected } = useSubjectResolver(value);

  const selectedSubjectsRef = useRef<Map<string, Subject>>(new Map());

  useEffect(() => {
    search(query);
  }, [query, search]);

  useEffect(() => {
    if (!portal || !anchorRef?.current) return;

    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) {
        setPosition({
          top: rect.bottom + 4,
          left: rect.right - dropdownWidth,
        });
      }
    };

    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [portal, anchorRef, dropdownWidth]);

  useEffect(() => {
    if (autoFocus || portal) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [autoFocus, portal, position]);

  useEffect(() => {
    if (!onClose) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  useEffect(() => {
    if (!onClose) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleSelect = useCallback(
    (subject: Subject) => {
      if (mode === "single") {
        // Single mode callers handle add/remove toggle themselves.
        onChange([subject.id], [subject]);
        setQuery("");
        return;
      }

      const isSelected = value.includes(subject.id);
      let nextIds: string[];
      if (isSelected) {
        nextIds = value.filter((id) => id !== subject.id);
        selectedSubjectsRef.current.delete(subject.id);
      } else {
        nextIds = [...value, subject.id];
        selectedSubjectsRef.current.set(subject.id, subject);
      }
      const nextSubjects = nextIds.map((id) => selectedSubjectsRef.current.get(id) || subject);
      onChange(nextIds, nextSubjects);
    },
    [mode, value, onChange],
  );

  const defaultPlaceholder =
    subjectTypes === "users"
      ? "Search members..."
      : subjectTypes === "groups"
        ? "Search groups..."
        : "Search people, teams or groups...";

  const renderResultRow = (subject: Subject) => {
    const isSelected = value.includes(subject.id);
    const badgeLabel =
      subject.type === SUBJECT_TYPE.USER ? "User" : subject.kind === "team" ? "Team" : "Group";
    return (
      <button
        key={subject.id}
        type="button"
        onClick={() => handleSelect(subject)}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors",
          isSelected ? "bg-primary/10" : "hover:bg-muted",
        )}
      >
        <SubjectAvatar subject={subject} size="sm" showPresence />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 text-foreground truncate">
            <span className="truncate">{subject.name}</span>
            {subject.isPrivate && (
              <span title="Private" className="shrink-0 inline-flex text-muted-foreground">
                <LockSimple size={11} />
              </span>
            )}
          </div>
          {subject.type === SUBJECT_TYPE.USER && subject.email && (
            <div className="text-xs text-muted-foreground truncate">{subject.email}</div>
          )}
          {subject.type === SUBJECT_TYPE.GROUP &&
            subject.memberCount != null &&
            subject.memberCount > 0 && (
              <div className="text-xs text-muted-foreground">
                {subject.memberCount} member{subject.memberCount !== 1 ? "s" : ""}
              </div>
            )}
        </div>
        {subjectTypes === "all" && (
          <span
            className={cn(
              "text-xs px-2 py-0.5 rounded-full shrink-0",
              badgeLabel === "Group"
                ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
                : "bg-primary/10 text-primary",
            )}
          >
            {badgeLabel}
          </span>
        )}
        {isSelected && <Check size={14} className="text-primary shrink-0" />}
      </button>
    );
  };

  const dropdownContent = (
    <div
      ref={dropdownRef}
      style={
        portal && position
          ? { position: "fixed", top: position.top, left: position.left, width: dropdownWidth }
          : undefined
      }
      className={cn(
        "rounded-lg border border-border bg-card shadow-xl",
        portal ? "z-200" : "absolute z-50 mt-1 w-full",
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-2 border-b border-border">
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md border border-border bg-background">
          <MagnifyingGlass size={14} className="text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder={placeholder || defaultPlaceholder}
            disabled={disabled}
            className="flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-muted-foreground"
          />
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto py-1">
        {loading && results.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">Searching...</div>
        ) : query.length >= 2 && results.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">No results found</div>
        ) : query.length < 2 && value.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">Type to search...</div>
        ) : query.length < 2 && value.length > 0 ? (
          resolvedSelected.map((subject) => {
            return (
              <button
                key={subject.id}
                type="button"
                onClick={() => handleSelect(subject)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors bg-primary/10"
              >
                <SubjectAvatar subject={subject} size="sm" showPresence />
                <div className="flex-1 min-w-0">
                  <div className="text-foreground truncate">{subject.name}</div>
                  {subject.type === SUBJECT_TYPE.USER && subject.email && (
                    <div className="text-xs text-muted-foreground truncate">{subject.email}</div>
                  )}
                  {subject.type === SUBJECT_TYPE.GROUP &&
                    subject.memberCount != null &&
                    subject.memberCount > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {subject.memberCount} member{subject.memberCount !== 1 ? "s" : ""}
                      </div>
                    )}
                </div>
                <Check size={14} className="text-primary shrink-0" />
              </button>
            );
          })
        ) : subjectTypes === "all" ? (
          partitionSubjects(results).map((section) => (
            <div key={section.label}>
              <div className="text-xs uppercase text-muted-foreground px-3 pt-2 pb-1">
                {section.label}
              </div>
              {section.subjects.map(renderResultRow)}
            </div>
          ))
        ) : (
          results.map(renderResultRow)
        )}
      </div>
    </div>
  );

  if (portal) {
    return <>{position && createPortal(dropdownContent, document.body)}</>;
  }

  return <div className="relative">{dropdownContent}</div>;
}
