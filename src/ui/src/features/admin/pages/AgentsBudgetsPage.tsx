/**
 * Agents Budgets admin page.
 *
 * Two tabs:
 * - Budget: org-wide monthly spend cap, image cap, hard-limit toggle,
 *   alert thresholds, reset day. Surfaces the current-period spend
 *   alongside the cap so admins can eyeball headroom.
 * - Rate Limits: the five rate-limit kinds, each with a per-org
 *   override (limit + window seconds). Defaults are shown faded with
 *   a "Default" badge until the admin overrides them.
 *
 * Runtime settings will land in a third tab once the backend RPC
 * lands; the model exists but no service exposes it yet.
 */

import { useEffect, useMemo, useState } from 'react';
import { CurrencyDollar, Gauge, Wallet } from '@phosphor-icons/react';
import { useAppDispatch, useAppSelector } from '@/app/hooks';
import { useDocumentTitle } from '@/shared/hooks/useDocumentTitle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/shared/utils/cn';
import {
    fetchOrgBudget,
    updateOrgBudget,
    fetchCurrentSpend,
    fetchRateLimits,
    upsertRateLimit,
    deleteRateLimit,
} from '@/features/admin/store/agentsGovernanceThunks';
import type { RateLimitState } from '@/features/admin/store/agentsGovernanceSlice';

type TabId = 'budget' | 'rate-limits';

const TABS: { id: TabId; label: string }[] = [
    { id: 'budget', label: 'Budget' },
    { id: 'rate-limits', label: 'Rate limits' },
];

const RATE_LIMIT_LABELS: Record<number, { name: string; description: string }> = {
    1: {
        name: 'Agent messages (per user)',
        description: 'Max text-message requests one user can send across all agents.',
    },
    2: {
        name: 'Agent messages (per org)',
        description: 'Org-wide cap on text-message requests.',
    },
    3: {
        name: 'Agent messages (per agent / user)',
        description: 'Cap per user-agent pair so a runaway loop on one agent cannot starve the others.',
    },
    4: {
        name: 'Image generation (per user)',
        description: 'Cap on image generations per user.',
    },
    5: {
        name: 'Image generation (per org)',
        description: 'Org-wide cap on image generations.',
    },
};

export function AgentsBudgetsPage() {
    useDocumentTitle('Agents Budgets');
    const [activeTab, setActiveTab] = useState<TabId>('budget');

    return (
        <div className="space-y-6">
            <div>
                <div className="flex items-center gap-3 mb-2">
                    <Wallet size={24} weight="duotone" className="text-primary" />
                    <h1 className="text-2xl font-bold">Agents Budgets</h1>
                </div>
                <p className="text-muted-foreground">
                    Cost caps, alerts, and request-rate overrides for your organization.
                </p>
            </div>

            <div className="flex border-b border-border">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        onClick={() => setActiveTab(t.id)}
                        className={cn(
                            'px-4 py-2 text-sm font-medium transition-colors',
                            activeTab === t.id
                                ? 'text-primary border-b-2 border-primary bg-primary/5'
                                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                        )}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {activeTab === 'budget' && <BudgetTab />}
            {activeTab === 'rate-limits' && <RateLimitsTab />}
        </div>
    );
}

// --- Budget tab ---

