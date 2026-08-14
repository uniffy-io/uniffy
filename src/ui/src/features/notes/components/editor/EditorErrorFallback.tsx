import { ArrowClockwise, WarningCircle } from "@phosphor-icons/react";

interface EditorErrorFallbackProps {
  onRetry: () => void;
}

export function EditorErrorFallback({ onRetry }: EditorErrorFallbackProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 bg-card p-8 text-center">
      <WarningCircle size={48} weight="duotone" className="text-red-500" />
      <div>
        <h3 className="text-base font-semibold text-foreground">Editor crashed</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          The editor hit an unexpected error. Your latest edits are safe on the server; retry to
          reload the document.
        </p>
      </div>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        <ArrowClockwise size={14} weight="bold" />
        Retry
      </button>
    </div>
  );
}
