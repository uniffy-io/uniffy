import { WarningCircle } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { useOpenBlockerCount } from "@/features/projects/hooks/useOpenBlockerCount";
import type { Task } from "@/features/projects/types/project";

interface BlockedBadgeProps {
  task: Task;
  /** `icon` fits rows where a labelled pill would crowd the title. */
  variant?: "label" | "icon";
  className?: string;
}

export function BlockedBadge({ task, variant = "label", className }: BlockedBadgeProps) {
  const open = useOpenBlockerCount(task);
  if (open === 0) return null;

  const description = `Blocked by ${open} open task${open === 1 ? "" : "s"}`;
  if (variant === "icon") {
    return (
      <span
        role="img"
        aria-label={description}
        title={description}
        className={cn("shrink-0 text-yellow-600 dark:text-yellow-400", className)}
      >
        <WarningCircle size={14} weight="fill" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex items-center px-1.5 py-0.5 rounded gap-1 text-[10px] bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
        className,
      )}
      title={description}
    >
      <WarningCircle size={10} weight="fill" />
      Blocked ({open})
    </span>
  );
}
