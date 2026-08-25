import { cn } from "@/shared/utils/cn";

interface SectionRuleProps {
  label: string;
  count: number;
}

/** Group header for a card collection: label, count, and a rule to the edge. */
export function SectionRule({ label, count }: SectionRuleProps) {
  return (
    <div className="mb-3 flex items-baseline gap-3">
      <h2 className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </h2>
      <span className="text-[11px] tabular-nums text-muted-foreground/60">{count}</span>
      <span className="h-px flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}

interface CardGridSkeletonProps {
  count?: number;
  className?: string;
}

export function CardGridSkeleton({ count = 6, className }: CardGridSkeletonProps) {
  return (
    <div
      className={cn("grid items-start gap-3 sm:grid-cols-2 xl:grid-cols-3", className)}
      aria-busy="true"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-card" />
      ))}
    </div>
  );
}

interface LoadMoreButtonProps {
  onClick: () => void;
  loading?: boolean;
  label?: string;
  className?: string;
  testId?: string;
}

export function LoadMoreButton({
  onClick,
  loading = false,
  label = "Load more",
  className,
  testId,
}: LoadMoreButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      data-testid={testId}
      className={cn(
        "rounded-full border border-border px-5 py-2 text-xs font-medium text-foreground",
        "transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary",
        "disabled:opacity-50",
        className,
      )}
    >
      {loading ? "Loading..." : label}
    </button>
  );
}
