import { WarningCircle, ArrowClockwise } from '@phosphor-icons/react';

interface AppErrorFallbackProps {
  error: Error;
  reset: () => void;
}

export function AppErrorFallback({ error, reset }: AppErrorFallbackProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground px-4">
      <WarningCircle size={56} weight="duotone" className="text-red-500 dark:text-red-400 mb-4" />
      <h1 className="text-xl font-bold mb-2">Something went wrong</h1>
      <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
        The application encountered an unexpected error. Please try reloading the page.
      </p>
      <button
        onClick={() => { reset(); window.location.reload(); }}
        className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors cursor-pointer"
      >
        <ArrowClockwise size={16} weight="bold" />
        Reload application
      </button>
      {import.meta.env.DEV && (
        <pre className="mt-6 text-xs text-muted-foreground bg-muted rounded-lg p-3 max-w-lg overflow-auto max-h-40">
          {error.message}
        </pre>
      )}
    </div>
  );
}
