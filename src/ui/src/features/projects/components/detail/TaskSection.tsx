import type { ReactNode } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";

interface TaskSectionProps {
  title: string;
  count?: number;
  /** Shown as "done/count", for sections whose items complete. */
  done?: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
  testId?: string;
  className?: string;
  /** Controls beside the title, shown while the section is open. */
  actions?: ReactNode;
}

/** A collapsible block under the description; the panel or page around it does the scrolling. */
export function TaskSection({
  title,
  count,
  done,
  open,
  onToggle,
  children,
  testId,
  className,
  actions,
}: TaskSectionProps) {
  return (
    <section className={cn("border-t border-border/60 pt-2", className)} data-testid={testId}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="focus-ring flex min-h-11 flex-1 items-center gap-2 whitespace-nowrap rounded-md text-xs font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground md:min-h-8"
        >
          <CaretRight
            size={12}
            weight="bold"
            className={cn("shrink-0 transition-transform", open && "rotate-90")}
          />
          {title}
          {count !== undefined && count > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-px text-[10px] font-medium normal-case tracking-normal text-muted-foreground">
              {done === undefined ? count : `${done}/${count}`}
            </span>
          )}
        </button>
        {open && actions}
      </div>
      {open && <div className="pt-2 pb-2">{children}</div>}
    </section>
  );
}
