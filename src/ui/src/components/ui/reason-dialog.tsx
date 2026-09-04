import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";

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
    // The dialog stays mounted between opens, so each open starts from a blank form.
    // eslint-disable-next-line react/react-compiler
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

  return (
    <Modal onClose={onClose} closeDisabled={loading} maxWidth="max-w-md">
      <div data-testid="reason-dialog" data-variant={variant}>
        <ModalHeader title={title} description={description} />

        <ModalBody>
          {confirmSlug ? (
            <div>
              <label className="block text-sm text-muted-foreground mb-1">
                Type{" "}
                <code className="font-mono text-foreground bg-muted px-1 rounded">
                  {confirmSlug.slug}
                </code>{" "}
                to confirm
              </label>
              <Input
                type="text"
                value={slugInput}
                onChange={(e) => setSlugInput(e.target.value)}
                disabled={loading}
                autoComplete="off"
                spellCheck={false}
                className="font-mono"
              />
              {confirmSlug.helperText ? (
                <p className="mt-1 text-xs text-muted-foreground">{confirmSlug.helperText}</p>
              ) : null}
            </div>
          ) : null}
          <div>
            <label className="block text-sm text-muted-foreground mb-1">
              {reasonLabel}
              {reasonRequired ? null : " (optional)"}
            </label>
            <Input
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
            />
          </div>
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={
              variant === "danger" ? "destructive" : variant === "warning" ? "warning" : "default"
            }
            onClick={handleSubmit}
            loading={loading}
            disabled={!canConfirm}
          >
            {loading ? "Processing..." : confirmLabel}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
}
