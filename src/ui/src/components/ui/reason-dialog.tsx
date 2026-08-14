import { useEffect, useRef, useState } from "react";
import { Warning, X } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { cn } from "@/shared/utils/cn";

export interface ReasonDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  title: string;
  description?: React.ReactNode;
  reasonLabel?: string;
  reasonPlaceholder?: string;
  reasonRequired?: boolean;
  confirmSlug?: { slug: string; helperText?: React.ReactNode };
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "default";
  loading?: boolean;
}

export function ReasonDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  reasonLabel = "Reason",
  reasonPlaceholder = "Short description for the audit log",
  reasonRequired = true,
  confirmSlug,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  loading = false,
}: ReasonDialogProps) {
  const reasonRef = useRef<HTMLInputElement>(null);
  const [reason, setReason] = useState("");
  const [slugInput, setSlugInput] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset form state when dialog opens
    setReason("");
    setSlugInput("");
    const timer = setTimeout(() => reasonRef.current?.focus(), 50);
    return () => clearTimeout(timer);
  }, [isOpen]);

  if (!isOpen) return null;

  const reasonValid = reasonRequired ? reason.trim().length > 0 : true;
  const slugValid = !confirmSlug || slugInput === confirmSlug.slug;
  const canConfirm = !loading && reasonValid && slugValid;

  const handleSubmit = () => {
    if (!canConfirm) return;
    onConfirm(reason.trim());
  };

  const iconStyles = {
    danger: {
      backgroundColor: "color-mix(in srgb, var(--status-error) 10%, transparent)",
      color: "var(--status-error)",
    },
    warning: {
      backgroundColor: "color-mix(in srgb, var(--status-warning) 10%, transparent)",
      color: "var(--status-warning)",
    },
    default: {},
  };

  return (
    <Modal onClose={onClose} closeDisabled={loading} maxWidth="max-w-md">
      <div data-testid="reason-dialog" data-variant={variant}>
        <div className="flex items-start gap-4 p-6 pb-4">
          <div
            className={cn(
              "p-3 rounded-full",
              variant === "default" && "bg-primary/10 text-primary",
            )}
            style={iconStyles[variant]}
          >
            <Warning size={24} weight="duotone" />
          </div>
          <div className="flex-1 pt-1 min-w-0">
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            {description ? (
              <div className="mt-2 text-sm text-muted-foreground">{description}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <X size={20} weight="bold" />
          </button>
        </div>

        <div className="px-6 pb-4 space-y-3">
          {confirmSlug ? (
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">
                Type{" "}
                <code className="font-mono text-foreground bg-muted px-1 rounded">
                  {confirmSlug.slug}
                </code>{" "}
                to confirm
              </label>
              <input
                type="text"
                value={slugInput}
                onChange={(e) => setSlugInput(e.target.value)}
                disabled={loading}
                autoComplete="off"
                spellCheck={false}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {confirmSlug.helperText ? (
                <p className="mt-1 text-xs text-muted-foreground">{confirmSlug.helperText}</p>
              ) : null}
            </div>
          ) : null}
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              {reasonLabel}
              {reasonRequired ? null : <span className="text-muted-foreground"> (optional)</span>}
            </label>
            <input
              ref={reasonRef}
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={reasonPlaceholder}
              disabled={loading}
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-muted/30 border-t border-border">
          <Button type="button" variant="outline" size="md" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={
              variant === "danger" ? "destructive" : variant === "warning" ? "warning" : "default"
            }
            size="md"
            onClick={handleSubmit}
            loading={loading}
            disabled={!canConfirm}
          >
            {loading ? "Processing..." : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
