import { WarningCircle, ArrowClockwise, House } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/utils/cn';

interface PageErrorFallbackProps {
  error: Error;
  reset: () => void;
  className?: string;
}

export function PageErrorFallback({ error, reset, className }: PageErrorFallbackProps) {
  const isChunkError = error.message?.includes('Failed to fetch dynamically imported module')
    || error.message?.includes('Loading chunk')
    || error.message?.includes('Loading CSS chunk');

  return (
    <div className={cn(
      'flex flex-col items-center justify-center min-h-[60vh] bg-background px-4',
      className,
    )}>
      <WarningCircle size={48} weight="duotone" className="text-red-500 dark:text-red-400 mb-4" />
      <h2 className="text-lg font-semibold text-foreground mb-2">
        {isChunkError ? 'Update available' : 'Something went wrong'}
      </h2>
      <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
        {isChunkError
          ? 'A newer version of the app is available. Please reload to get the latest update.'
          : 'An unexpected error occurred while loading this page. You can try again or go back to the dashboard.'}
      </p>
      <div className="flex items-center gap-3">
        {isChunkError ? (
          <Button
            variant="default"
            size="sm"
            onClick={() => window.location.reload()}
          >
            <ArrowClockwise size={16} weight="bold" />
            Reload page
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={reset}>
              <ArrowClockwise size={16} weight="bold" />
              Try again
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => { window.location.href = '/'; }}
            >
              <House size={16} weight="bold" />
              Go to dashboard
            </Button>
          </>
        )}
      </div>
      {import.meta.env.DEV && (
        <details className="mt-6 max-w-lg w-full">
          <summary className="text-xs text-muted-foreground cursor-pointer">
            Error details (dev only)
          </summary>
          <pre className="mt-2 text-xs bg-muted text-muted-foreground rounded-lg p-3 overflow-auto max-h-40">
            {error.message}
            {'\n'}
            {error.stack}
          </pre>
        </details>
      )}
    </div>
  );
}
