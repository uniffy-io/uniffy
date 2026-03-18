import type { Icon } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { useFormattedKeybinding } from '@/features/settings';
import { cn } from '@/shared/utils/cn';

interface EmptyStateTip {
  color: 'primary' | 'emerald-500' | 'amber-500' | 'blue-500' | 'violet-500' | 'rose-500';
  text: React.ReactNode;
}

interface EmptyStateProps {
  icon: Icon;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  shortcutKey?: string;
  tips?: EmptyStateTip[];
  className?: string;
}

export function EmptyState({
  icon: IconComponent,
  title,
  description,
  actionLabel,
  onAction,
  shortcutKey,
  tips,
  className,
}: EmptyStateProps) {
  const shortcut = useFormattedKeybinding(shortcutKey ?? '');

  return (
    <div className={cn('flex-1 flex flex-col items-center justify-center p-6 md:p-8', className)}>
      <div className="max-w-md text-center">
        {/* Floating card illustration */}
        <div className="relative mb-8">
          <div className="flex items-center justify-center gap-4">
            <div className="w-16 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 -rotate-6 transform" />
            <div className="w-16 h-12 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10 rotate-3 transform" />
            <div className="w-16 h-12 rounded-lg bg-gradient-to-br from-primary/20 to-primary/5 -rotate-3 transform" />
          </div>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="w-14 h-14 rounded-full bg-primary/10 border-2 border-primary flex items-center justify-center">
              <IconComponent size={24} weight="bold" className="text-primary" />
            </div>
          </div>
        </div>

        {/* Heading */}
        <h2 className="text-xl md:text-2xl font-semibold text-foreground mb-2">
          {title}
        </h2>
        <p className="text-sm md:text-base text-muted-foreground mb-6">
          {description}
        </p>

        {/* CTA button */}
        {actionLabel && onAction && (
          <Button onClick={onAction} className="mb-4">
            <IconComponent size={16} className="mr-2" />
            {actionLabel}
          </Button>
        )}

        {/* Keyboard shortcut hint */}
        {shortcutKey && shortcut && (
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground mb-8">
            <span>or press</span>
            <kbd className="px-2 py-1 rounded bg-muted text-xs font-mono">
              {shortcut}
            </kbd>
          </div>
        )}

        {/* Quick tips */}
        {tips && tips.length > 0 && (
          <div className="bg-card rounded-lg border border-border p-4 text-left">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Quick Tips
            </h3>
            <ul className="space-y-2">
              {tips.map((tip, index) => (
                <TipItem key={index} color={tip.color}>
                  {tip.text}
                </TipItem>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

interface TipItemProps {
  color: string;
  children: React.ReactNode;
}

function TipItem({ color, children }: TipItemProps) {
  const dotColor = color === 'primary' ? 'bg-primary' : `bg-${color}`;
  return (
    <li className="flex items-start gap-2 text-sm text-muted-foreground">
      <div className={cn('w-2 h-2 rounded-full mt-1.5 flex-shrink-0', dotColor)} />
      <span>{children}</span>
    </li>
  );
}
