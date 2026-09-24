import { useMemo, useRef, useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { controlShellClass } from "@/components/ui/input";
import { SubjectAvatarStack, SubjectPicker } from "@/components/subject";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
interface PersonFilterInputProps {
  ids: readonly string[];
  /** One person at most: a new pick replaces the previous one. */
  single?: boolean;
  onChange: (ids: string[]) => void;
}

export function PersonFilterInput({
  ids: rawIds,
  single = false,
  onChange,
}: PersonFilterInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const ids = useMemo(() => [...rawIds], [rawIds]);
  const { subjects } = useSubjectResolver(ids);

  const label =
    subjects.length === 0
      ? null
      : subjects.length === 1
        ? subjects[0].name
        : `${subjects[0].name} +${subjects.length - 1}`;

  return (
    <div className="flex-1 min-w-[160px]">
      <button
        ref={triggerRef}
        type="button"
        // The open picker closes on a document mousedown; swallowing it here lets this click toggle it shut.
        onMouseDown={(e) => {
          if (isOpen) e.stopPropagation();
        }}
        onClick={() => setIsOpen((open) => !open)}
        className={cn(
          controlShellClass,
          "focus-ring flex items-center gap-1.5 w-full h-7 px-2 text-xs",
          isOpen && "border-border-strong",
        )}
      >
        {label ? (
          <>
            <SubjectAvatarStack subjectIds={ids} maxDisplay={3} size="xs" />
            <span className="flex-1 min-w-0 truncate text-left text-foreground">{label}</span>
          </>
        ) : (
          <span className="flex-1 text-left text-subtle-foreground">Pick people</span>
        )}
        <CaretDown
          size={10}
          className={cn(
            "shrink-0 text-muted-foreground transition-transform",
            isOpen && "rotate-180",
          )}
        />
      </button>
      {isOpen && (
        <SubjectPicker
          mode="multi"
          subjectTypes="all"
          value={ids}
          onChange={(next) => {
            const added = next.filter((id) => !ids.includes(id));
            onChange(single ? added.slice(-1) : next);
          }}
          portal
          anchorRef={triggerRef}
          onClose={() => setIsOpen(false)}
          autoFocus
        />
      )}
    </div>
  );
}
