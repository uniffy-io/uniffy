import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
    Envelope,
    Gear,
    Buildings,
    Prohibit,
    PaperPlaneTilt,
    MagnifyingGlass,
    ArrowClockwise,
    Trash,
    CheckCircle,
    XCircle,
} from '@phosphor-icons/react';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { cn } from '@/shared/utils/cn';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
    Table,
    TableBody,
    TableCell,
    TableEmpty,
    TableHead,
    TableHeader,
    TableLoading,
    TableRow,
} from '@/components/ui/table';
import { formatProtoDateTime, formatRelativeTime } from '@/shared/utils/dateFormatting';
import { friendlyErrorMessage } from '@/config';
import { systemMailApi } from '@/features/platform/api/systemMailApi';
import type {
    GlobalDeliveryEntry,
    GlobalSuppressionEntry,
    OrgMailConfigSummary,
    SystemMailConfigView,
} from '@uniffy/proto/superadmin/v1/system_mail_pb';

type Tab = 'system' | 'orgs' | 'suppressions' | 'deliveries';

const PAGE_SIZE = 50;
const MASKED_SECRET = '••••••••';

type ProtoTimestamp = { seconds: number | bigint; nanos: number };

function protoToIso(ts: ProtoTimestamp | undefined): string | undefined {
    if (!ts) return undefined;
    const ms = typeof ts.seconds === 'bigint'
        ? Number(ts.seconds) * 1000
        : ts.seconds * 1000;
    return new Date(ms).toISOString();
}

export function PlatformMailPage() {
    useDocumentTitle('Platform Mail');
    const [tab, setTab] = useState<Tab>('system');

    return (
        <div className="flex flex-col gap-6 max-w-5xl w-full mx-auto">
            <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                    <Envelope size={22} weight="duotone" className="text-primary" />
                </div>
                <div className="flex-1">
                    <h1 className="text-xl font-semibold text-foreground">Mail</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Cross-tenant mail infrastructure. Per-org secrets stay encrypted; this view only
                        surfaces presence and outcomes.
                    </p>
                </div>
            </div>

            <div className="flex gap-1 border-b border-border overflow-x-auto">
                <TabButton active={tab === 'system'} onClick={() => setTab('system')} icon={<Gear size={14} weight="duotone" />}>
                    System Config
                </TabButton>
                <TabButton active={tab === 'orgs'} onClick={() => setTab('orgs')} icon={<Buildings size={14} weight="duotone" />}>
                    Per-org Configs
                </TabButton>
                <TabButton active={tab === 'suppressions'} onClick={() => setTab('suppressions')} icon={<Prohibit size={14} weight="duotone" />}>
                    Suppressions
                </TabButton>
                <TabButton active={tab === 'deliveries'} onClick={() => setTab('deliveries')} icon={<PaperPlaneTilt size={14} weight="duotone" />}>
                    Deliveries
                </TabButton>
            </div>

            {tab === 'system' && <SystemConfigTab />}
            {tab === 'orgs' && <OrgConfigsTab />}
            {tab === 'suppressions' && <SuppressionsTab />}
            {tab === 'deliveries' && <DeliveriesTab />}
        </div>
    );
}

function TabButton({
    active,
    onClick,
    children,
    icon,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
    icon?: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap',
                active
                    ? 'border-amber-500 text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
        >
            {icon}
            {children}
        </button>
    );
}

interface SystemDraft {
    fromAddress: string;
    fromName: string;
    replyTo: string;
    smtpHost: string;
    smtpPort: string;
    smtpUsername: string;
    smtpPassword: string;
    smtpUseTls: boolean;
    rateLimitPerMin: string;
}

const EMPTY_SYSTEM_DRAFT: SystemDraft = {
    fromAddress: '',
    fromName: 'Uniffy',
    replyTo: '',
    smtpHost: '',
    smtpPort: '587',
    smtpUsername: '',
    smtpPassword: '',
    smtpUseTls: true,
    rateLimitPerMin: '100',
};

