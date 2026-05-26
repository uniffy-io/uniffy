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
import {
    DATE_PRESETS,
    detectActivePreset,
    presetBounds,
    type DateRangePreset,
} from '@/components/audit/presets';
import type {
    ActionGroup,
    AuditFilter,
    AuditFilterFields,
    OrganizationOption,
} from '@/components/audit/types';

export interface AuditFilterRailProps {
    filter: AuditFilter;
    onChange: (next: AuditFilter) => void;
    fields: AuditFilterFields;
    actionGroups: ActionGroup[];
    resourceTypes?: readonly { value: string; label: string }[];
    organizationOptions?: OrganizationOption[];
    /** Render inside a Drawer instead of inline (extra bottom padding). */
    compact?: boolean;
}

export function AuditFilterRail({
    filter,
    onChange,
    fields,
    actionGroups,
    resourceTypes,
    organizationOptions,
    compact,
}: AuditFilterRailProps) {
    return (
        <div className={cn('flex flex-col gap-6 p-4', compact && 'pb-8')}>
            {fields.dateRange && <DateRangeSection filter={filter} onChange={onChange} />}
            {fields.organization && (
                <OrganizationSection
                    filter={filter}
                    onChange={onChange}
                    options={organizationOptions ?? []}
                />
            )}
            {fields.actor && <ActorSection filter={filter} onChange={onChange} />}
            {fields.actions && (
                <ActionsSection
                    filter={filter}
                    onChange={onChange}
                    groups={actionGroups}
                />
            )}
            {fields.resourceType && resourceTypes && resourceTypes.length > 0 && (
                <ResourceTypeSection
                    filter={filter}
                    onChange={onChange}
                    options={resourceTypes}
                />
            )}
            {fields.resourceUrn && (
                <ResourceUrnSection filter={filter} onChange={onChange} />
            )}
        </div>
    );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
    return (
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {children}
        </h2>
    );
}

interface SubProps {
    filter: AuditFilter;
    onChange: (next: AuditFilter) => void;
}

function DateRangeSection({ filter, onChange }: SubProps) {
    const activePreset = useMemo(() => detectActivePreset(filter), [filter]);

    const applyPreset = (preset: DateRangePreset) => {
        if (preset === 'custom') {
            onChange(filter);
            return;
        }
        const bounds = presetBounds(preset);
        onChange({ ...filter, fromTime: bounds.fromTime, toTime: bounds.toTime });
    };

    return (
        <div className="space-y-2">
            <SectionHeading>Date range</SectionHeading>
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
    );
}

function OrganizationSection({
    filter,
    onChange,
    options,
}: SubProps & { options: OrganizationOption[] }) {
    const [query, setQuery] = useState('');
    const filtered = useMemo(() => {
        if (!query.trim()) return options.slice(0, 50);
        const needle = query.trim().toLowerCase();
        return options
            .filter(
                (o) =>
                    o.name.toLowerCase().includes(needle) ||
                    o.slug.toLowerCase().includes(needle),
            )
            .slice(0, 50);
    }, [options, query]);

    const selected = options.find((o) => o.id === filter.organizationId);

    return (
        <div className="space-y-2">
            <SectionHeading>Organization</SectionHeading>
            {selected ? (
                <div className="flex items-center justify-between gap-2 p-2 rounded-md bg-muted/50">
                    <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{selected.name}</div>
                        <code className="text-xs text-muted-foreground font-mono">
                            {selected.slug}
                        </code>
                    </div>
                    <button
                        type="button"
                        onClick={() => onChange({ ...filter, organizationId: null })}
                        className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                    >
                        Clear
                    </button>
                </div>
            ) : (
                <>
                    <div className="relative">
                        <MagnifyingGlass
                            size={14}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Filter by org name or slug"
                            className="pl-8"
                        />
                    </div>
                    {query.trim() && filtered.length > 0 && (
                        <div className="max-h-48 overflow-y-auto rounded-md border border-border bg-background/60 divide-y divide-border">
                            {filtered.map((o) => (
                                <button
                                    key={o.id}
                                    type="button"
                                    onClick={() => {
                                        onChange({ ...filter, organizationId: o.id });
                                        setQuery('');
                                    }}
                                    className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted/40 flex items-center justify-between gap-2"
                                >
                                    <span className="truncate">{o.name}</span>
                                    <code className="text-[10px] text-muted-foreground font-mono shrink-0">
                                        {o.slug}
                                    </code>
                                </button>
                            ))}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

function ActorSection({ filter, onChange }: SubProps) {
    const [actorOpen, setActorOpen] = useState(false);
    const actorRef = useRef<HTMLButtonElement>(null);
    const { subjects } = useSubjectResolver(filter.actorUserId ? [filter.actorUserId] : []);
    const actorSubject = subjects[0];

    return (
        <div className="space-y-2">
            <SectionHeading>Actor</SectionHeading>
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
    );
}

function ActionsSection({
    filter,
    onChange,
    groups,
}: SubProps & { groups: ActionGroup[] }) {
    const toggleAction = (value: string) => {
        const next = filter.actions.includes(value)
            ? filter.actions.filter((a) => a !== value)
            : [...filter.actions, value];
        onChange({ ...filter, actions: next });
    };

    return (
        <div className="space-y-2">
            <SectionHeading>Actions</SectionHeading>
            <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-background/60 divide-y divide-border">
                {groups.map((group) => (
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
    );
}

function ResourceTypeSection({
    filter,
    onChange,
    options,
}: SubProps & { options: readonly { value: string; label: string }[] }) {
    return (
        <div className="space-y-2">
            <SectionHeading>Resource type</SectionHeading>
            <div className="grid grid-cols-2 gap-1.5">
                {options.map((rt) => {
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
    );
}

function ResourceUrnSection({ filter, onChange }: SubProps) {
    const [draft, setDraft] = useState(filter.resourceId ?? '');
    const [error, setError] = useState<string | null>(null);

    const apply = () => {
        if (!draft) {
            onChange({ ...filter, resourceId: null });
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
            onChange({ ...filter, resourceId: idPart });
            setError(null);
            return;
        }
        onChange({ ...filter, resourceId: draft });
        setError(null);
    };

    return (
        <div className="space-y-2">
            <SectionHeading>Resource URN</SectionHeading>
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
        </div>
    );
}
