import { useEffect, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import {
    fetchUserQuota,
    upsertUserQuota,
    deleteUserQuota,
    fetchDisplayCurrency,
} from '@/features/admin/store/agentsGovernanceThunks';

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
    dailyLimit: '',
    monthlyLimit: '',
    dailyImageLimit: '',
    monthlyImageLimit: '',
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
        setLoading(true);
        dispatch(fetchUserQuota({ userId }))
            .unwrap()
            .then((quota) => {
                if (cancelled) return;
                if (quota) {
                    setHasOverride(true);
                    setForm({
                        dailyLimit: quota.dailyLimit ?? '',
                        monthlyLimit: quota.monthlyLimit ?? '',
                        dailyImageLimit: quota.dailyImageLimit?.toString() ?? '',
                        monthlyImageLimit: quota.monthlyImageLimit?.toString() ?? '',
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
            <div className="flex items-center justify-between p-6 pb-4">
                <h2 className="text-lg font-semibold text-foreground">
                    Agent quota for {displayName}
                </h2>
                <button
                    type="button"
                    onClick={onClose}
                    disabled={saving}
                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                    <X size={20} />
                </button>
            </div>

            <div className="px-6 pb-6 space-y-4">
                <p className="text-xs text-muted-foreground">
                    Caps the cost and image volume this user can consume across all agents in
                    this organization. Leave a field blank to inherit the org-wide budget.
                </p>

                {loading ? (
                    <div className="py-4 text-sm text-muted-foreground">Loading...</div>
                ) : (
                    <>
                        <FormRow label={`Daily spend cap (${displayCurrency})`}>
                            <Input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="No cap"
                                value={form.dailyLimit}
                                onChange={(e) => update('dailyLimit', e.target.value)}
                                disabled={saving}
                                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                        </FormRow>
                        <FormRow label={`Monthly spend cap (${displayCurrency})`}>
                            <Input
                                type="number"
                                min="0"
                                step="0.01"
                                placeholder="No cap"
                                value={form.monthlyLimit}
                                onChange={(e) => update('monthlyLimit', e.target.value)}
                                disabled={saving}
                                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                        </FormRow>
                        <FormRow label="Daily image cap">
                            <Input
                                type="number"
                                min="0"
                                placeholder="No cap"
                                value={form.dailyImageLimit}
                                onChange={(e) => update('dailyImageLimit', e.target.value)}
                                disabled={saving}
                                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                        </FormRow>
                        <FormRow label="Monthly image cap">
                            <Input
                                type="number"
                                min="0"
                                placeholder="No cap"
                                value={form.monthlyImageLimit}
                                onChange={(e) => update('monthlyImageLimit', e.target.value)}
                                disabled={saving}
                                className="[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                            />
                        </FormRow>
                        <div className="flex items-center justify-between gap-4 pt-2">
                            <div className="min-w-0">
                                <div className="text-sm font-medium">Hard limit</div>
                                <p className="text-xs text-muted-foreground">
                                    Reject requests when over cap. When off, allow but warn.
                                </p>
                            </div>
                            <ToggleSwitch
                                enabled={form.hardLimit}
                                onChange={(v) => update('hardLimit', v)}
                                disabled={saving}
                            />
                        </div>
                    </>
                )}
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-muted/30">
                <div>
                    {hasOverride && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleRemove}
                            disabled={saving || loading}
                            className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                        >
                            Remove override
                        </Button>
                    )}
                </div>
                <div className="flex gap-3">
                    <Button variant="outline" onClick={onClose} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={saving || loading}>
                        {saving ? 'Saving...' : hasOverride ? 'Update' : 'Set quota'}
                    </Button>
                </div>
            </div>
        </Modal>
    );
}

function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">{label}</label>
            {children}
        </div>
    );
}
