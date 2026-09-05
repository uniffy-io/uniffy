import { cn } from "@/shared/utils/cn";

/**
 * Header chrome shared by the skill and rule detail panes so both read as the
 * same kind of document: icon buttons, toggle chips, and section labels.
 */
export const headerButtonClass = cn(
  "group/btn relative flex items-center justify-center h-7 w-7 rounded-md",
  "border border-border-strong bg-transparent text-muted-foreground",
  "transition-all duration-300 ease-out",
  "hover:border-border-strong hover:bg-muted hover:text-primary",
);

export const headerChipClass = cn(
  "group/btn flex items-center gap-1 h-7 px-1.5 rounded-md",
  "border border-border-strong bg-transparent text-xs text-muted-foreground",
  "transition-all duration-300 ease-out",
  "hover:border-border-strong hover:bg-muted hover:text-primary",
);

export const headerChipActiveClass =
  "text-primary bg-primary/10 border-primary/50 hover:border-primary/50 hover:bg-primary/10";

export const sectionLabelClass =
  "text-xs font-medium uppercase tracking-wider text-muted-foreground";
