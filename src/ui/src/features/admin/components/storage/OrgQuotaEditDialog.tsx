import { useState, useEffect } from "react";
import { X } from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { setOrgStorageQuota, fetchOrgStorageUsage } from "@/features/admin/store/adminThunks";
import { ByteInput } from "@/features/admin/components/storage/ByteInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

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
      <div className="flex items-center justify-between p-6 pb-4">
        <h2 className="text-lg font-semibold text-foreground">Edit Storage Quota</h2>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      <div className="px-6 pb-6 space-y-5">
        <ByteInput
          value={orgQuotaBytes}
          onChange={setOrgQuotaBytes}
          label="Organization Storage Limit"
          allowUnlimited
        />

        <ByteInput
          value={defaultUserQuotaBytes}
          onChange={setDefaultUserQuotaBytes}
          label="Default Per-User Limit"
          allowUnlimited
        />

        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">Warning Threshold (%)</label>
          <Input
            type="text"
            inputMode="numeric"
            value={String(warnAtPercent)}
            onChange={handlePercentChange}
          />
          <p className="text-xs text-muted-foreground">
            Users see a warning when they reach this percentage of their quota.
          </p>
        </div>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enforce}
            onChange={(e) => setEnforce(e.target.checked)}
            className="rounded border-border"
          />
          <span className="text-sm text-foreground">
            Enforce quotas (block uploads when exceeded)
          </span>
        </label>
      </div>

      <div className="flex justify-end gap-3 px-6 py-4 border-t border-border bg-muted/30">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </Modal>
  );
}
