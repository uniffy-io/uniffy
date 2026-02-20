/**
 * Permission Defaults Section
 *
 * Admin UI for configuring organization-wide permission defaults per content type.
 */

import { useEffect, useState } from 'react';
import {
    ShieldCheck,
    NotePencil,
    FolderSimple,
    CalendarDots,
    WarningCircle,
    Kanban,
} from '@phosphor-icons/react';
import { usePermissionDefaults, getContentTypeLabel } from '@/features/admin/hooks/useAdminHooks';
import { ContentType, VisibilityScope } from '@/gen/common/v1/common_pb';
import type { SerializedContentTypeDefaults } from '@/features/admin/store/adminSlice';
import { Select, type SelectOption } from '@/components/ui/select';

// Visibility scope options
const VISIBILITY_OPTIONS: SelectOption<number>[] = [
    { value: VisibilityScope.PRIVATE, label: 'Private' },
    { value: VisibilityScope.GROUP, label: 'Group' },
    { value: VisibilityScope.ORGANIZATION, label: 'Organization' },
];

const CONTENT_TYPE_ICONS: Record<number, typeof NotePencil> = {
    [ContentType.NOTE]: NotePencil,
    [ContentType.FILE]: FolderSimple,
    [ContentType.PROJECT]: Kanban,
    [ContentType.CALENDAR_EVENT]: CalendarDots,
};

const ALL_CONTENT_TYPES = [
    ContentType.NOTE,
    ContentType.FILE,
    ContentType.PROJECT,
    ContentType.CALENDAR_EVENT,
];

interface ContentTypeCardProps {
    contentType: number;
    defaults: SerializedContentTypeDefaults | undefined;
    onUpdate: (contentType: number, updates: Partial<SerializedContentTypeDefaults>) => Promise<void>;
}

