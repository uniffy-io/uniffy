import { useState, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { setOrgStorageQuota, fetchOrgStorageUsage } from "@/features/admin/store/adminThunks";
import { ByteInput } from "@/features/admin/components/storage/ByteInput";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";

interface OrgQuotaEditDialogProps {
  open: boolean;
  onClose: () => void;
}

export function OrgQuotaEditDialog({ open, onClose }: OrgQuotaEditDialogProps) {
  const dispatch = useAppDispatch();
  const orgQuota = useAppSelector((state) => state.admin.orgQuota);

  const [orgQuotaBytes, setOrgQuotaBytes] = useState<number | null>(null);
  const [defaultUserQuotaBytes, setDefaultUserQuotaBytes] = useState<number | null>(null);
  const [warnAtPercent, setWarnAtPercent] = useState(80);
  const [enforce, setEnforce] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (orgQuota && open) {
      // eslint-disable-next-line react/react-compiler -- seeding the form when the dialog opens, and again if the stored quota arrives later
      setOrgQuotaBytes(orgQuota.orgQuotaBytes);
      setDefaultUserQuotaBytes(orgQuota.defaultUserQuotaBytes);
      setWarnAtPercent(orgQuota.warnAtPercent);
      setEnforce(orgQuota.enforce);
    }
  }, [orgQuota, open]);

  if (!open) return null;

  async function handleSave() {
    setSaving(true);
    try {
      await dispatch(
        setOrgStorageQuota({
          orgQuotaBytes,
          defaultUserQuotaBytes,
          warnAtPercent,
          enforce,
        }),
      ).unwrap();
      await dispatch(fetchOrgStorageUsage());
      onClose();
    } finally {
      setSaving(false);
    }
  }

  function handlePercentChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    if (raw !== "" && !/^\d*$/.test(raw)) return;
    const num = parseInt(raw, 10);
    if (raw === "") {
      setWarnAtPercent(0);
    } else if (!isNaN(num) && num >= 0 && num <= 100) {
      setWarnAtPercent(num);
    }
  }

  return (
    <Modal onClose={onClose} closeDisabled={saving} maxWidth="max-w-lg">
      <ModalHeader title="Edit storage quota" />

      <ModalBody>
        <ByteInput
          value={orgQuotaBytes}
          onChange={setOrgQuotaBytes}
          label="Organization storage limit"
          allowUnlimited
        />

        <ByteInput
          value={defaultUserQuotaBytes}
          onChange={setDefaultUserQuotaBytes}
          label="Default per-user limit"
          allowUnlimited
        />

        <div>
          <label className="block text-sm text-muted-foreground mb-1">Warning threshold (%)</label>
          <Input
            type="text"
            inputMode="numeric"
            value={String(warnAtPercent)}
            onChange={handlePercentChange}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            Users see a warning when they reach this percentage of their quota.
          </p>
        </div>

        <Checkbox
          label="Enforce quotas (block uploads when exceeded)"
          checked={enforce}
          onChange={(e) => setEnforce(e.target.checked)}
        />
      </ModalBody>

      <ModalFooter>
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
