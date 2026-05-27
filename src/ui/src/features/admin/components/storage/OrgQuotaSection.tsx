import { useState } from 'react';
import { PencilSimple } from '@phosphor-icons/react';
import { useAppSelector } from '@/app/hooks';
import { Button } from '@/components/ui/button';
import { StorageProgressBar } from '@/features/admin/components/storage/StorageProgressBar';
import { OrgQuotaEditDialog } from '@/features/admin/components/storage/OrgQuotaEditDialog';
import { formatFileSize } from '@/shared/utils/dateFormatting';
import { cn } from '@/shared/utils/cn';

export function OrgQuotaSection() {
    const [editOpen, setEditOpen] = useState(false);
    const orgQuota = useAppSelector((state) => state.admin.orgQuota);
    const totalUsedBytes = useAppSelector((state) => state.admin.orgTotalUsedBytes);
    const loading = useAppSelector((state) => state.admin.orgQuotaLoading);

    if (loading && !orgQuota) {
        return (
            <div className="rounded-lg border border-border bg-card p-4 md:p-6 animate-pulse">
                <div className="h-4 w-48 bg-muted rounded mb-4" />
                <div className="h-2.5 w-full bg-muted rounded mb-2" />
                <div className="h-3 w-32 bg-muted rounded" />
            </div>
        );
    }

    if (!orgQuota) return null;

    return (
        <>
            <div className="rounded-lg border border-border bg-card p-4 md:p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-foreground">Organization Storage</h3>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditOpen(true)}
                    >
                        <PencilSimple size={16} weight="duotone" className="mr-1.5" />
                        Edit
                    </Button>
                </div>

                <StorageProgressBar
                    usedBytes={totalUsedBytes}
                    quotaBytes={orgQuota.orgQuotaBytes}
                    warnAtPercent={orgQuota.warnAtPercent}
                    size="lg"
                    className="mb-4"
                />

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <InfoCard
                        label="Organization Limit"
                        value={orgQuota.orgQuotaBytes !== null
                            ? formatFileSize(orgQuota.orgQuotaBytes) : 'Unlimited'}
                    />
                    <InfoCard
                        label="Default User Limit"
                        value={orgQuota.defaultUserQuotaBytes !== null
                            ? formatFileSize(orgQuota.defaultUserQuotaBytes) : 'Unlimited'}
                    />
                    <InfoCard
                        label="Warning Threshold"
                        value={`${orgQuota.warnAtPercent}%`}
                    />
                    <InfoCard
                        label="Enforcement"
                        value={orgQuota.enforce ? 'Active' : 'Warn only'}
                        valueClass={orgQuota.enforce
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-yellow-600 dark:text-yellow-400'}
                    />
                </div>
            </div>

            <OrgQuotaEditDialog
                open={editOpen}
                onClose={() => setEditOpen(false)}
            />
        </>
    );
}

function InfoCard({
    label,
    value,
    valueClass,
}: {
    label: string;
    value: string;
    valueClass?: string;
}) {
    return (
        <div className="rounded-md bg-muted/50 p-3">
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className={cn('text-sm font-medium text-foreground', valueClass)}>{value}</p>
        </div>
    );
}