function draftFromSystemConfig(config: SystemMailConfigView | null): SystemDraft {
    if (!config || !config.configured) return { ...EMPTY_SYSTEM_DRAFT };
    return {
        fromAddress: config.fromAddress || '',
        fromName: config.fromName || 'Uniffy',
        replyTo: config.replyTo || '',
        smtpHost: config.smtpHost || '',
        smtpPort: String(config.smtpPort || 587),
        smtpUsername: config.smtpUsername || '',
        smtpPassword: '',
        smtpUseTls: config.smtpUseTls,
        rateLimitPerMin: String(config.rateLimitPerMin || 100),
    };
}

function SystemConfigTab() {
    const [config, setConfig] = useState<SystemMailConfigView | null>(null);
    const [draft, setDraft] = useState<SystemDraft>(EMPTY_SYSTEM_DRAFT);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [clearOpen, setClearOpen] = useState(false);
    const [clearReason, setClearReason] = useState('');
    const [clearBusy, setClearBusy] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const response = await systemMailApi.getSystemMailConfig({});
            const next = response.config ?? null;
            setConfig(next);
            setDraft(draftFromSystemConfig(next));
        } catch (err) {
            const friendly = friendlyErrorMessage((err as Error).message);
            if (friendly) toast.error(friendly);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const handleSave = async () => {
        if (!draft.fromAddress.trim() || !draft.smtpHost.trim()) {
            toast.error('From address and SMTP host are required');
            return;
        }
        setSaving(true);
        try {
            const response = await systemMailApi.updateSystemMailConfig({
                fromAddress: draft.fromAddress.trim(),
                fromName: draft.fromName.trim() || 'Uniffy',
                replyTo: draft.replyTo.trim(),
                smtpHost: draft.smtpHost.trim(),
                smtpPort: parseInt(draft.smtpPort, 10) || 587,
                smtpUsername: draft.smtpUsername,
                smtpPassword: draft.smtpPassword,
                smtpUseTls: draft.smtpUseTls,
                rateLimitPerMin: parseInt(draft.rateLimitPerMin, 10) || 100,
            });
            const next = response.config ?? null;
            setConfig(next);
            setDraft(draftFromSystemConfig(next));
            toast.success('System mail config saved');
        } catch (err) {
            const friendly = friendlyErrorMessage((err as Error).message);
            if (friendly) toast.error(friendly);
        } finally {
            setSaving(false);
        }
    };

    const handleClear = async () => {
        if (!clearReason.trim()) {
            toast.error('Reason is required');
            return;
        }
        setClearBusy(true);
        try {
            await systemMailApi.clearSystemMailConfig({ reason: clearReason.trim() });
            toast.success('Cleared. Reverting to env defaults.');
            setClearOpen(false);
            setClearReason('');
            await load();
        } catch (err) {
            const friendly = friendlyErrorMessage((err as Error).message);
            if (friendly) toast.error(friendly);
        } finally {
            setClearBusy(false);
        }
    };

    if (loading) {
        return <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">Loading...</div>;
    }

    const effectiveSource = config?.effectiveSource ?? 'none';
    const fromEnv = effectiveSource === 'env';
    const fromDeployment = effectiveSource === 'deployment';

    return (
        <div className="space-y-4 max-w-2xl">
            <div className="rounded-lg border border-border bg-card p-4 flex items-start gap-3">
                <Envelope size={18} weight="duotone" className="text-muted-foreground shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-foreground">Effective source</span>
                        <SourceBadgeFor source={effectiveSource} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                        {fromDeployment && 'Editing the form below writes to the deployment configuration. Per-org mail configs still take precedence for orgs that have their own.'}
                        {fromEnv && 'Env defaults are currently active. Saving the form below overrides them with deployment-tier rows; clearing reverts to env.'}
                        {effectiveSource === 'none' && 'No mail config anywhere. Fill in the form below to enable the system SMTP relay.'}
                    </p>
                </div>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 md:p-6 space-y-3">
                <FieldRow
                    label="From address"
                    value={draft.fromAddress}
                    onChange={(v) => setDraft({ ...draft, fromAddress: v })}
                    placeholder="noreply@yourcompany.com"
                    required
                />
                <FieldRow
                    label="From name"
                    value={draft.fromName}
                    onChange={(v) => setDraft({ ...draft, fromName: v })}
                    placeholder="Uniffy"
                />
                <FieldRow
                    label="Reply-to"
                    value={draft.replyTo}
                    onChange={(v) => setDraft({ ...draft, replyTo: v })}
                    placeholder="(optional)"
                />
                <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
                    <FieldRow
                        label="SMTP host"
                        value={draft.smtpHost}
                        onChange={(v) => setDraft({ ...draft, smtpHost: v })}
                        placeholder="smtp.resend.com"
                        required
                    />
                    <FieldRow
                        label="Port"
                        value={draft.smtpPort}
                        onChange={(v) => setDraft({ ...draft, smtpPort: v })}
                        placeholder="587"
                    />
                </div>
                <FieldRow
                    label="SMTP username"
                    value={draft.smtpUsername}
                    onChange={(v) => setDraft({ ...draft, smtpUsername: v })}
                    placeholder="(if your provider requires one)"
                />
                <FieldRow
                    label="SMTP password"
                    value={draft.smtpPassword}
                    onChange={(v) => setDraft({ ...draft, smtpPassword: v })}
                    placeholder={config?.smtpPasswordSet ? MASKED_SECRET + ' (leave blank to keep)' : 'enter password'}
                    type="password"
                />
                <FieldRow
                    label="Rate limit / min"
                    value={draft.rateLimitPerMin}
                    onChange={(v) => setDraft({ ...draft, rateLimitPerMin: v })}
                    placeholder="100"
                />
                <Checkbox
                    label="Use TLS (STARTTLS)"
                    checked={draft.smtpUseTls}
                    onChange={(e) => setDraft({ ...draft, smtpUseTls: e.target.checked })}
                />

                <div className="flex items-center justify-between gap-2 pt-3 border-t border-border">
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={saving || !fromDeployment}
                        onClick={() => setClearOpen(true)}
                    >
                        <Trash size={14} weight="duotone" className="mr-1" />
                        Clear (revert to env)
                    </Button>
                    <Button size="sm" onClick={() => void handleSave()} loading={saving}>
                        Save
                    </Button>
                </div>
            </div>

            <ConfirmDialog
                isOpen={clearOpen}
                onClose={() => {
                    if (!clearBusy) setClearOpen(false);
                }}
                onConfirm={() => void handleClear()}
                title="Clear deployment-tier mail config?"
                message={
                    <div className="space-y-3">
                        <p>
                            Drops every <code className="font-mono">mail.*</code> deployment_settings row.
                            Subsequent sends fall back to env defaults (or "unconfigured" if env is empty).
                        </p>
                        <div>
                            <label className="block text-xs font-medium text-foreground mb-1">Reason</label>
                            <input
                                type="text"
                                value={clearReason}
                                onChange={(e) => setClearReason(e.target.value)}
                                placeholder="e.g. switching providers, rotating credentials"
                                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                        </div>
                    </div>
                }
                confirmLabel={clearBusy ? 'Clearing...' : 'Clear'}
                cancelLabel="Cancel"
                variant="warning"
            />
        </div>
    );
}

