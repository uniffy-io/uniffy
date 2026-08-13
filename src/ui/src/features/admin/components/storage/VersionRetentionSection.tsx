import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAppSelector } from '@/app/hooks';
import { friendlyErrorMessage } from '@/config';
import { filesApi } from '@/features/files/api/filesApi';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/number-input';

const MIN_KEEP_VERSIONS = 1;
const MAX_KEEP_VERSIONS = 100;

export function VersionRetentionSection() {
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);

    const [keepVersions, setKeepVersions] = useState<number | null>(null);
    const [savedValue, setSavedValue] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        if (!organizationId) return;
        setLoading(true);
        setError(null);
        try {
            const response = await filesApi.getOrgFileVersionPolicy({ organizationId });
            const value = response.policy?.keepVersions ?? null;
            setKeepVersions(value);
            setSavedValue(value);
        } catch (err) {
            setError(
                friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
                    'Could not load version retention',
            );
        } finally {
            setLoading(false);
        }
    }, [organizationId]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const save = async () => {
        if (!organizationId || keepVersions === null || saving) return;
        setSaving(true);
        try {
            const response = await filesApi.updateOrgFileVersionPolicy({
                organizationId,
                keepVersions,
            });
            const value = response.policy?.keepVersions ?? keepVersions;
            setKeepVersions(value);
            setSavedValue(value);
            toast.success('Version retention saved');
        } catch (err) {
            toast.error(
                friendlyErrorMessage(err instanceof Error ? err.message : String(err)) ??
                    'Could not save version retention',
            );
        } finally {
            setSaving(false);
        }
    };

    if (loading && keepVersions === null && !error) {
        return (
            <div className="rounded-lg border border-border bg-card p-4 md:p-6 animate-pulse">
                <div className="h-4 w-48 bg-muted rounded mb-4" />
                <div className="h-3 w-64 bg-muted rounded" />
            </div>
        );
    }

    return (
        <div className="rounded-lg border border-border bg-card p-4 md:p-6">
            <h3 className="text-lg font-semibold text-foreground mb-1">Version Retention</h3>
            <p className="text-sm text-muted-foreground mb-4">
                How many versions of each file to keep. When a new version is saved, older
                ones beyond this limit are permanently deleted; the current version always
                survives.
            </p>

            {error ? (
                <p className="text-sm" style={{ color: 'var(--status-error)' }}>{error}</p>
            ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <NumberInput
                        value={keepVersions ?? ''}
                        min={MIN_KEEP_VERSIONS}
                        max={MAX_KEEP_VERSIONS}
                        disabled={saving}
                        onChange={(e) => {
                            const parsed = Number(e.target.value);
                            if (Number.isNaN(parsed)) return;
                            setKeepVersions(
                                Math.min(MAX_KEEP_VERSIONS, Math.max(MIN_KEEP_VERSIONS, Math.round(parsed))),
                            );
                        }}
                        className="w-28"
                        aria-label="Versions to keep per file"
                    />
                    <Button
                        variant="outline"
                        size="md"
                        onClick={() => void save()}
                        disabled={saving || keepVersions === null || keepVersions === savedValue}
                    >
                        {saving ? 'Saving...' : 'Save'}
                    </Button>
                </div>
            )}
        </div>
    );
}
