import { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { NumberInput } from "@/components/ui/number-input";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import {
  fetchUserQuota,
  upsertUserQuota,
  deleteUserQuota,
  fetchDisplayCurrency,
} from "@/features/admin/store/agentsGovernanceThunks";

interface Props {
  open: boolean;
  userId: string | null;
  displayName: string;
  onClose: () => void;
}

interface FormState {
  dailyLimit: string;
  monthlyLimit: string;
  dailyImageLimit: string;
  monthlyImageLimit: string;
  hardLimit: boolean;
}

const EMPTY: FormState = {
  dailyLimit: "",
  monthlyLimit: "",
  dailyImageLimit: "",
  monthlyImageLimit: "",
  hardLimit: false,
};

export function MemberAgentQuotaDialog({ open, userId, displayName, onClose }: Props) {
  const dispatch = useAppDispatch();
  const displayCurrency = useAppSelector((s) => s.agentsGovernance.displayCurrency);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [hasOverride, setHasOverride] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    dispatch(fetchDisplayCurrency());
  }, [dispatch, open]);

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    // eslint-disable-next-line react/react-compiler -- fetching the member's quota each time the dialog opens; the form shows a spinner until it arrives
    setLoading(true);
    dispatch(fetchUserQuota({ userId }))
      .unwrap()
      .then((quota) => {
        if (cancelled) return;
        if (quota) {
          setHasOverride(true);
          setForm({
            dailyLimit: quota.dailyLimit ?? "",
            monthlyLimit: quota.monthlyLimit ?? "",
            dailyImageLimit: quota.dailyImageLimit?.toString() ?? "",
            monthlyImageLimit: quota.monthlyImageLimit?.toString() ?? "",
            hardLimit: quota.hardLimit,
          });
        } else {
          setHasOverride(false);
          setForm(EMPTY);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setHasOverride(false);
        setForm(EMPTY);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dispatch, open, userId]);

  if (!open || !userId) return null;

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await dispatch(
        upsertUserQuota({
          userId,
          dailyLimit: form.dailyLimit.trim() || null,
          monthlyLimit: form.monthlyLimit.trim() || null,
          dailyImageLimit: form.dailyImageLimit.trim()
            ? parseInt(form.dailyImageLimit.trim(), 10)
            : null,
          monthlyImageLimit: form.monthlyImageLimit.trim()
            ? parseInt(form.monthlyImageLimit.trim(), 10)
            : null,
          hardLimit: form.hardLimit,
        }),
      ).unwrap();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    setSaving(true);
    try {
      await dispatch(deleteUserQuota({ userId })).unwrap();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose} closeDisabled={saving} maxWidth="max-w-md">
      <ModalHeader
        title={`Agent quota for ${displayName}`}
        description="Caps the cost and image volume this member can consume across all agents. Leave a field blank to inherit the org-wide budget."
      />

      <ModalBody>
        {loading ? (
          <div className="py-4 text-sm text-muted-foreground">Loading...</div>
        ) : (
          <>
            <FormRow label={`Daily spend cap (${displayCurrency})`}>
              <NumberInput
                min="0"
                step="0.01"
                placeholder="No cap"
                value={form.dailyLimit}
                onChange={(e) => update("dailyLimit", e.target.value)}
                disabled={saving}
              />
            </FormRow>
            <FormRow label={`Monthly spend cap (${displayCurrency})`}>
              <NumberInput
                min="0"
                step="0.01"
                placeholder="No cap"
                value={form.monthlyLimit}
                onChange={(e) => update("monthlyLimit", e.target.value)}
                disabled={saving}
              />
            </FormRow>
            <FormRow label="Daily image cap">
              <NumberInput
                min="0"
                placeholder="No cap"
                value={form.dailyImageLimit}
                onChange={(e) => update("dailyImageLimit", e.target.value)}
                disabled={saving}
              />
            </FormRow>
            <FormRow label="Monthly image cap">
              <NumberInput
                min="0"
                placeholder="No cap"
                value={form.monthlyImageLimit}
                onChange={(e) => update("monthlyImageLimit", e.target.value)}
                disabled={saving}
              />
            </FormRow>
            <div className="flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-foreground">Hard limit</span>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Reject requests when over cap. When off, allow but warn.
                </p>
              </div>
              <ToggleSwitch
                enabled={form.hardLimit}
                onChange={(v) => update("hardLimit", v)}
                disabled={saving}
              />
            </div>
          </>
        )}
      </ModalBody>

      <ModalFooter>
        {hasOverride && (
          <Button
            variant="ghost"
            onClick={handleRemove}
            disabled={saving || loading}
            className="mr-auto text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
          >
            Remove override
          </Button>
        )}
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving || loading}>
          {saving ? "Saving..." : hasOverride ? "Update" : "Set quota"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm text-muted-foreground mb-1">{label}</label>
      {children}
    </div>
  );
}
