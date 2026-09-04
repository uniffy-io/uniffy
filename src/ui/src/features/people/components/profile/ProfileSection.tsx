import type { ReactNode } from "react";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Card } from "@/components/ui/card";

interface ProfileSectionProps {
  title: string;
  icon: Icon;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** One profile block, shaped like a dashboard widget: icon disc, tight title, padded body. */
export function ProfileSection({
  title,
  icon: IconComponent,
  action,
  className,
  children,
}: ProfileSectionProps) {
  return (
    <Card tone="surface" className={className}>
      <div className="flex items-center justify-between p-4 pb-3 md:p-6 md:pb-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="shrink-0 rounded-lg bg-muted p-1.5">
            <IconComponent size={16} weight="duotone" className="text-muted-foreground" />
          </div>
          <h2 className="truncate font-semibold leading-none tracking-tight">{title}</h2>
        </div>
        {action && <div className="ml-2 shrink-0">{action}</div>}
      </div>
      <div className="px-4 pb-4 md:px-6 md:pb-6">{children}</div>
    </Card>
  );
}

interface ProfileEmptyStateProps {
  icon: Icon;
  title: string;
  description?: string;
  className?: string;
}

export function ProfileEmptyState({
  icon: IconComponent,
  title,
  description,
  className,
}: ProfileEmptyStateProps) {
  return (
    <Card
      tone="surface"
      className={cn("flex flex-col items-center justify-center py-10 text-center", className)}
    >
      <div className="mb-3 rounded-full bg-muted p-3">
        <IconComponent size={24} weight="duotone" className="text-muted-foreground" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-[240px] text-xs text-muted-foreground">{description}</p>
      )}
    </Card>
  );
}
