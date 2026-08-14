import { useState, useCallback, useRef, useEffect } from "react";
import { cn } from "@/shared/utils/cn";
import { Button } from "@/components/ui/button";

interface CommentInputProps {
  placeholder?: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel?: () => void;
  initialValue?: string;
  autoFocus?: boolean;
}

export function CommentInput({
  placeholder = "Add a comment...",
  onSubmit,
  onCancel,
  initialValue = "",
  autoFocus = false,
}: CommentInputProps) {
  const [body, setBody] = useState(initialValue);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [autoFocus]);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [body]);

  const handleSubmit = useCallback(async () => {
    const trimmed = body.trim();
    if (!trimmed || isSubmitting) return;

    setIsSubmitting(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      setBody("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to post comment";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [body, isSubmitting, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleSubmit();
      }
      if (e.key === "Escape" && onCancel) {
        e.preventDefault();
        onCancel();
      }
    },
    [handleSubmit, onCancel],
  );

  return (
    <div className="space-y-2">
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          setError(null);
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={2}
        className={cn(
          "w-full resize-none rounded-md border bg-background",
          "px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring",
          "min-h-[60px] max-h-[200px]",
          "border-border",
        )}
        style={error ? { borderColor: "var(--status-error)" } : undefined}
      />
      {error && (
        <p className="text-xs" style={{ color: "var(--status-error)" }}>
          {error}
        </p>
      )}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Ctrl+Enter to submit</span>
        <div className="flex gap-2">
          {onCancel && (
            <Button variant="ghost" size="xs" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button
            size="xs"
            onClick={handleSubmit}
            disabled={!body.trim() || isSubmitting}
            loading={isSubmitting}
          >
            {isSubmitting ? "Posting..." : "Submit"}
          </Button>
        </div>
      </div>
    </div>
  );
}
