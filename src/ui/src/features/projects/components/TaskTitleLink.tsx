import type { MouseEvent, ReactNode } from "react";
import { taskLinkPath } from "@/features/projects/utils/taskPath";
import { cn } from "@/shared/utils/cn";

/** Modified clicks follow the task link without selecting the host row. */
export function TaskTitleLink({
  taskId,
  className,
  children,
}: {
  taskId: string;
  className?: string;
  children: ReactNode;
}) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      // The browser opens the link; the host must not also open the panel or change selection.
      event.stopPropagation();
      return;
    }
    event.preventDefault();
  };
  return (
    <a
      href={taskLinkPath(taskId)}
      onClick={onClick}
      draggable={false}
      className={cn("text-inherit no-underline", className)}
      data-testid="task-title-link"
    >
      {children}
    </a>
  );
}
