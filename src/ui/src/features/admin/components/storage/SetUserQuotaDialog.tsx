import { useState, useEffect, useMemo } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import {
  setUserStorageQuotaOverride,
  removeUserStorageQuotaOverride,
  fetchOrgStorageUsage,
  fetchUserStorageQuotaOverrides,
} from "@/features/admin/store/adminThunks";
import { ByteInput } from "@/features/admin/components/storage/ByteInput";
import { StorageProgressBar } from "@/features/admin/components/storage/StorageProgressBar";
import { Button } from "@/components/ui/button";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "@/components/ui/modal";
import { Textarea } from "@/components/ui/textarea";

interface SetUserQuotaDialogProps {
  open: boolean;
  userId: string | null;
  onClose: () => void;
}

export function SetUserQuotaDialog({ open, userId, onClose }: SetUserQuotaDialogProps) {
  const dispatch = useAppDispatch();
  const members = useAppSelector((state) => state.admin.members);
  const userUsageList = useAppSelector((state) => state.admin.userUsageList);
  const userOverrides = useAppSelector((state) => state.admin.userOverrides);
  const orgQuota = useAppSelector((state) => state.admin.orgQuota);

  const [quotaBytes, setQuotaBytes] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const userInfo = useMemo(() => {
    if (!userId) return null;
    const member = members.find((m) => m.userId === userId);
    const usage = userUsageList.find((u) => u.userId === userId);
    const override = userOverrides.find((o) => o.userId === userId);
    return { member, usage, override };
  }, [userId, members, userUsageList, userOverrides]);

  useEffect(() => {
    if (open && userInfo) {
      if (userInfo.override) {
        // eslint-disable-next-line react/react-compiler -- seeding the form when the dialog opens on a member, and again if their override arrives later
        setQuotaBytes(userInfo.override.quotaBytes);
        setNote(userInfo.override.note || "");
      } else {
        setQuotaBytes(orgQuota?.defaultUserQuotaBytes ?? null);
        setNote("");
      }
    }
  }, [open, userInfo, orgQuota]);

  if (!open || !userId) return null;

  async function handleSave() {
    if (!userId || quotaBytes === null) return;
    setSaving(true);
    try {
      await dispatch(
        setUserStorageQuotaOverride({
          userId,
          quotaBytes,
          note: note || undefined,
        }),
      ).unwrap();
      await Promise.all([
        dispatch(fetchOrgStorageUsage()),
        dispatch(fetchUserStorageQuotaOverrides()),
      ]);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function handleRemoveOverride() {
    if (!userId) return;
    setSaving(true);
    try {
      await dispatch(removeUserStorageQuotaOverride({ userId })).unwrap();
      await Promise.all([
        dispatch(fetchOrgStorageUsage()),
        dispatch(fetchUserStorageQuotaOverrides()),
      ]);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const displayName = userInfo?.member?.displayName || "Unknown user";
  const usedBytes = userInfo?.usage?.usedBytes ?? 0;
  const hasOverride = !!userInfo?.override;

  return (
    <Modal onClose={onClose} closeDisabled={saving} maxWidth="max-w-md">
      <ModalHeader
        title={`Set quota for ${displayName}`}
        description="A custom limit replaces the default per-user quota for this member."
      />

      <ModalBody>
        <div className="p-3 rounded-md bg-muted/50">
          <p className="text-xs text-muted-foreground mb-2">Current usage</p>
          <StorageProgressBar
            usedBytes={usedBytes}
            quotaBytes={userInfo?.usage?.effectiveQuotaBytes ?? null}
            showLabels={true}
            size="sm"
          />
        </div>

        <ByteInput
          value={quotaBytes}
          onChange={setQuotaBytes}
          label="Custom quota"
          allowUnlimited={false}
        />

        <div>
          <label className="block text-sm text-muted-foreground mb-1">Note (optional)</label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Why is this override needed?"
          />
        </div>
      </ModalBody>

      <ModalFooter>
        {hasOverride && (
          <Button
            variant="ghost"
            onClick={handleRemoveOverride}
            disabled={saving}
            className="mr-auto text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
          >
            Remove override
          </Button>
        )}
        <Button variant="ghost" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving || quotaBytes === null}>
          {saving ? "Saving..." : "Save override"}
        </Button>
      </ModalFooter>
    </Modal>
  );
}
