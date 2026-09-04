import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { friendlyErrorMessage } from "@/config";
import { mfaClient } from "@/features/mfa/api/mfaApi";

interface DisableMfaDialogProps {
  onClose: () => void;
  onDisabled: () => void;
}

/** Requires a current TOTP so a stolen session cannot disable MFA; server bumps token_version to sign other sessions out. */
export function DisableMfaDialog({ onClose, onDisabled }: DisableMfaDialogProps) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await mfaClient.disableMfa({ code: code.trim() });
      toast.success("Two factor authentication disabled.");
      onDisabled();
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "Failed to disable MFA";
      setError(friendlyErrorMessage(raw) || raw);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose} closeDisabled={submitting} maxWidth="max-w-md">
      <form onSubmit={submit}>
        <ModalHeader
          title="Disable two factor authentication"
          description="Anyone who gets your password will be able to sign in. Enter a current authenticator code to confirm."
        />

        <ModalBody>
          <Input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="123456"
            autoComplete="one-time-code"
            inputMode="numeric"
            spellCheck={false}
            autoFocus
            required
            className="h-auto px-4 py-3 text-center font-mono text-2xl tracking-widest"
          />
          {error && (
            <div
              role="alert"
              className="rounded-md border border-red-500/40 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300"
            >
              {error}
            </div>
          )}
        </ModalBody>

        <ModalFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="destructive"
            loading={submitting}
            disabled={submitting || !code.trim()}
          >
            {submitting ? "Disabling..." : "Disable"}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
}
