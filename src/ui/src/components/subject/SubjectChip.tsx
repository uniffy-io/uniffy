import { X } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { SUBJECT_TYPE, type Subject } from "@/components/subject/types";
import { SubjectAvatar } from "@/components/subject/SubjectAvatar";

interface SubjectChipProps {
  subject: Subject;
  onRemove?: () => void;
  disabled?: boolean;
  className?: string;
}

export function SubjectChip({ subject, onRemove, disabled = false, className }: SubjectChipProps) {
  const isGroup = subject.type === SUBJECT_TYPE.GROUP;
  // Teams share the primary tint with users; only access groups read violet.
  const isViolet = isGroup && subject.kind !== "team";

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border",
        isViolet
          ? "bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20"
          : "bg-primary/10 text-primary border-primary/20",
        className,
      )}
    >
      <SubjectAvatar subject={subject} size="xs" />
      <span className="truncate max-w-[120px]">{subject.name || subject.email}</span>
      {isGroup && subject.memberCount != null && subject.memberCount > 0 && (
        <span className="opacity-70 shrink-0">{subject.memberCount}</span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className={cn(
            "rounded-full p-0.5 ml-0.5 transition-colors",
            isViolet ? "hover:bg-violet-500/20" : "hover:bg-primary/20",
            "disabled:opacity-50 disabled:cursor-not-allowed",
          )}
        >
          <X size={12} weight="bold" />
        </button>
      )}
    </div>
  );
}
