import { useState } from "react";
import { toast } from "sonner";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { friendlyErrorMessage } from "@/config";
import { supportSessionsApi } from "@/features/platform/api/supportSessionsApi";
import { SupportSessionScope } from "@uniffy/proto/support/v1/support_consent_pb";

interface Props {
  organizationId: string;
  organizationName: string;
  onClose: () => void;
  onCreated: () => void;
}

const MIN_DURATION = 5;
const MAX_DURATION = 120;
const DEFAULT_DURATION = 30;

export function RequestSupportSessionDialog({
  organizationId,
  organizationName,
  onClose,
  onCreated,
}: Props) {
  const [reason, setReason] = useState("");
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      toast.error("Reason is required");
      return;
    }
    setSubmitting(true);
    try {
      await supportSessionsApi.request({
        organizationId,
        reason: trimmed,
        scope: SupportSessionScope.READ_ONLY,
        durationMinutes: duration,
      });
      toast.success("Request sent. The org owner must approve before access begins.");
      onCreated();
      onClose();
    } catch (error) {
      const message = friendlyErrorMessage((error as Error).message);
      if (message) toast.error(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose} closeDisabled={submitting} maxWidth="max-w-md">
      <ModalHeader
        title="Request support session"
        description={`Read-only access to ${organizationName}.`}
      />

      <ModalBody>
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-200">
          The org owner will receive an in-app notification and email. Access begins only after they
          approve. Every action you take while the session is active is recorded in their audit log.
        </div>

        <div>
          <label htmlFor="support-reason" className="block text-sm text-muted-foreground mb-1">
            Reason
          </label>
          <Textarea
            id="support-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="e.g. Ticket #1234, help debugging notes that won't open"
            disabled={submitting}
          />
          <p className="text-xs text-muted-foreground text-right mt-1">{reason.length} / 2000</p>
        </div>

        <div>
          <label htmlFor="support-duration" className="block text-sm text-muted-foreground mb-1">
            Duration: {duration} minutes
          </label>
          <input
            id="support-duration"
            type="range"
            min={MIN_DURATION}
            max={MAX_DURATION}
            step={5}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            disabled={submitting}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-muted-foreground mt-1">
            <span>{MIN_DURATION}m</span>
            <span>{MAX_DURATION}m max</span>
          </div>
        </div>

        <div>
          <label className="block text-sm text-muted-foreground mb-1">Scope</label>
          <div className="flex items-center gap-2 p-2 rounded-md bg-muted/50 text-sm">
            Read-only
            <span className="text-xs text-muted-foreground">(read-write not supported in v1)</span>
          </div>
        </div>
      </ModalBody>

      <ModalFooter>
        <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
          Cancel
        </Button>
        <Button
          type="button"
          onClick={handleSubmit}
          loading={submitting}
          disabled={submitting || reason.trim().length === 0}
        >
          Request access
        </Button>
      </ModalFooter>
    </Modal>
  );
}
