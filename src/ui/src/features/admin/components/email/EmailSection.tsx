import { useCallback, useEffect, useMemo, useState } from 'react';
import { Envelope, PaperPlaneTilt, Gear, CheckCircle, Warning } from '@phosphor-icons/react';
import { toast } from 'sonner';
import { useAppSelector } from '@/app/hooks';
import { mailApi } from '@/features/admin/api/mailApi';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { NumberInput } from '@/components/ui/number-input';
import { cn } from '@/shared/utils/cn';
import { friendlyErrorMessage } from '@/config';
import { formatRelativeTime } from '@/shared/utils/dateFormatting';
import type { OrgMailConfigView } from '@uniffy/proto/mail/v1/mail_pb';

type Tab = 'configuration' | 'test';

interface ConfigDraft {
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

const EMPTY_DRAFT: ConfigDraft = {
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

function draftFromConfig(config: OrgMailConfigView | undefined): ConfigDraft {
    if (!config) return { ...EMPTY_DRAFT };
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

export function EmailSection() {
    const organizationId = useAppSelector((state) => state.auth.currentOrganizationId);
    const role = useAppSelector((state) => state.auth.currentOrganizationRole);
    const isAdmin = role === 'OWNER' || role === 'ADMIN';

    const [tab, setTab] = useState<Tab>('configuration');
    const [config, setConfig] = useState<OrgMailConfigView | null>(null);
    const [draft, setDraft] = useState<ConfigDraft>(EMPTY_DRAFT);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [clearing, setClearing] = useState(false);
    const [confirmClearOpen, setConfirmClearOpen] = useState(false);
    const [testRecipient, setTestRecipient] = useState('');
    const [testSending, setTestSending] = useState(false);
    const [lastTestOutcome, setLastTestOutcome] = useState<
        { ok: true; messageId?: string } | { ok: false; error: string } | null
    >(null);

    const reload = useCallback(async () => {
        if (!organizationId) return;
        setLoading(true);
        try {
            const response = await mailApi.getMailConfig({ organizationId });
            setConfig(response.config ?? null);
            setDraft(draftFromConfig(response.config));
        } catch (err) {
            const friendly = friendlyErrorMessage((err as Error).message);
            if (friendly) toast.error(friendly);
        } finally {
            setLoading(false);
        }
    }, [organizationId]);

    useEffect(() => {
        void reload();
    }, [reload]);

    const effectiveSource = config?.effectiveSource ?? 'env';
    const hasOrgConfig = config?.hasOrgConfig ?? false;
    const passwordSet = config?.smtpPasswordSet ?? false;

    const handleSave = async () => {
        if (!organizationId) return;
        if (!draft.fromAddress.trim() || !draft.smtpHost.trim()) {
            toast.error('From address and SMTP host are required');
            return;
        }
        setSaving(true);
        try {
            await mailApi.updateMailConfig({
                organizationId,
                fromAddress: draft.fromAddress.trim(),
                fromName: draft.fromName.trim() || 'Uniffy',
                replyTo: draft.replyTo.trim(),
                smtpHost: draft.smtpHost.trim(),
                smtpPort: Number.parseInt(draft.smtpPort, 10) || 587,
                smtpUsername: draft.smtpUsername,
                smtpPassword: draft.smtpPassword,
                smtpUseTls: draft.smtpUseTls,
                rateLimitPerMin: Number.parseInt(draft.rateLimitPerMin, 10) || 100,
            });
            await reload();
            toast.success('Mail configuration saved');
        } catch (err) {
            const friendly = friendlyErrorMessage((err as Error).message);
            if (friendly) toast.error(friendly);
        } finally {
            setSaving(false);
        }
    };

    const handleClear = async () => {
        if (!organizationId) return;
        setClearing(true);
        try {
            await mailApi.clearMailConfig({ organizationId });
            toast.success('Mail configuration cleared. The system default is now active.');
            setConfirmClearOpen(false);
            await reload();
        } catch (err) {
            const friendly = friendlyErrorMessage((err as Error).message);
            if (friendly) toast.error(friendly);
        } finally {
            setClearing(false);
        }
    };

    const handleSendTest = async () => {
        if (!organizationId || !testRecipient.trim()) return;
        setTestSending(true);
        setLastTestOutcome(null);
        try {
            const response = await mailApi.sendTestMail({
                organizationId,
                recipientEmail: testRecipient.trim(),
            });
            if (response.success) {
                setLastTestOutcome({ ok: true, messageId: response.providerMessageId });
                toast.success(`Test email sent to ${testRecipient.trim()}`);
            } else {
                setLastTestOutcome({ ok: false, error: response.error || 'Unknown error' });
                toast.error(response.error || 'Test send failed');
            }
            await reload();
        } catch (err) {
            const message = (err as Error).message;
            const friendly = friendlyErrorMessage(message) || message;
            setLastTestOutcome({ ok: false, error: friendly });
            if (friendly) toast.error(friendly);
        } finally {
            setTestSending(false);
        }
    };

    const lastTestSummary = useMemo(() => {
        if (!config?.lastTestAt) return null;
        const ts = new Date(Number(config.lastTestAt.seconds) * 1000);
        return {
            relative: formatRelativeTime(ts.toISOString()),
            status: config.lastTestStatus || 'unknown',
            error: config.lastTestError,
        };
    }, [config]);

    if (!isAdmin) {
        return (
            <div className="max-w-3xl w-full mx-auto">
                <div className="p-5 rounded-lg border border-border bg-card">
                    <p className="text-sm text-muted-foreground">
                        Only organization owners and admins can manage mail configuration.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 max-w-3xl w-full mx-auto">
            <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                    <Envelope size={22} weight="duotone" className="text-primary" />
                </div>
                <div className="flex-1">
                    <h1 className="text-xl font-semibold text-foreground">Email</h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Configure how this organization sends transactional email. Per-org SMTP
                        credentials are encrypted at rest with your org&apos;s data encryption key.
                    </p>
                </div>
                <SourceBadge source={effectiveSource} hasOrgConfig={hasOrgConfig} />
            </div>

            <div className="flex gap-1 border-b border-border">
                <TabButton active={tab === 'configuration'} onClick={() => setTab('configuration')}>
                    <Gear size={16} weight="duotone" /> Configuration
                </TabButton>
                <TabButton active={tab === 'test'} onClick={() => setTab('test')}>
                    <PaperPlaneTilt size={16} weight="duotone" /> Send test
                </TabButton>
            </div>

            {tab === 'configuration' ? (
                <ConfigurationTab
                    draft={draft}
                    setDraft={setDraft}
                    onSave={handleSave}
                    onClear={() => setConfirmClearOpen(true)}
                    saving={saving}
                    loading={loading}
                    hasOrgConfig={hasOrgConfig}
                    passwordSet={passwordSet}
                />
            ) : (
                <SendTestTab
                    recipient={testRecipient}
                    setRecipient={setTestRecipient}
                    onSend={handleSendTest}
                    sending={testSending}
                    lastOutcome={lastTestOutcome}
                    lastTestSummary={lastTestSummary}
                />
            )}

            <ConfirmDialog
                isOpen={confirmClearOpen}
                title="Clear mail configuration?"
                message="The organization will fall back to the system default mail settings. Any saved SMTP credentials are deleted."
                confirmLabel="Clear"
                cancelLabel="Cancel"
                onConfirm={handleClear}
                onClose={() => setConfirmClearOpen(false)}
                variant="danger"
                loading={clearing}
            />
        </div>
    );
}

function SourceBadge({
    source,
    hasOrgConfig,
}: {
    source: string;
    hasOrgConfig: boolean;
}) {
    const isOrg = source === 'org' && hasOrgConfig;
    return (
        <span
            className={cn(
                'px-2.5 py-1 rounded-md text-xs font-medium border',
                isOrg
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900/50'
                    : 'bg-muted text-muted-foreground border-border',
            )}
            title={
                isOrg
                    ? 'This organization has its own mail configuration.'
                    : 'No per-org configuration set. The system default (env vars) is active.'
            }
        >
            {isOrg ? 'Per-org config' : 'System default'}
        </span>
    );
}

function TabButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                active
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
        >
            {children}
        </button>
    );
}

interface ConfigurationTabProps {
    draft: ConfigDraft;
    setDraft: (next: ConfigDraft | ((prev: ConfigDraft) => ConfigDraft)) => void;
    onSave: () => void;
    onClear: () => void;
    saving: boolean;
    loading: boolean;
    hasOrgConfig: boolean;
    passwordSet: boolean;
}

function ConfigurationTab({
    draft,
    setDraft,
    onSave,
    onClear,
    saving,
    loading,
    hasOrgConfig,
    passwordSet,
}: ConfigurationTabProps) {
    const update = <K extends keyof ConfigDraft>(key: K, value: ConfigDraft[K]) =>
        setDraft((d) => ({ ...d, [key]: value }));

    return (
        <div className="flex flex-col gap-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field label="From address" required>
                    <input
                        type="email"
                        value={draft.fromAddress}
                        onChange={(e) => update('fromAddress', e.target.value)}
                        placeholder="no-reply@acme.com"
                        className={inputClass}
                        disabled={loading}
                    />
                </Field>
                <Field label="From name">
                    <input
                        type="text"
                        value={draft.fromName}
                        onChange={(e) => update('fromName', e.target.value)}
                        placeholder="Uniffy"
                        className={inputClass}
                        disabled={loading}
                    />
                </Field>
                <Field label="Reply-To" className="md:col-span-2">
                    <input
                        type="email"
                        value={draft.replyTo}
                        onChange={(e) => update('replyTo', e.target.value)}
                        placeholder="support@acme.com"
                        className={inputClass}
                        disabled={loading}
                    />
                </Field>
                <Field label="SMTP host" required>
                    <input
                        type="text"
                        value={draft.smtpHost}
                        onChange={(e) => update('smtpHost', e.target.value)}
                        placeholder="smtp.resend.com"
                        className={inputClass}
                        disabled={loading}
                    />
                </Field>
                <Field label="SMTP port">
                    <NumberInput
                        value={draft.smtpPort}
                        onChange={(e) => update('smtpPort', e.target.value)}
                        placeholder="587"
                        min={1}
                        max={65535}
                        className={inputClass}
                        disabled={loading}
                    />
                </Field>
                <Field label="SMTP username">
                    <input
                        type="text"
                        value={draft.smtpUsername}
                        onChange={(e) => update('smtpUsername', e.target.value)}
                        placeholder="resend"
                        className={inputClass}
                        disabled={loading}
                    />
                </Field>
                <Field label="SMTP password">
                    <input
                        type="password"
                        value={draft.smtpPassword}
                        onChange={(e) => update('smtpPassword', e.target.value)}
                        placeholder={passwordSet ? 'Leave blank to keep current' : 'Paste API key or password'}
                        className={inputClass}
                        autoComplete="new-password"
                        disabled={loading}
                    />
                    {passwordSet && (
                        <p className="mt-1 text-xs text-muted-foreground">
                            A password is currently set. Leave the field blank to keep it; type a new
                            value to overwrite.
                        </p>
                    )}
                </Field>
                <Field label="Rate limit (per minute)">
                    <NumberInput
                        value={draft.rateLimitPerMin}
                        onChange={(e) => update('rateLimitPerMin', e.target.value)}
                        min={1}
                        className={inputClass}
                        disabled={loading}
                    />
                </Field>
                <div className="md:col-span-2">
                    <Checkbox
                        label="Use TLS (STARTTLS on port 587, implicit TLS on port 465)"
                        checked={draft.smtpUseTls}
                        onChange={(e) => update('smtpUseTls', e.target.checked)}
                        disabled={loading}
                    />
                </div>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-border">
                {hasOrgConfig ? (
                    <Button variant="ghost" onClick={onClear} disabled={loading || saving}>
                        Clear configuration
                    </Button>
                ) : (
                    <span className="text-xs text-muted-foreground">
                        No org configuration yet. Saving creates one.
                    </span>
                )}
                <Button onClick={onSave} loading={saving} disabled={loading}>
                    Save configuration
                </Button>
            </div>
        </div>
    );
}

interface SendTestTabProps {
    recipient: string;
    setRecipient: (v: string) => void;
    onSend: () => void;
    sending: boolean;
    lastOutcome: { ok: true; messageId?: string } | { ok: false; error: string } | null;
    lastTestSummary: { relative: string; status: string; error?: string } | null;
}

function SendTestTab({
    recipient,
    setRecipient,
    onSend,
    sending,
    lastOutcome,
    lastTestSummary,
}: SendTestTabProps) {
    return (
        <div className="flex flex-col gap-6">
            <p className="text-sm text-muted-foreground">
                Sends a one-shot message through the currently active configuration (per-org if
                set, system default otherwise). The result is recorded on the org configuration as{' '}
                <code className="text-xs">last_test_at</code> /{' '}
                <code className="text-xs">last_test_status</code>.
            </p>

            <Field label="Recipient">
                <input
                    type="email"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    placeholder="you@example.com"
                    className={inputClass}
                />
            </Field>

            <div>
                <Button
                    onClick={onSend}
                    loading={sending}
                    disabled={!recipient.trim() || sending}
                >
                    Send test email
                </Button>
            </div>

            {lastOutcome && (
                <div
                    className={cn(
                        'p-4 rounded-lg border flex items-start gap-3',
                        lastOutcome.ok
                            ? 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/40 dark:bg-emerald-900/20'
                            : 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20',
                    )}
                >
                    {lastOutcome.ok ? (
                        <CheckCircle size={18} weight="fill" className="text-emerald-600 mt-0.5" />
                    ) : (
                        <Warning size={18} weight="fill" className="text-red-600 mt-0.5" />
                    )}
                    <div className="flex-1 text-sm">
                        {lastOutcome.ok ? (
                            <>
                                <p className="font-medium text-emerald-900 dark:text-emerald-200">
                                    Test send succeeded.
                                </p>
                                {lastOutcome.messageId && (
                                    <p className="text-emerald-800/80 dark:text-emerald-200/80 mt-0.5">
                                        Provider message id: <code>{lastOutcome.messageId}</code>
                                    </p>
                                )}
                            </>
                        ) : (
                            <>
                                <p className="font-medium text-red-900 dark:text-red-200">
                                    Test send failed.
                                </p>
                                <p className="text-red-800/80 dark:text-red-200/80 mt-0.5">
                                    {lastOutcome.error}
                                </p>
                            </>
                        )}
                    </div>
                </div>
            )}

            {lastTestSummary && (
                <div className="p-4 rounded-lg border border-border bg-card text-sm">
                    <p className="text-muted-foreground">
                        Last attempt {lastTestSummary.relative} -{' '}
                        <span
                            className={cn(
                                'font-medium',
                                lastTestSummary.status === 'ok'
                                    ? 'text-emerald-600 dark:text-emerald-400'
                                    : 'text-red-600 dark:text-red-400',
                            )}
                        >
                            {lastTestSummary.status}
                        </span>
                    </p>
                    {lastTestSummary.error && (
                        <p className="text-muted-foreground mt-1">
                            {lastTestSummary.error}
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}

function Field({
    label,
    required,
    children,
    className,
}: {
    label: string;
    required?: boolean;
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <label className={cn('flex flex-col gap-1.5', className)}>
            <span className="text-xs font-medium text-muted-foreground">
                {label}
                {required && <span className="text-red-500 ml-0.5">*</span>}
            </span>
            {children}
        </label>
    );
}

const inputClass = cn(
    'w-full px-3 py-2 rounded-md text-sm',
    'bg-background text-foreground',
    'border border-border',
    'focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring',
    'disabled:opacity-50 disabled:cursor-not-allowed',
);