function BudgetTab() {
    const dispatch = useAppDispatch();
    const orgId = useAppSelector((s) => s.auth.currentOrganizationId);
    const budget = useAppSelector((s) => s.agentsGovernance.budget);
    const spend = useAppSelector((s) => s.agentsGovernance.spend);
    const loading = useAppSelector((s) => s.agentsGovernance.loadingBudget);
    const saving = useAppSelector((s) => s.agentsGovernance.savingBudget);

    const [monthlyLimit, setMonthlyLimit] = useState('');
    const [imageLimit, setImageLimit] = useState('');
    const [hardLimit, setHardLimit] = useState(false);
    const [thresholds, setThresholds] = useState('50, 75, 90');
    const [resetDay, setResetDay] = useState('1');

    useEffect(() => {
        if (!orgId) return;
        dispatch(fetchOrgBudget());
        dispatch(fetchCurrentSpend());
    }, [dispatch, orgId]);

    useEffect(() => {
        if (!budget) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing form fields when the fetched budget loads or changes
        setMonthlyLimit(budget.monthlyLimitUsd ?? '');
        setImageLimit(budget.imageMonthlyLimit?.toString() ?? '');
        setHardLimit(budget.hardLimit);
        setThresholds(budget.alertThresholds.join(', '));
        setResetDay(budget.resetDay.toString());
    }, [budget]);

    const parsedThresholds = useMemo(() => {
        return thresholds
            .split(',')
            .map((t) => parseInt(t.trim(), 10))
            .filter((n) => Number.isFinite(n) && n > 0 && n <= 100);
    }, [thresholds]);

    const parsedResetDay = parseInt(resetDay, 10);
    const resetDayValid = Number.isFinite(parsedResetDay) && parsedResetDay >= 1 && parsedResetDay <= 28;

    const handleSave = () => {
        if (!resetDayValid) return;
        dispatch(
            updateOrgBudget({
                monthlyLimitUsd: monthlyLimit.trim() || null,
                imageMonthlyLimit: imageLimit.trim() ? parseInt(imageLimit.trim(), 10) : null,
                hardLimit,
                alertThresholds: parsedThresholds,
                resetDay: parsedResetDay,
            }),
        );
    };

    const spendPct = useMemo(() => {
        if (!spend?.spendUsd || !monthlyLimit) return null;
        const s = parseFloat(spend.spendUsd);
        const cap = parseFloat(monthlyLimit);
        if (!cap) return null;
        return Math.min(100, Math.round((s / cap) * 100));
    }, [spend, monthlyLimit]);

    return (
        <section className="border border-border rounded-xl bg-card">
            <header className="flex items-center gap-3 px-5 py-4 border-b border-border">
                <CurrencyDollar size={20} weight="duotone" className="text-emerald-500" />
                <div>
                    <h2 className="text-base font-semibold">Monthly budget</h2>
                    <p className="text-xs text-muted-foreground">
                        Caps spend across all agents in this organization. Hard limits reject
                        requests once the cap is reached; soft limits log a warning and proceed.
                    </p>
                </div>
            </header>

            <div className="px-5 py-4 space-y-5">
                {spend && (
                    <div className="flex items-center justify-between gap-4 rounded-lg bg-muted/50 px-4 py-3">
                        <div className="min-w-0">
                            <div className="text-xs text-muted-foreground">Current period spend</div>
                            <div className="text-lg font-semibold tabular-nums">
                                ${parseFloat(spend.spendUsd || '0').toFixed(2)}
                                {monthlyLimit && (
                                    <span className="text-sm font-normal text-muted-foreground ml-1">
                                        / ${parseFloat(monthlyLimit).toFixed(2)}
                                    </span>
                                )}
                            </div>
                        </div>
                        {spendPct !== null && (
                            <div className="w-32">
                                <div className="h-2 rounded-full bg-muted overflow-hidden">
                                    <div
                                        className={cn(
                                            'h-full',
                                            spendPct >= 90
                                                ? 'bg-red-500'
                                                : spendPct >= 75
                                                ? 'bg-amber-500'
                                                : 'bg-emerald-500',
                                        )}
                                        style={{ width: `${spendPct}%` }}
                                    />
                                </div>
                                <div className="text-xs text-muted-foreground text-right mt-1">
                                    {spendPct}%
                                </div>
                            </div>
                        )}
                    </div>
                )}

                <FieldRow
                    label="Monthly spend cap (USD)"
                    description="Leave blank for no cap. Combined dollar cost of every agent run in the period."
                >
                    <Input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="No cap"
                        value={monthlyLimit}
                        onChange={(e) => setMonthlyLimit(e.target.value)}
                        className="w-40"
                        disabled={loading || saving}
                    />
                </FieldRow>

                <FieldRow
                    label="Monthly image cap"
                    description="Combined image generations across the org. Leave blank for no cap."
                >
                    <Input
                        type="number"
                        min="0"
                        placeholder="No cap"
                        value={imageLimit}
                        onChange={(e) => setImageLimit(e.target.value)}
                        className="w-40"
                        disabled={loading || saving}
                    />
                </FieldRow>

                <FieldRow
                    label="Hard limit"
                    description="When on, requests are rejected once the cap is reached. When off, requests proceed and a warning is logged."
                >
                    <ToggleSwitch
                        enabled={hardLimit}
                        onChange={setHardLimit}
                        disabled={loading || saving}
                    />
                </FieldRow>

                <FieldRow
                    label="Alert thresholds (%)"
                    description="Percentages of the cap at which to fire a notification to org admins. Comma-separated."
                >
                    <Input
                        type="text"
                        placeholder="50, 75, 90"
                        value={thresholds}
                        onChange={(e) => setThresholds(e.target.value)}
                        className="w-40"
                        disabled={loading || saving}
                    />
                </FieldRow>

                <FieldRow
                    label="Reset day"
                    description="Day of the month the budget period resets (1-28)."
                >
                    <Input
                        type="number"
                        min="1"
                        max="28"
                        value={resetDay}
                        onChange={(e) => setResetDay(e.target.value)}
                        className="w-24"
                        disabled={loading || saving}
                    />
                </FieldRow>

                <div className="flex justify-end pt-2">
                    <Button onClick={handleSave} disabled={loading || saving || !resetDayValid}>
                        {saving ? 'Saving...' : 'Save'}
                    </Button>
                </div>
            </div>
        </section>
    );
}

