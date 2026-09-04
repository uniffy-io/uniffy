import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";

export interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning" | "default";
  loading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title = "Confirm Action",
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  loading = false,
}: ConfirmDialogProps) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Defer focus until the dialog is in the DOM.
      const timer = setTimeout(() => {
        confirmButtonRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <Modal onClose={onClose} closeDisabled={loading} maxWidth="max-w-md">
      <div data-testid="confirm-dialog" data-variant={variant}>
        <ModalHeader title={<span data-testid="confirm-dialog-title">{title}</span>} />

        <ModalBody>
          <div className="text-sm text-muted-foreground" data-testid="confirm-dialog-message">
            {message}
          </div>
        </ModalBody>

        <ModalFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={loading}
            data-testid="confirm-dialog-cancel"
          >
            {cancelLabel}
          </Button>
          <Button
            ref={confirmButtonRef}
            type="button"
            variant={
              variant === "danger" ? "destructive" : variant === "warning" ? "warning" : "default"
            }
            onClick={onConfirm}
            loading={loading}
            disabled={loading}
            data-testid="confirm-dialog-confirm"
          >
            {loading ? "Processing..." : confirmLabel}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
