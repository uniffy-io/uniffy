import { useEffect, useState } from 'react';
import {
    ShieldCheck,
    NotePencil,
    FolderSimple,
    CalendarDots,
    WarningCircle,
    Kanban,
    Robot,
} from '@phosphor-icons/react';
import { usePermissionDefaults, getContentTypeLabel } from '@/features/admin/hooks/useAdminHooks';
import { ContentType, AccessMode } from '@uniffy/proto/common/v1/common_pb';
import { AccessModeSelector } from '@/features/permissions';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';
import type { SerializedContentTypeDefaults } from '@/features/admin/store/adminSlice';

const CONTENT_TYPE_ICONS: Record<number, typeof NotePencil> = {
    [ContentType.NOTE]: NotePencil,
    [ContentType.FILE]: FolderSimple,
    [ContentType.PROJECT]: Kanban,
    [ContentType.CALENDAR_EVENT]: CalendarDots,
    [ContentType.AGENT]: Robot,
};

const ALL_CONTENT_TYPES = [
    ContentType.NOTE,
    ContentType.FILE,
    ContentType.PROJECT,
    ContentType.CALENDAR_EVENT,
    ContentType.AGENT,
];

interface ContentTypeCardProps {
    contentType: number;
    defaults: SerializedContentTypeDefaults | undefined;
    onUpdate: (contentType: number, updates: Partial<SerializedContentTypeDefaults>) => Promise<void>;
}

function ContentTypeCard({ contentType, defaults, onUpdate }: ContentTypeCardProps) {
    const [saving, setSaving] = useState(false);
    const Icon = CONTENT_TYPE_ICONS[contentType] || NotePencil;

    const handleChange = async (next: { accessMode: AccessMode; baselineRole: number | null }) => {
        setSaving(true);
        try {
            await onUpdate(contentType, {
                defaultAccessMode: next.accessMode,
                defaultBaselineRole: next.baselineRole,
            });
        } finally {
            setSaving(false);
        }
    };

    const updatedIso = defaults?.updatedAt
        ? new Date(Number(defaults.updatedAt.seconds) * 1000).toISOString()
        : undefined;

    return (
        <div className="p-4 rounded-lg border border-border bg-card">
            <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-primary/10">
                    <Icon size={20} weight="duotone" className="text-primary" />
                </div>
                <div className="flex-1">
                    <h3 className="font-medium">{getContentTypeLabel(contentType)}</h3>
                </div>
                {saving && (
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                )}
            </div>

            <AccessModeSelector
                value={{
                    accessMode: (defaults?.defaultAccessMode ?? AccessMode.OWNER_ONLY) as AccessMode,
                    baselineRole: defaults?.defaultBaselineRole ?? null,
                }}
                onChange={handleChange}
            />

            {updatedIso && (
                <p className="text-xs text-muted-foreground mt-3">
                    Updated {formatRelativeTime(updatedIso)}
                </p>
            )}
        </div>
    );
}

export function PermissionDefaultsSection() {
    const { defaults, loading, error, refresh, update, dismissError } = usePermissionDefaults();

    useEffect(() => {
        refresh();
    }, [refresh]);

    const defaultsByType = new Map(defaults.map((d) => [d.contentType, d]));

    return (
        <div className="space-y-6">
            <div>
                <div className="flex items-center gap-3 mb-2">
                    <ShieldCheck size={24} weight="duotone" className="text-primary shrink-0" />
                    <h1 className="text-xl md:text-2xl font-bold">Permission Defaults</h1>
                </div>
                <p className="text-muted-foreground text-sm">
                    Default access mode for new content created in this organization.
                    <span className="hidden sm:inline"> These can be overridden per item.</span>
                </p>
            </div>

            {error && (
                <div className="p-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-red-800 dark:text-red-400">
                            <WarningCircle size={20} weight="fill" />
                            {error}
                        </div>
                        <button
                            type="button"
                            onClick={dismissError}
                            className="text-sm text-red-800 dark:text-red-400 hover:underline"
                        >
                            Dismiss
                        </button>
                    </div>
                </div>
            )}

            {loading ? (
                <div className="py-12 text-center">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-muted-foreground">Loading permission defaults...</p>
                </div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2">
                    {ALL_CONTENT_TYPES.map((ct) => (
                        <ContentTypeCard
                            key={ct}
                            contentType={ct}
                            defaults={defaultsByType.get(ct)}
                            onUpdate={update}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
