import { cn } from "@/shared/utils/cn";

interface SectionLabelProps {
  children: React.ReactNode;
  className?: string;
  /** Trailing control, e.g. the all-day toggle on the schedule header. */
  action?: React.ReactNode;
}

/** The detail panel's header idiom, shared so the inline editors match Description and Attendees. */
export function SectionLabel({ children, className, action }: SectionLabelProps) {
  return (
    <div className={cn("flex items-center justify-between gap-2 mb-2", className)}>
      <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        {children}
      </h3>
      {action}
    </div>
  );
}