function SourceBadgeFor({ source }: { source: string }) {
    if (source === 'deployment') {
        return (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                Deployment
            </span>
        );
    }
    if (source === 'env') {
        return (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                Env
            </span>
        );
    }
    return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-muted text-muted-foreground">
            None
        </span>
    );
}

function FieldRow({
    label,
    value,
    onChange,
    placeholder,
    required,
    type,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    required?: boolean;
    type?: 'text' | 'password';
}) {
    return (
        <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
                {label}{required && <span className="text-red-500 ml-1">*</span>}
            </label>
            <input
                type={type ?? 'text'}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
        </div>
    );
}

function OrgConfigsTab() {
    const [rows, setRows] = useState<OrgMailConfigSummary[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [search, setSearch] = useState('');
    const [onlyWithOrgConfig, setOnlyWithOrgConfig] = useState(false);
    const [loading, setLoading] = useState(true);
    const [clearingOrg, setClearingOrg] = useState<OrgMailConfigSummary | null>(null);
    const [clearReason, setClearReason] = useState('');
    const [clearBusy, setClearBusy] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const response = await systemMailApi.listOrgMailConfigs({
                page,
                pageSize: PAGE_SIZE,
                search,
                onlyWithOrgConfig,
            });
            setRows(response.configs);
            setTotal(response.totalCount);
        } catch (err) {
            const friendly = friendlyErrorMessage((err as Error).message);
            if (friendly) toast.error(friendly);
        } finally {
            setLoading(false);
        }
    }, [page, search, onlyWithOrgConfig]);

    useEffect(() => {
        void load();
    }, [load]);

    const handleClear = async () => {
        if (!clearingOrg) return;
        if (!clearReason.trim()) {
            toast.error('Reason is required');
            return;
        }
        setClearBusy(true);
        try {
            const response = await systemMailApi.forceClearOrgConfig({
                organizationId: clearingOrg.organizationId,
                reason: clearReason.trim(),
            });
            toast.success(`Cleared ${response.deletedKeys} mail setting(s) for ${clearingOrg.organizationName}`);
            setClearingOrg(null);
            setClearReason('');
            await load();
        } catch (err) {
            const friendly = friendlyErrorMessage((err as Error).message);
            if (friendly) toast.error(friendly);
        } finally {
            setClearBusy(false);
        }
    };

    return (
        <div className="space-y-3">
            <FiltersBar
                search={search}
                onSearchChange={(value) => {
                    setSearch(value);
                    setPage(0);
                }}
                onReload={load}
            >
                <Checkbox
                    label="Only with per-org config"
                    checked={onlyWithOrgConfig}
                    onChange={(e) => {
                        setOnlyWithOrgConfig(e.target.checked);
                        setPage(0);
                    }}
                />
            </FiltersBar>

            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Organization</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>From</TableHead>
                        <TableHead>SMTP host</TableHead>
                        <TableHead>Last test</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {loading && <TableLoading colSpan={6} />}
                    {!loading && rows.length === 0 && (
                        <TableEmpty colSpan={6} icon={<Buildings size={32} weight="duotone" />} title="No organizations match" />
                    )}
                    {!loading && rows.map((row) => (
                        <TableRow key={row.organizationId}>
                            <TableCell>
                                <div className="font-medium text-foreground">{row.organizationName}</div>
                                <div className="text-xs text-muted-foreground">{row.organizationSlug}</div>
                            </TableCell>
                            <TableCell>
                                <SourceBadge source={row.effectiveSource} />
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                                {row.fromAddress || '—'}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground font-mono">
                                {row.smtpHost || '—'}
                            </TableCell>
                            <TableCell>
                                <TestStatusCell row={row} />
                            </TableCell>
                            <TableCell className="text-right">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={row.effectiveSource !== 'org'}
                                    onClick={() => {
                                        setClearingOrg(row);
                                        setClearReason('');
                                    }}
                                >
                                    Force clear
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>

            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />

            <ConfirmDialog
                isOpen={clearingOrg !== null}
                onClose={() => {
                    if (!clearBusy) setClearingOrg(null);
                }}
                onConfirm={() => void handleClear()}
                title={`Force-clear ${clearingOrg?.organizationName ?? ''}?`}
                message={
                    <div className="space-y-3">
                        <p>
                            This drops every <code className="font-mono">mail.*</code> row for the org. Subsequent
                            sends fall back to the system env default. The action is audit-logged.
                        </p>
                        <div>
                            <label className="block text-xs font-medium text-foreground mb-1">Reason</label>
                            <input
                                type="text"
                                value={clearReason}
                                onChange={(e) => setClearReason(e.target.value)}
                                placeholder="e.g. customer ticket #1234, broken SMTP creds"
                                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                        </div>
                    </div>
                }
                confirmLabel={clearBusy ? 'Clearing...' : 'Force clear'}
                cancelLabel="Cancel"
                variant="warning"
            />
        </div>
    );
}

function SuppressionsTab() {
    const [entries, setEntries] = useState<GlobalSuppressionEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [removing, setRemoving] = useState<GlobalSuppressionEntry | null>(null);
    const [removeReason, setRemoveReason] = useState('');
    const [removeBusy, setRemoveBusy] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const response = await systemMailApi.listGlobalSuppressions({
                page,
                pageSize: PAGE_SIZE,
                search,
            });
            setEntries(response.entries);
            setTotal(response.totalCount);
        } catch (err) {
            const friendly = friendlyErrorMessage((err as Error).message);
            if (friendly) toast.error(friendly);
        } finally {
            setLoading(false);
        }
    }, [page, search]);

    useEffect(() => {
        void load();
    }, [load]);

    const handleRemove = async () => {
        if (!removing) return;
        if (!removeReason.trim()) {
            toast.error('Reason is required');
            return;
        }
        setRemoveBusy(true);
        try {
            const response = await systemMailApi.removeGlobalSuppression({
                email: removing.email,
                reason: removeReason.trim(),
            });
            if (response.removed) {
                toast.success(`Removed ${removing.email}`);
                setRemoving(null);
                setRemoveReason('');
                await load();
            } else {
                toast.message(`${removing.email} was not on the list`);
                setRemoving(null);
            }
        } catch (err) {
            const friendly = friendlyErrorMessage((err as Error).message);
            if (friendly) toast.error(friendly);
        } finally {
            setRemoveBusy(false);
        }
    };

    return (
        <div className="space-y-3">
            <FiltersBar
                search={search}
                onSearchChange={(value) => {
                    setSearch(value);
                    setPage(0);
                }}
                onReload={load}
                placeholder="Filter by email"
            />

            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Source</TableHead>
                        <TableHead>Added</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {loading && <TableLoading colSpan={5} />}
                    {!loading && entries.length === 0 && (
                        <TableEmpty colSpan={5} icon={<Prohibit size={32} weight="duotone" />} title="No suppressed addresses" />
                    )}
                    {!loading && entries.map((entry) => (
                        <TableRow key={entry.id}>
                            <TableCell className="font-mono text-xs">{entry.email}</TableCell>
                            <TableCell>
                                <ReasonBadge reason={entry.reason} />
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground font-mono">{entry.source}</TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                                {formatRelativeTime(protoToIso(entry.createdAt)) || '—'}
                            </TableCell>
                            <TableCell className="text-right">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                        setRemoving(entry);
                                        setRemoveReason('');
                                    }}
                                >
                                    <Trash size={14} weight="duotone" className="mr-1" />
                                    Remove
                                </Button>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>

            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />

            <ConfirmDialog
                isOpen={removing !== null}
                onClose={() => {
                    if (!removeBusy) setRemoving(null);
                }}
                onConfirm={() => void handleRemove()}
                title={`Remove ${removing?.email ?? ''}?`}
                message={
                    <div className="space-y-3">
                        <p>
                            The address will be eligible for delivery again. The action is audit-logged with your
                            reason.
                        </p>
                        <div>
                            <label className="block text-xs font-medium text-foreground mb-1">Reason</label>
                            <input
                                type="text"
                                value={removeReason}
                                onChange={(e) => setRemoveReason(e.target.value)}
                                placeholder="e.g. customer confirmed mailbox is back"
                                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                        </div>
                    </div>
                }
                confirmLabel={removeBusy ? 'Removing...' : 'Remove'}
                cancelLabel="Cancel"
                variant="warning"
            />
        </div>
    );
}

