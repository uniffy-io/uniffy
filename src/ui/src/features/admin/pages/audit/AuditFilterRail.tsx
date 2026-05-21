/**
 * AuditFilterRail
 *
 * Filter sidebar on /admin/audit-logs. Owns the date range presets,
 * actor picker, action multi-select grouped by domain, resource type
 * multi-select, and resource id free-text. Renders inline on desktop
 * and inside a Drawer on tablet / mobile (the page hosts the Drawer).
 */

import { useMemo, useRef, useState } from 'react';
import { CaretDown, MagnifyingGlass } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { SubjectPicker } from '@/components/subject/SubjectPicker';
import { useSubjectResolver } from '@/components/subject/hooks/useSubjectResolver';
import { SubjectAvatar } from '@/components/subject/SubjectAvatar';
import { cn } from '@/shared/utils/cn';
import { isValidUrn } from '@/shared/utils/urn';
import type { AuditFilter } from '@/features/admin/store/auditSlice';
import { ACTION_GROUPS, RESOURCE_TYPES } from '@/features/admin/pages/audit/actionCatalog';
import {
    presetBounds,
    type DateRangePreset,
} from '@/features/admin/pages/audit/filterUrl';

interface AuditFilterRailProps {
    filter: AuditFilter;
    onChange: (next: AuditFilter) => void;
    /** Set when this rail renders inside the mobile drawer. */
    compact?: boolean;
}

const DATE_PRESETS: { value: DateRangePreset; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: '7d', label: '7d' },
    { value: '30d', label: '30d' },
    { value: '90d', label: '90d' },
    { value: 'custom', label: 'Custom' },
    { value: 'all', label: 'All' },
];

function detectActivePreset(filter: AuditFilter): DateRangePreset {
    if (!filter.fromTime && !filter.toTime) return 'all';
    for (const preset of ['today', '7d', '30d', '90d'] as const) {
        const bounds = presetBounds(preset);
        if (
            bounds.fromTime &&
            filter.fromTime &&
            Math.abs(
                new Date(bounds.fromTime).getTime() -
                    new Date(filter.fromTime).getTime(),
            ) < 60_000
        ) {
            return preset;
        }
    }
    return 'custom';
}

