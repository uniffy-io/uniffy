import { Hourglass } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";

interface PlatformPagePlaceholderProps {
  title: string;
  description: string;
  icon: Icon;
  className?: string;
}

export function PlatformPagePlaceholder({
  title,
  description,
  icon: Icon,
  className,
}: PlatformPagePlaceholderProps) {
  return (
    <div className={cn("flex flex-col gap-6 max-w-3xl w-full mx-auto", className)}>
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-lg bg-primary/10">
          <Icon size={22} weight="duotone" className="text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-foreground">{title}</h1>
          <p className="text-sm text-muted-foreground mt-1">{description}</p>
        </div>
      </div>

      <div className="p-5 rounded-lg border border-dashed border-border bg-card flex items-start gap-3">
        <Hourglass size={18} weight="duotone" className="text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-sm text-muted-foreground">
          This page is part of the platform admin surface scaffold. The data wiring and interactive
          controls will land in a subsequent change.
        </div>
      </div>
    </div>
  );
}