function DeliveriesTab() {
    const [entries, setEntries] = useState<GlobalDeliveryEntry[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(0);
    const [outcome, setOutcome] = useState<'' | 'sent' | 'failed' | 'suppressed'>('');
    const [loading, setLoading] = useState(true);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const response = await systemMailApi.listGlobalDeliveries({
                page,
                pageSize: PAGE_SIZE,
                outcome,
            });
            setEntries(response.entries);
            setTotal(response.totalCount);
        } catch (err) {
            const friendly = friendlyErrorMessage((err as Error).message);
            if (friendly) toast.error(friendly);
        } finally {
            setLoading(false);
        }
    }, [page, outcome]);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                    {(['', 'sent', 'failed', 'suppressed'] as const).map((value) => (
                        <button
                            key={value || 'all'}
                            type="button"
                            onClick={() => {
                                setOutcome(value);
                                setPage(0);
                            }}
                            className={cn(
                                'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
                                outcome === value
                                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                                    : 'text-muted-foreground hover:bg-muted'
                            )}
                        >
                            {value === '' ? 'All' : value.charAt(0).toUpperCase() + value.slice(1)}
                        </button>
                    ))}
                </div>
                <Button size="sm" variant="ghost" onClick={() => void load()}>
                    <ArrowClockwise size={14} weight="duotone" className="mr-1" />
                    Reload
                </Button>
            </div>

            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>When</TableHead>
                        <TableHead>Outcome</TableHead>
                        <TableHead>Organization</TableHead>
                        <TableHead>Recipient</TableHead>
                        <TableHead>Template</TableHead>
                        <TableHead>Detail</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {loading && <TableLoading colSpan={6} />}
                    {!loading && entries.length === 0 && (
                        <TableEmpty colSpan={6} icon={<PaperPlaneTilt size={32} weight="duotone" />} title="No mail deliveries yet" />
                    )}
                    {!loading && entries.map((entry) => (
                        <TableRow key={entry.id}>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                                {entry.createdAt ? formatProtoDateTime(entry.createdAt) : '—'}
                            </TableCell>
                            <TableCell>
                                <OutcomeBadge action={entry.action} />
                            </TableCell>
                            <TableCell>
                                <span className="text-sm text-foreground">
                                    {entry.organizationName || (entry.organizationId ? '(deleted)' : '—')}
                                </span>
                            </TableCell>
                            <TableCell className="text-xs font-mono text-muted-foreground">
                                {entry.recipient || '—'}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground">
                                {entry.template || '—'}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                                {entry.error || entry.providerMessageId || '—'}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>

            <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
        </div>
    );
}

function FiltersBar({
    search,
    onSearchChange,
    onReload,
    placeholder,
    children,
}: {
    search: string;
    onSearchChange: (value: string) => void;
    onReload: () => void;
    placeholder?: string;
    children?: React.ReactNode;
}) {
    return (
        <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-1 min-w-[12rem]">
                <div className="relative flex-1 max-w-sm">
                    <MagnifyingGlass size={14} weight="duotone" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder={placeholder ?? 'Filter by name or slug'}
                        className="w-full pl-8 pr-2 py-1.5 text-sm rounded-md bg-background border border-border focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                </div>
                {children}
            </div>
            <Button size="sm" variant="ghost" onClick={onReload}>
                <ArrowClockwise size={14} weight="duotone" className="mr-1" />
                Reload
            </Button>
        </div>
    );
}

function Pagination({
    page,
    pageSize,
    total,
    onPageChange,
}: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
}) {
    const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);
    const isFirst = page <= 0;
    const isLast = page >= totalPages - 1;

    if (total <= pageSize) return null;

    return (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
                Page {page + 1} of {totalPages} - {total.toLocaleString()} total
            </span>
            <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" disabled={isFirst} onClick={() => onPageChange(Math.max(0, page - 1))}>
                    Previous
                </Button>
                <Button size="sm" variant="ghost" disabled={isLast} onClick={() => onPageChange(page + 1)}>
                    Next
                </Button>
            </div>
        </div>
    );
}