export function AuditFilterRail({ filter, onChange, compact }: AuditFilterRailProps) {
    const activePreset = useMemo(() => detectActivePreset(filter), [filter]);
    const [actorOpen, setActorOpen] = useState(false);
    const actorRef = useRef<HTMLButtonElement>(null);
    const { subjects } = useSubjectResolver(filter.actorUserId ? [filter.actorUserId] : []);
    const actorSubject = subjects[0];

    const applyPreset = (preset: DateRangePreset) => {
        if (preset === 'custom') {
            onChange(filter);
            return;
        }
        const bounds = presetBounds(preset);
        onChange({ ...filter, fromTime: bounds.fromTime, toTime: bounds.toTime });
    };

    const toggleAction = (value: string) => {
        const next = filter.actions.includes(value)
            ? filter.actions.filter((a) => a !== value)
            : [...filter.actions, value];
        onChange({ ...filter, actions: next });
    };

    return (
        <div className={cn('flex flex-col gap-6 p-4', compact && 'pb-8')}>
            <div className="space-y-2">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Date range
                </h2>
                <div className="flex flex-wrap gap-1.5">
                    {DATE_PRESETS.map((preset) => (
                        <Button
                            key={preset.value}
                            variant={activePreset === preset.value ? 'default' : 'secondary'}
                            size="xs"
                            onClick={() => applyPreset(preset.value)}
                        >
                            {preset.label}
                        </Button>
                    ))}
                </div>
                {activePreset === 'custom' && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                        <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                                From
                            </label>
                            <DatePicker
                                value={filter.fromTime?.slice(0, 10) ?? ''}
                                onChange={(value) =>
                                    onChange({
                                        ...filter,
                                        fromTime: value ? new Date(value).toISOString() : null,
                                    })
                                }
                            />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                                To
                            </label>
                            <DatePicker
                                value={filter.toTime?.slice(0, 10) ?? ''}
                                onChange={(value) =>
                                    onChange({
                                        ...filter,
                                        toTime: value
                                            ? new Date(`${value}T23:59:59`).toISOString()
                                            : null,
                                    })
                                }
                            />
                        </div>
                    </div>
                )}
            </div>

            <div className="space-y-2">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Actor
                </h2>
                <button
                    ref={actorRef}
                    type="button"
                    onClick={() => setActorOpen((open) => !open)}
                    className={cn(
                        'flex items-center gap-2 w-full h-10 rounded-md border border-input bg-background',
                        'px-3 text-sm text-left transition-colors',
                        'hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                >
                    {actorSubject ? (
                        <>
                            <SubjectAvatar subject={actorSubject} size="xs" />
                            <span className="flex-1 truncate text-foreground">
                                {actorSubject.name}
                            </span>
                        </>
                    ) : (
                        <span className="flex-1 text-muted-foreground">Any actor</span>
                    )}
                    <CaretDown size={14} className="text-muted-foreground shrink-0" />
                </button>
                {actorOpen && (
                    <SubjectPicker
                        mode="single"
                        subjectTypes="users"
                        value={filter.actorUserId ? [filter.actorUserId] : []}
                        onChange={(ids) => {
                            onChange({ ...filter, actorUserId: ids[0] ?? null });
                            setActorOpen(false);
                        }}
                        onClose={() => setActorOpen(false)}
                        portal
                        anchorRef={actorRef}
                        autoFocus
                    />
                )}
                {filter.actorUserId && (
                    <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => onChange({ ...filter, actorUserId: null })}
                    >
                        Clear actor
                    </button>
                )}
            </div>

            <div className="space-y-2">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Actions
                </h2>
                <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-background/60 divide-y divide-border">
                    {ACTION_GROUPS.map((group) => (
                        <details key={group.domain} className="group">
                            <summary
                                className={cn(
                                    'flex items-center justify-between gap-2 px-3 py-2 cursor-pointer select-none text-sm font-medium',
                                    'hover:bg-muted/40',
                                )}
                            >
                                <span>{group.label}</span>
                                <CaretDown
                                    size={12}
                                    className="text-muted-foreground transition-transform group-open:rotate-180"
                                />
                            </summary>
                            <div className="px-2 pb-2 space-y-0.5">
                                {group.actions.map((action) => {
                                    const checked = filter.actions.includes(action.value);
                                    return (
                                        <div
                                            key={action.value}
                                            className="px-2 py-1 rounded hover:bg-muted/40"
                                        >
                                            <Checkbox
                                                checked={checked}
                                                onChange={() => toggleAction(action.value)}
                                                label={action.label}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </details>
                    ))}
                </div>
                {filter.actions.length > 0 && (
                    <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => onChange({ ...filter, actions: [] })}
                    >
                        Clear {filter.actions.length} action{filter.actions.length === 1 ? '' : 's'}
                    </button>
                )}
            </div>

            <div className="space-y-2">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Resource type
                </h2>
                <div className="grid grid-cols-2 gap-1.5">
                    {RESOURCE_TYPES.map((rt) => {
                        const active = filter.resourceType === rt.value;
                        return (
                            <Button
                                key={rt.value}
                                variant={active ? 'default' : 'secondary'}
                                size="xs"
                                onClick={() =>
                                    onChange({
                                        ...filter,
                                        resourceType: active ? null : rt.value,
                                    })
                                }
                            >
                                {rt.label}
                            </Button>
                        );
                    })}
                </div>
            </div>

            <div className="space-y-2">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Resource URN
                </h2>
                <ResourceUrnInput
                    value={filter.resourceId}
                    onChange={(resourceId) => onChange({ ...filter, resourceId })}
                />
            </div>
        </div>
    );
}

interface ResourceUrnInputProps {
    value: string | null;
    onChange: (next: string | null) => void;
}

function ResourceUrnInput({ value, onChange }: ResourceUrnInputProps) {
    const [draft, setDraft] = useState(value ?? '');
    const [error, setError] = useState<string | null>(null);

    const apply = () => {
        if (!draft) {
            onChange(null);
            setError(null);
            return;
        }
        if (draft.startsWith('urn:')) {
            if (!isValidUrn(draft)) {
                setError('Not a valid URN');
                return;
            }
            const idPart = draft.split(':').pop();
            if (!idPart) {
                setError('Could not extract id');
                return;
            }
            onChange(idPart);
            setError(null);
            return;
        }
        onChange(draft);
        setError(null);
    };

    return (
        <div className="space-y-1">
            <div className="relative">
                <MagnifyingGlass
                    size={14}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={apply}
                    onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                            event.preventDefault();
                            apply();
                        }
                    }}
                    placeholder="Paste URN or UUID"
                    className="pl-8"
                />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    );
}
