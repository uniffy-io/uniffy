import { useState, useEffect, useMemo } from 'react';
import { X } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import {
    setUserStorageQuotaOverride,
    removeUserStorageQuotaOverride,
    fetchOrgStorageUsage,
    fetchUserStorageQuotaOverrides,
} from '@/features/admin/store/adminThunks';
import { ByteInput } from '@/features/admin/components/storage/ByteInput';
import { StorageProgressBar } from '@/features/admin/components/storage/StorageProgressBar';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { cn } from '@/shared/utils/cn';

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
    const [note, setNote] = useState('');
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
                setQuotaBytes(userInfo.override.quotaBytes);
                setNote(userInfo.override.note || '');
            } else {
                setQuotaBytes(orgQuota?.defaultUserQuotaBytes ?? null);
                setNote('');
            }
        }
    }, [open, userInfo, orgQuota]);

    if (!open || !userId) return null;

    async function handleSave() {
        if (!userId || quotaBytes === null) return;
        setSaving(true);
        try {
            await dispatch(setUserStorageQuotaOverride({
                userId,
                quotaBytes,
                note: note || undefined,
            })).unwrap();
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

    const displayName = userInfo?.member?.displayName || 'Unknown user';
    const usedBytes = userInfo?.usage?.usedBytes ?? 0;
    const hasOverride = !!userInfo?.override;

    return (
        <Modal onClose={onClose} closeDisabled={saving} maxWidth="max-w-md">
            <div className="flex items-center justify-between p-6 pb-4">
                <h2 className="text-lg font-semibold text-foreground">
                    Set Quota for {displayName}
                </h2>
                <button
                    onClick={onClose}
                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                    <X size={20} />
                </button>
            </div>

            <div className="px-6 pb-6 space-y-4">
                <div className="p-3 rounded-md bg-muted/50">
                    <p className="text-xs text-muted-foreground mb-2">Current Usage</p>
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
                    label="Custom Quota"
                    allowUnlimited={false}
                />

                <div className="space-y-1">
                    <label className="text-sm font-medium text-foreground">Note (optional)</label>
                    <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        maxLength={500}
                        rows={2}
                        placeholder="Why is this override needed?"
                        className={cn(
                            'w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
                            'placeholder:text-muted-foreground',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                            'resize-none',
                        )}
                    />
                </div>
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/30">
                <div>
                    {hasOverride && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleRemoveOverride}
                            disabled={saving}
                            className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                        >
                            Remove Override
                        </Button>
                    )}
                </div>
                <div className="flex gap-3">
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSave}
                        disabled={saving || quotaBytes === null}
                    >
                        {saving ? 'Saving...' : 'Save Override'}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}