// --- Rate limits tab ---

function RateLimitsTab() {
    const dispatch = useAppDispatch();
    const orgId = useAppSelector((s) => s.auth.currentOrganizationId);
    const limits = useAppSelector((s) => s.agentsGovernance.rateLimits);
    const loading = useAppSelector((s) => s.agentsGovernance.loadingRateLimits);

    useEffect(() => {
        if (!orgId) return;
        dispatch(fetchRateLimits());
    }, [dispatch, orgId]);

    return (
        <section className="border border-border rounded-xl bg-card">
            <header className="flex items-center gap-3 px-5 py-4 border-b border-border">
                <Gauge size={20} weight="duotone" className="text-violet-500" />
                <div>
                    <h2 className="text-base font-semibold">Rate limits</h2>
                    <p className="text-xs text-muted-foreground">
                        Per-org overrides for the five rate-limit buckets. Defaults are shown
                        until you override them. Lower limits help during cost incidents; raise
                        the per-user cap if a power user keeps getting throttled.
                    </p>
                </div>
            </header>

            <div className="divide-y divide-border">
                {loading && limits.length === 0 ? (
                    <div className="px-5 py-6 text-sm text-muted-foreground">Loading...</div>
                ) : (
                    limits.map((row) => <RateLimitRow key={row.kind} row={row} />)
                )}
            </div>
        </section>
    );
}

function RateLimitRow({ row }: { row: RateLimitState }) {
    const dispatch = useAppDispatch();
    const saving = useAppSelector((s) => s.agentsGovernance.savingRateLimit);
    const meta = RATE_LIMIT_LABELS[row.kind];

    const [limit, setLimit] = useState(row.limit.toString());
    const [windowSec, setWindowSec] = useState(row.windowSeconds.toString());

    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing form fields when the row prop changes after a save
        setLimit(row.limit.toString());
        setWindowSec(row.windowSeconds.toString());
    }, [row.limit, row.windowSeconds]);

    const dirty =
        limit !== row.limit.toString() || windowSec !== row.windowSeconds.toString();
    const parsedLimit = parseInt(limit, 10);
    const parsedWindow = parseInt(windowSec, 10);
    const valid =
        Number.isFinite(parsedLimit) &&
        parsedLimit > 0 &&
        Number.isFinite(parsedWindow) &&
        parsedWindow > 0;

    const handleSave = () => {
        if (!valid) return;
        dispatch(
            upsertRateLimit({ kind: row.kind, limit: parsedLimit, windowSeconds: parsedWindow }),
        );
    };

    const handleReset = () => {
        dispatch(deleteRateLimit({ kind: row.kind }));
    };

    return (
        <div className="px-5 py-4 flex items-center gap-4">
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <div className="text-sm font-medium">
                        {meta?.name ?? `Rate limit ${row.kind}`}
                    </div>
                    {!row.isOverride && (
                        <Badge variant="outline" className="text-xs">
                            Default
                        </Badge>
                    )}
                </div>
                {meta?.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{meta.description}</p>
                )}
            </div>
            <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                    <Input
                        type="number"
                        min="1"
                        value={limit}
                        onChange={(e) => setLimit(e.target.value)}
                        className="w-24"
                        disabled={saving}
                    />
                    <span className="text-xs text-muted-foreground">/</span>
                    <Input
                        type="number"
                        min="1"
                        value={windowSec}
                        onChange={(e) => setWindowSec(e.target.value)}
                        className="w-24"
                        disabled={saving}
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">sec</span>
                </div>
                {row.isOverride && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleReset}
                        disabled={saving}
                    >
                        Reset
                    </Button>
                )}
                <Button size="sm" onClick={handleSave} disabled={!dirty || !valid || saving}>
                    Save
                </Button>
            </div>
        </div>
    );
}

// --- Shared row primitive ---

function FieldRow({
    label,
    description,
    children,
}: {
    label: string;
    description?: string;
    children: React.ReactNode;
}) {
    return (
        <div className="flex items-start justify-between gap-6">
            <div className="min-w-0">
                <div className="text-sm font-medium">{label}</div>
                {description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                )}
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}
