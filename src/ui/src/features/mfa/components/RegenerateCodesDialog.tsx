import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { friendlyErrorMessage } from "@/config";
import { mfaClient } from "@/features/mfa/api/mfaApi";
import { RecoveryCodesView } from "@/features/mfa/components/RecoveryCodesView";

interface RegenerateCodesDialogProps {
  onClose: () => void;
  onRegenerated: () => void;
}

/** Old codes are invalidated server-side; the new batch is shown once. */
export function RegenerateCodesDialog({ onClose, onRegenerated }: RegenerateCodesDialogProps) {
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const response = await mfaClient.regenerateRecoveryCodes({ code: code.trim() });
      setCodes(response.recoveryCodes);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : "Failed to regenerate codes";
      setError(friendlyErrorMessage(raw) || raw);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDone = () => {
    onRegenerated();
    onClose();
  };

  return (
    <Modal onClose={onClose} closeDisabled={submitting} maxWidth="max-w-md">
      <ModalHeader
        title="Regenerate recovery codes"
        description="Your old recovery codes will stop working. Confirm with a current authenticator code and save the new ones somewhere only you can reach."
      />

      {codes ? (
        <>
          <ModalBody>
            <RecoveryCodesView codes={codes} />
          </ModalBody>
          <ModalFooter>
            <Button type="button" onClick={handleDone}>
              I have saved my codes
            </Button>
          </ModalFooter>
        </>
      ) : (
        <form onSubmit={submit}>
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
            <Button type="submit" loading={submitting} disabled={submitting || !code.trim()}>
              {submitting ? "Generating..." : "Generate"}
            </Button>
          </ModalFooter>
        </form>
      )}
    </Modal>
  );
}