function ContentTypeCard({ contentType, defaults, onUpdate }: ContentTypeCardProps) {
    const [saving, setSaving] = useState(false);
    const Icon = CONTENT_TYPE_ICONS[contentType] || NotePencil;

    // Local state for toggles
    const [membersCanView, setMembersCanView] = useState(defaults?.membersCanView ?? true);
    const [membersCanEdit, setMembersCanEdit] = useState(defaults?.membersCanEdit ?? false);
    const [membersCanDelete, setMembersCanDelete] = useState(defaults?.membersCanDelete ?? false);
    const [membersCanShare, setMembersCanShare] = useState(defaults?.membersCanShare ?? false);
    const [defaultVisibility, setDefaultVisibility] = useState(
        defaults?.defaultVisibility ?? VisibilityScope.PRIVATE
    );

    // Sync with props
    useEffect(() => {
        if (defaults) {
            setMembersCanView(defaults.membersCanView);
            setMembersCanEdit(defaults.membersCanEdit);
            setMembersCanDelete(defaults.membersCanDelete);
            setMembersCanShare(defaults.membersCanShare);
            setDefaultVisibility(defaults.defaultVisibility);
        }
    }, [defaults]);

    const handleToggle = async (
        field: 'membersCanView' | 'membersCanEdit' | 'membersCanDelete' | 'membersCanShare',
        value: boolean
    ) => {
        const setters = {
            membersCanView: setMembersCanView,
            membersCanEdit: setMembersCanEdit,
            membersCanDelete: setMembersCanDelete,
            membersCanShare: setMembersCanShare,
        };

        setters[field](value);
        setSaving(true);

        try {
            await onUpdate(contentType, { [field]: value });
        } catch {
            // Revert on error
            setters[field](!value);
        } finally {
            setSaving(false);
        }
    };

    const handleVisibilityChange = async (value: number) => {
        const oldValue = defaultVisibility;
        setDefaultVisibility(value);
        setSaving(true);

        try {
            await onUpdate(contentType, { defaultVisibility: value });
        } catch {
            setDefaultVisibility(oldValue);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="p-4 rounded-lg border border-border bg-card">
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
                <div className="p-2 rounded-lg bg-primary/10">
                    <Icon size={20} weight="duotone" className="text-primary" />
                </div>
                <div className="flex-1">
                    <h3 className="font-medium">{getContentTypeLabel(contentType)}</h3>
                    <p className="text-xs text-muted-foreground">
                        Member permissions for organization-visible {getContentTypeLabel(contentType).toLowerCase()}
                    </p>
                </div>
                {saving && (
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                )}
            </div>

            {/* Default visibility */}
            <div className="mb-4">
                <label className="block text-sm font-medium mb-2">Default Visibility</label>
                <Select
                    value={defaultVisibility}
                    onChange={handleVisibilityChange}
                    options={VISIBILITY_OPTIONS}
                    className="w-full"
                />
                <p className="text-xs text-muted-foreground mt-1">
                    New content will be created with this visibility by default
                </p>
            </div>

            {/* Permission toggles */}
            <div className="space-y-3">
                <p className="text-sm font-medium text-muted-foreground">
                    Organization members can:
                </p>

                <PermissionToggle
                    label="View"
                    description="View organization-visible content"
                    checked={membersCanView}
                    onChange={(v) => handleToggle('membersCanView', v)}
                />

                <PermissionToggle
                    label="Edit"
                    description="Edit organization-visible content"
                    checked={membersCanEdit}
                    onChange={(v) => handleToggle('membersCanEdit', v)}
                />

                <PermissionToggle
                    label="Delete"
                    description="Delete organization-visible content"
                    checked={membersCanDelete}
                    onChange={(v) => handleToggle('membersCanDelete', v)}
                />

                <PermissionToggle
                    label="Share"
                    description="Share organization-visible content with others"
                    checked={membersCanShare}
                    onChange={(v) => handleToggle('membersCanShare', v)}
                />
            </div>
        </div>
    );
}

interface PermissionToggleProps {
    label: string;
    description: string;
    checked: boolean;
    onChange: (value: boolean) => void;
}

function PermissionToggle({ label, description, checked, onChange }: PermissionToggleProps) {
    return (
        <label className="flex items-center justify-between py-2 cursor-pointer group">
            <div>
                <span className="text-sm font-medium">{label}</span>
                <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                onClick={() => onChange(!checked)}
                className={`
                    relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full
                    border-2 border-transparent transition-colors duration-200 ease-in-out
                    focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2
                    ${checked ? 'bg-primary' : 'bg-muted'}
                `}
            >
                <span
                    className={`
                        pointer-events-none inline-block h-5 w-5 transform rounded-full
                        bg-white shadow ring-0 transition duration-200 ease-in-out
                        ${checked ? 'translate-x-5' : 'translate-x-0'}
                    `}
                />
            </button>
        </label>
    );
}

export function PermissionDefaultsSection() {
    const { defaults, loading, error, refresh, update, dismissError } = usePermissionDefaults();

    // Fetch on mount
    useEffect(() => {
        refresh();
    }, [refresh]);

    // Create a map of defaults by content type
    const defaultsByType = new Map(defaults.map((d) => [d.contentType, d]));

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <div className="flex items-center gap-3 mb-2">
                    <ShieldCheck size={24} weight="duotone" className="text-primary" />
                    <h1 className="text-2xl font-bold">Permission Defaults</h1>
                </div>
                <p className="text-muted-foreground">
                    Configure default permissions for each content type when shared at the organization level.
                    These settings apply to all new content and can be overridden per-item.
                </p>
            </div>

            {/* Error banner */}
            {error && (
                <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm text-red-500">
                            <WarningCircle size={20} weight="fill" />
                            {error}
                        </div>
                        <button
                            type="button"
                            onClick={dismissError}
                            className="text-sm text-red-500 hover:underline"
                        >
                            Dismiss
                        </button>
                    </div>
                </div>
            )}

            {/* Loading state */}
            {loading ? (
                <div className="py-12 text-center">
                    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-muted-foreground">Loading permission defaults...</p>
                </div>
            ) : (
                /* Content type cards */
                <div className="grid gap-4 md:grid-cols-2">
                    {ALL_CONTENT_TYPES.map((contentType) => (
                        <ContentTypeCard
                            key={contentType}
                            contentType={contentType}
                            defaults={defaultsByType.get(contentType)}
                            onUpdate={update}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