function SourceBadge({ source }: { source: string }) {
    const isOrg = source === 'org';
    return (
        <span
            className={cn(
                'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider',
                isOrg
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground'
            )}
        >
            {isOrg ? 'Per-org' : 'Env'}
        </span>
    );
}

function ReasonBadge({ reason }: { reason: string }) {
    const lower = reason.toLowerCase();
    const cls =
        lower === 'bounced'
            ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400'
            : lower === 'complained'
                ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                : 'bg-muted text-muted-foreground';
    return (
        <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider', cls)}>
            {reason || 'unknown'}
        </span>
    );
}

function OutcomeBadge({ action }: { action: string }) {
    if (action === 'mail.sent') {
        return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
                <CheckCircle size={10} weight="fill" /> Sent
            </span>
        );
    }
    if (action === 'mail.send_failed') {
        return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">
                <XCircle size={10} weight="fill" /> Failed
            </span>
        );
    }
    if (action === 'mail.suppressed') {
        return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
                <Prohibit size={10} weight="fill" /> Suppressed
            </span>
        );
    }
    return <span className="text-xs text-muted-foreground">{action}</span>;
}

function TestStatusCell({ row }: { row: OrgMailConfigSummary }) {
    if (!row.lastTestAt) {
        return <span className="text-xs text-muted-foreground">Never tested</span>;
    }
    const when = formatRelativeTime(protoToIso(row.lastTestAt));
    if (row.lastTestStatus === 'ok') {
        return (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckCircle size={12} weight="fill" /> {when}
            </span>
        );
    }
    if (row.lastTestStatus === 'failed') {
        return (
            <span className="inline-flex items-center gap-1 text-xs text-red-700 dark:text-red-400">
                <XCircle size={12} weight="fill" /> {when}
            </span>
        );
    }
    return <span className="text-xs text-muted-foreground">{when}</span>;
}
