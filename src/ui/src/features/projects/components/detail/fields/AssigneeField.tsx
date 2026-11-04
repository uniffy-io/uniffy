import { useRef, useState } from "react";
import { SubjectAvatarStack, SubjectPicker } from "@/components/subject";
import { cn } from "@/shared/utils/cn";

interface AssigneeFieldProps {
  assigneeIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  triggerClassName?: string;
}

export function AssigneeField({
  assigneeIds,
  onChange,
  disabled,
  triggerClassName,
}: AssigneeFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => !disabled && setIsOpen((v) => !v)}
        disabled={disabled}
        className={cn(
          "flex items-center gap-2 rounded-md px-2 py-1 -mx-2 text-sm transition-colors",
          disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-muted/50",
          triggerClassName,
        )}
      >
        {assigneeIds.length > 0 ? (
          <SubjectAvatarStack subjectIds={assigneeIds} />
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        )}
      </button>
      {isOpen && (
        <SubjectPicker
          mode="multi"
          subjectTypes="all"
          value={assigneeIds}
          onChange={(ids) => onChange(ids)}
          portal
          align="left"
          dropdownWidth={320}
          placeholder="Search assignees..."
          anchorRef={triggerRef}
          onClose={() => setIsOpen(false)}
          autoFocus
        />
      )}
    </>
  );
}
