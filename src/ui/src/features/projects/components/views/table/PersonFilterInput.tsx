import { useMemo, useRef, useState } from "react";
import { CaretDown, User, UserCircleDashed } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { controlShellClass } from "@/components/ui/input";
import {
  SubjectAvatarStack,
  SubjectPicker,
  type SubjectPickerPinnedOption,
} from "@/components/subject";
import { useSubjectResolver } from "@/components/subject/hooks/useSubjectResolver";
import type { ViewFilterIdSet, ViewIdFlag } from "@/features/projects/types/views";
import { NO_ID_SET } from "@/features/projects/utils/filterTree";

interface PersonFilterInputProps {
  set: ViewFilterIdSet;
  /** The id flags this field accepts, from the view catalog. */
  flags: readonly ViewIdFlag[];
  /** One value at most (is / is not): a new pick replaces the previous one. */
  single?: boolean;
  onChange: (set: ViewFilterIdSet) => void;
  className?: string;
}

export function PersonFilterInput({
  set,
  flags,
  single = false,
  onChange,
  className,
}: PersonFilterInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const ids = useMemo(() => [...set.ids], [set.ids]);
  const { subjects } = useSubjectResolver(ids);

  const words = [
    ...(set.includeCurrentUser ? ["Me"] : []),
    ...subjects.map((subject) => subject.name),
    ...(set.includeEmpty ? ["Unassigned"] : []),
  ];
  const label =
    words.length === 0 ? null : words.length === 1 ? words[0] : `${words[0]} +${words.length - 1}`;

  const toggleFlag = (flag: "includeCurrentUser" | "includeEmpty") => {
    const on = !set[flag];
    onChange(single ? { ...NO_ID_SET, [flag]: on } : { ...set, [flag]: on });
  };

  const pinnedOptions: SubjectPickerPinnedOption[] = [
    ...(flags.includes("includeCurrentUser")
      ? [
          {
            id: "me",
            label: "Me",
            icon: <User size={16} className="text-muted-foreground" />,
            selected: set.includeCurrentUser,
            onToggle: () => toggleFlag("includeCurrentUser"),
          },
        ]
      : []),
    ...(flags.includes("includeEmpty")
      ? [
          {
            id: "unassigned",
            label: "Unassigned",
            icon: <UserCircleDashed size={16} className="text-muted-foreground" />,
            selected: set.includeEmpty,
            onToggle: () => toggleFlag("includeEmpty"),
          },
        ]
      : []),
  ];

  return (
    <div className={cn("flex-1 min-w-[160px]", className)}>
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
          "focus-ring flex items-center gap-1.5 w-full h-11 md:h-7 touch:h-11 px-2 text-xs",
          isOpen && "border-border-strong",
        )}
      >
        {label ? (
          <>
            {ids.length > 0 && <SubjectAvatarStack subjectIds={ids} maxDisplay={3} size="xs" />}
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
          pinnedOptions={pinnedOptions}
          onChange={(next) => {
            if (!single) {
              onChange({ ...set, ids: next });
              return;
            }
            const added = next.filter((id) => !ids.includes(id));
            onChange({ ...NO_ID_SET, ids: added.slice(-1) });
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
