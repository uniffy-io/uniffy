import { cn } from "@/shared/utils/cn";

interface SkeletonProps {
  className?: string;
  variant?: "text" | "circular" | "rectangular";
}

export function Skeleton({ className, variant = "text" }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse bg-muted",
        variant === "text" && "h-3 rounded",
        variant === "circular" && "rounded-full",
        variant === "rectangular" && "rounded-lg",
        className,
      )}
    />
  );
}

interface SkeletonTextProps {
  lines?: number;
  className?: string;
}

const LINE_WIDTHS = ["w-full", "w-4/5", "w-3/5", "w-5/6", "w-2/3"];

export function SkeletonText({ lines = 3, className }: SkeletonTextProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} variant="text" className={LINE_WIDTHS[i % LINE_WIDTHS.length]} />
      ))}
    </div>
  );
}

interface SkeletonListItemProps {
  className?: string;
  avatarSize?: "sm" | "md" | "lg";
  lines?: number;
}

const AVATAR_SIZES = {
  sm: "w-6 h-6",
  md: "w-8 h-8",
  lg: "w-10 h-10",
};

export function SkeletonListItem({
  className,
  avatarSize = "md",
  lines = 2,
}: SkeletonListItemProps) {
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <Skeleton variant="circular" className={cn(AVATAR_SIZES[avatarSize], "flex-shrink-0")} />
      <div className="flex-1 space-y-2 pt-0.5">
        <Skeleton variant="text" className="w-2/3 h-3.5" />
        {lines > 1 && <Skeleton variant="text" className="w-1/2 h-2.5" />}
      </div>
    </div>
  );
}
