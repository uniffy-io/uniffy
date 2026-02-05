/**
 * WidgetCard - Shared wrapper component for dashboard widgets
 *
 * Provides consistent styling, loading states, and empty states
 * for all dashboard widgets.
 */

import type { ReactNode } from 'react';
import type { Icon } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';

interface WidgetCardProps {
  /** Card title */
  title: string;
  /** Optional subtitle/description */
  subtitle?: string;
  /** Card content */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
  /** Column span for grid layout (default: 1) */
  colSpan?: 1 | 2 | 3 | 4;
  /** Optional action element (button, link) in header */
  action?: ReactNode;
  /** Whether content is loading */
  loading?: boolean;
  /** Compact mode (less padding) */
  compact?: boolean;
}

export function WidgetCard({
  title,
  subtitle,
  children,
  className,
  colSpan = 1,
  action,
  loading = false,
  compact = false,
}: WidgetCardProps) {
  const colSpanClass = {
    1: '',
    2: 'md:col-span-2',
    3: 'md:col-span-3',
    4: 'md:col-span-4',
  }[colSpan];

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card text-card-foreground shadow-sm',
        colSpanClass,
        className
      )}
    >
      {/* Header */}
      <div className={cn('flex items-center justify-between', compact ? 'p-4 pb-2' : 'p-6 pb-4')}>
        <div className="space-y-1">
          <h3 className="font-semibold leading-none tracking-tight">{title}</h3>
          {subtitle && (
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>

      {/* Content */}
      <div className={cn(compact ? 'px-4 pb-4' : 'px-6 pb-6', loading && 'animate-pulse')}>
        {children}
      </div>
    </div>
  );
}

interface EmptyWidgetProps {
  /** Icon to display */
  icon: Icon;
  /** Empty state title */
  title: string;
  /** Empty state description */
  description?: string;
  /** Optional action button */
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyWidget({ icon: IconComponent, title, description, action }: EmptyWidgetProps) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="mb-3 rounded-full bg-muted p-3">
        <IconComponent size={24} className="text-muted-foreground" weight="duotone" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 text-xs text-muted-foreground max-w-[200px]">{description}</p>
      )}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-3 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

export function WidgetSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-md bg-muted animate-pulse" />
          <div className="flex-1 space-y-1">
            <div className="h-3 w-3/4 rounded bg-muted animate-pulse" />
            <div className="h-2 w-1/2 rounded bg-muted animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}
