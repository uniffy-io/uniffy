import { SpinnerGap } from '@phosphor-icons/react';
import { cn } from '@/shared/utils/cn';

interface PageLoaderProps {
  className?: string;
  message?: string;
}

export function PageLoader({ className, message }: PageLoaderProps) {
  return (
    <div className={cn(
      'flex flex-col items-center justify-center min-h-[60vh] bg-background',
      className,
    )}>
      <SpinnerGap size={32} className="animate-spin text-primary mb-3" />
      {message && (
        <p className="text-sm text-muted-foreground">{message}</p>
      )}
    </div>
  );
}
