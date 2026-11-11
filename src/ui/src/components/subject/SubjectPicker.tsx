import { useState, useRef, useEffect, useCallback, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { MagnifyingGlass, Check, LockSimple, User } from "@phosphor-icons/react";
import { useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { controlShellClass } from "@/components/ui/input";
import { popoverShellClass } from "@/components/ui/popover";
import { useOverlayEscape } from "@/shared/hooks/useOverlayEscape";
import {
  SUBJECT_TYPE,
  type Subject,
  type SubjectPickerMode,
  type SubjectTypeFilter,
} from "@/components/subject/types";
import { SubjectAvatar } from "@/components/subject/SubjectAvatar";
import { partitionSubjects } from "@/components/subject/utils";
import { buildPickerRows, filterPickerSections } from "@/components/subject/pickerRows";
import { useSubjectSearch } from "@/components/subject/hooks/useSubjectSearch";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";

/** A row that is not a subject, listed above the results (a filter's "Me" or "Unassigned"). */
export interface SubjectPickerPinnedOption {
  id: string;
  label: string;
  icon?: ReactNode;
  selected: boolean;
  onToggle: () => void;
  /** The person this row stands for, so they are not listed again below it. */
  subjectId?: string;
}

/** A titled group of non-person rows listed after the people (for example a task's agents). */
export interface SubjectPickerSection {
  id: string;
  label: string;
  rows: SubjectPickerSectionRow[];
}

export interface SubjectPickerSectionRow {
  id: string;
  /** Rendered with its avatar, and matched by name against the search text. */
  subject: Subject;
  badge?: string;
  selected: boolean;
  onToggle: () => void;
}

interface SubjectPickerProps {
  mode: SubjectPickerMode;
  subjectTypes?: SubjectTypeFilter;
  value: string[];
  knownSubjects?: Subject[];
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
  align?: "left" | "right";
  pinnedOptions?: SubjectPickerPinnedOption[];
  /** Offer the caller as a "Me" row; for pickers where choosing yourself is a normal choice. */
  showSelf?: boolean;
  sections?: SubjectPickerSection[];
}

export function SubjectPicker({
  mode,
  subjectTypes = "all",
  value,
  knownSubjects = [],
  onChange,
  excludeIds = [],
  portal = false,
  anchorRef,
  onClose,
  placeholder,
  disabled = false,
  autoFocus = false,
  dropdownWidth = 240,
  align = "right",
  pinnedOptions = [],
  showSelf = false,
  sections = [],
}: SubjectPickerProps) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { results, suggested, loading, search, recordPicks } = useSubjectSearch({
    subjectTypes,
    excludeIds,
  });

  const [pickedSubjects, setPickedSubjects] = useState<Subject[]>([]);
  const { subjects: resolvedSelected } = useSubjectResolver(value, [
    ...knownSubjects,
    ...pickedSubjects,
  ]);
  const currentUser = useAppSelector((s) => s.auth.user);

  useEffect(() => {
    search(query);
  }, [query, search]);

  useEffect(() => {
    if (!portal || !anchorRef?.current) return;

    const updatePosition = () => {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) {
        const width = Math.min(dropdownWidth, window.innerWidth - 16);
        const left = align === "left" ? rect.left : rect.right - width;
        setPosition({
          top: rect.bottom + 4,
          left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
          width,
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
  }, [portal, anchorRef, dropdownWidth, align]);

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
      if (e.key === "Enter") {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  useOverlayEscape(() => onClose?.(), !!onClose);

  const handleSelect = useCallback(
    (subject: Subject) => {
      if (mode === "single") {
        // Single mode callers handle add/remove toggle themselves.
        if (subject.type === SUBJECT_TYPE.USER && !value.includes(subject.id)) {
          recordPicks([subject.id]);
        }
        setPickedSubjects([subject]);
        onChange([subject.id], [subject]);
        setQuery("");
        return;
      }

      const isSelected = value.includes(subject.id);
      let nextIds: string[];
      if (isSelected) {
        nextIds = value.filter((id) => id !== subject.id);
      } else {
        nextIds = [...value, subject.id];
        if (subject.type === SUBJECT_TYPE.USER) recordPicks([subject.id]);
      }
      const known = new Map(
        [...resolvedSelected, ...results, subject].map((item) => [item.id, item]),
      );
      const nextSubjects = nextIds.flatMap((id) => known.get(id) ?? []);
      setPickedSubjects(nextSubjects);
      onChange(nextIds, nextSubjects);
    },
    [mode, value, onChange, recordPicks, resolvedSelected, results],
  );

  const {
    self: selfSubject,
    selectedRows,
    suggestions,
  } = buildPickerRows({
    currentUser:
      showSelf && currentUser
        ? { ...currentUser, avatarUrl: currentUser.avatarUrl || undefined }
        : null,
    subjectTypes,
    excludeIds,
    pinnedOptions,
    value,
    resolvedSelected,
    results,
    suggested,
  });
  const pinnedRows: Omit<SubjectPickerPinnedOption, "onToggle">[] = [
    ...(selfSubject
      ? [
          {
            id: "me",
            label: "Me",
            icon: <User size={16} className="text-muted-foreground" />,
            selected: value.includes(selfSubject.id),
            subjectId: selfSubject.id,
          },
        ]
      : []),
    ...pinnedOptions,
  ];

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

  const visibleSections = filterPickerSections(sections, query);

  const renderSections = () =>
    visibleSections.map((section) => (
      <div
        key={section.id}
        className="border-t border-border/60 mt-1 pt-1"
        data-testid={`subject-picker-section-${section.id}`}
      >
        <div className="text-xs uppercase text-muted-foreground px-3 pt-2 pb-1">
          {section.label}
        </div>
        {section.rows.map((row) => (
          <button
            key={row.id}
            type="button"
            onClick={row.onToggle}
            className={cn(
              "flex w-full min-h-11 md:min-h-0 touch:min-h-11 items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors",
              row.selected ? "bg-primary/10" : "hover:bg-muted",
            )}
            data-testid={`subject-picker-section-row-${row.id}`}
          >
            <SubjectAvatar subject={row.subject} size="sm" />
            <span className="flex-1 min-w-0 truncate text-foreground">{row.subject.name}</span>
            {row.badge && (
              <span className="text-xs px-2 py-0.5 rounded-full shrink-0 bg-muted text-muted-foreground">
                {row.badge}
              </span>
            )}
            {row.selected && <Check size={14} className="text-primary shrink-0" />}
          </button>
        ))}
      </div>
    ));

  const dropdownContent = (
    <div
      ref={dropdownRef}
      data-select-portal={portal ? "" : undefined}
      style={
        portal && position
          ? {
              position: "fixed",
              top: position.top,
              left: position.left,
              width: position.width,
            }
          : undefined
      }
      className={cn(popoverShellClass, portal ? "z-200" : "absolute z-50 mt-1 w-full")}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="p-2 border-b border-border">
        <div
          className={cn(controlShellClass, "focus-ring-within flex items-center gap-2 px-2 py-1.5")}
        >
          <MagnifyingGlass size={14} className="text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder={placeholder || defaultPlaceholder}
            disabled={disabled}
            className="min-w-0 flex-1 text-sm bg-transparent outline-none text-foreground placeholder:text-subtle-foreground"
          />
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto py-1">
        {suggested && pinnedRows.length > 0 && (
          <div className="border-b border-border/60 pb-1 mb-1">
            {pinnedRows.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  const pinned = pinnedOptions.find((candidate) => candidate.id === option.id);
                  if (pinned) pinned.onToggle();
                  else if (selfSubject) handleSelect(selfSubject);
                }}
                className={cn(
                  "flex w-full min-h-11 md:min-h-0 touch:min-h-11 items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors",
                  option.selected ? "bg-primary/10" : "hover:bg-muted",
                )}
                data-testid={`subject-picker-pinned-${option.id}`}
              >
                {option.icon}
                <span className="flex-1 truncate text-foreground">{option.label}</span>
                {option.selected && <Check size={14} className="text-primary shrink-0" />}
              </button>
            ))}
          </div>
        )}
        {suggested ? (
          <>
            {selectedRows.length > 0 && (
              <div className={cn(suggestions.length > 0 && "border-b border-border/60 pb-1 mb-1")}>
                {selectedRows.map(renderResultRow)}
              </div>
            )}
            {suggestions.length > 0 ? (
              <div data-testid="subject-picker-suggestions">
                <div className="text-xs uppercase text-muted-foreground px-3 pt-2 pb-1">
                  {subjectTypes === "groups" ? "Groups" : "Suggested"}
                </div>
                {suggestions.map(renderResultRow)}
              </div>
            ) : loading ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">Loading...</div>
            ) : selectedRows.length === 0 && pinnedRows.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">Type to search...</div>
            ) : null}
          </>
        ) : loading && results.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted-foreground">Searching...</div>
        ) : results.length === 0 ? (
          visibleSections.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">No results found</div>
          )
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
        {renderSections()}
      </div>
    </div>
  );

  if (portal) {
    return <>{position && createPortal(dropdownContent, document.body)}</>;
  }

  return <div className="relative">{dropdownContent}</div>;
}
