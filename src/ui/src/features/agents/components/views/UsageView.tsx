import { useEffect, useMemo, useState } from "react";
import {
    ChartBar,
    Lightning,
    Clock,
    ChatCircle,
    CircleNotch,
    SortAscending,
    SortDescending,
    CaretUpDown,
    Cube,
    Key,
    Robot,
    Wrench,
    Timer,
    CheckCircle,
    Database,
    CurrencyDollar,
    Image as ImageIcon,
    ArrowsClockwise,
    Stop as StopIcon,
} from "@phosphor-icons/react";
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
    BarChart,
    Bar,
} from "recharts";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { formatCurrency } from "@/shared/utils/currencyFormatting";
import { useAdminAccess } from "@/features/admin";
import {
    selectUsageStats,
    selectUsageLoading,
    selectSelectedDays,
    selectSelectedInterval,
    setSelectedDays,
    setSelectedInterval,
} from "@/features/agents/store/agentUsageSlice";
import { fetchUsageStats } from "@/features/agents/store/agentUsageThunks";
import type { UsageStats } from "@/features/agents/store/agentUsageThunks";
import { selectAvailableModels } from "@/features/agents/store/agentProvidersSlice";
import { fetchAvailableModels } from "@/features/agents/store/agentProvidersThunks";
import { ProviderLogo } from "@/features/agents/components/ProviderLogo";


const TIME_RANGES = [
    { label: "7d", days: 7 },
    { label: "14d", days: 14 },
    { label: "30d", days: 30 },
    { label: "90d", days: 90 },
] as const;

const INTERVALS = [
    { label: "30m", value: "30m" },
    { label: "1h", value: "1h" },
    { label: "2h", value: "2h" },
    { label: "4h", value: "4h" },
    { label: "1d", value: "1d" },
] as const;

const CHART_PALETTE = [
    "#6366f1",
    "#3b82f6",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#06b6d4",
    "#ec4899",
];

function formatNumber(n: number): string {
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return n.toLocaleString();
}

function formatAxisTick(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
    return String(n);
}

function formatShortDate(dateStr: string): string {
    const d = new Date(dateStr + "T00:00:00");
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDuration(ms: number): string {
    if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
    if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`;
    return `${ms}ms`;
}

const SECONDARY_TONES = {
    emerald: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10',
    amber: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
    red: 'text-red-600 dark:text-red-400 bg-red-500/10',
} as const;

function SecondaryStat({
    label,
    value,
    subtitle,
    icon: Icon,
    tone,
}: {
    label: string;
    value: string;
    subtitle?: string;
    icon: React.ComponentType<{ size: number; className?: string }>;
    tone: keyof typeof SECONDARY_TONES;
}) {
    return (
        <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
            <div
                className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${SECONDARY_TONES[tone]}`}
            >
                <Icon size={18} />
            </div>
            <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {label}
                </p>
                <p className="text-lg font-semibold text-foreground tabular-nums">{value}</p>
                {subtitle && (
                    <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
                )}
            </div>
        </div>
    );
}

interface TooltipPayloadEntry {
    name: string;
    value: number;
    color: string;
}

function ChartTooltip({
    active,
    payload,
    label,
    valueFormatter = formatNumber,
}: {
    active?: boolean;
    payload?: TooltipPayloadEntry[];
    label?: string | number;
    valueFormatter?: (value: number) => string;
}) {
    if (!active || !payload?.length) return null;

    return (
        <div className="bg-card border border-border rounded-lg shadow-xl px-3 py-2.5 text-xs">
            <p className="font-medium text-foreground mb-1.5">{String(label)}</p>
            <div className="space-y-1">
                {payload.map((entry, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: entry.color }}
                        />
                        <span className="text-muted-foreground">{entry.name}</span>
                        <span className="ml-auto font-mono text-foreground">
                            {valueFormatter(entry.value)}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function StatCard({
    label,
    value,
    subtitle,
    icon: Icon,
    accentColor,
}: {
    label: string;
    value: string;
    subtitle?: string;
    icon: React.ComponentType<{ size: number; className?: string; style?: React.CSSProperties }>;
    accentColor: string;
}) {
    return (
        <div className="bg-card border border-border rounded-xl p-4 relative overflow-hidden group hover:border-primary/30 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
            <div
                aria-hidden
                className="pointer-events-none absolute -top-12 -right-12 w-32 h-32 rounded-full blur-2xl opacity-25 group-hover:opacity-40 transition-opacity duration-300"
                style={{ backgroundColor: accentColor }}
            />
            <div className="flex items-start justify-between mb-3 relative">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    {label}
                </span>
                <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center opacity-60"
                    style={{ backgroundColor: `${accentColor}15` }}
                >
                    <Icon
                        size={16}
                        className="transition-transform group-hover:scale-110"
                        style={{ color: accentColor }}
                    />
                </div>
            </div>
            <p className="relative text-2xl font-bold text-foreground tracking-tight">
                {value}
            </p>
            {subtitle && (
                <p className="relative text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
        </div>
    );
}

function formatChartTimestamp(dateStr: string, interval: string): string {
    if (interval === "1d") return formatShortDate(dateStr);
    // Sub-daily input is "YYYY-MM-DD HH:MM"
    const d = new Date(dateStr.replace(" ", "T"));
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    });
}

function DailyUsageChart({
    data,
    interval,
}: {
    data: UsageStats["dailyUsage"];
    interval: string;
}) {
    const chartData = useMemo(
        () =>
            data.map((d) => ({
                date: formatChartTimestamp(d.date, interval),
                "Input Tokens": d.inputTokens,
                "Output Tokens": d.outputTokens,
                "Cache Reads": d.cacheReadInputTokens,
            })),
        [data, interval]
    );

    const showDots = chartData.length <= 90;

    const tickInterval = useMemo(() => {
        const len = chartData.length;
        if (len <= 14) return 0;
        if (len <= 30) return 1;
        if (len <= 90) return Math.floor(len / 15);
        return Math.floor(len / 10);
    }, [chartData.length]);

    if (data.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
                No data for this period
            </div>
        );
    }

    return (
        <ResponsiveContainer width="100%" height={280}>
            <AreaChart
                data={chartData}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
                <defs>
                    <linearGradient id="gradInput" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART_PALETTE[0]} stopOpacity={0.25} />
                        <stop offset="100%" stopColor={CHART_PALETTE[0]} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gradOutput" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={CHART_PALETTE[1]} stopOpacity={0.2} />
                        <stop offset="100%" stopColor={CHART_PALETTE[1]} stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="gradCache" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity={0.2} />
                        <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                </defs>
                <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border, #333)"
                    vertical={false}
                />
                <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "var(--color-muted-foreground, #888)" }}
                    axisLine={{ stroke: "var(--color-border, #333)" }}
                    tickLine={false}
                    interval={tickInterval}
                    height={24}
                />
                <YAxis
                    tickFormatter={formatAxisTick}
                    tick={{ fontSize: 11, fill: "var(--color-muted-foreground, #888)" }}
                    axisLine={false}
                    tickLine={false}
                    width={48}
                />
                <RechartsTooltip
                    content={<ChartTooltip valueFormatter={formatNumber} />}
                />
                <Area
                    type="monotone"
                    dataKey="Input Tokens"
                    stroke={CHART_PALETTE[0]}
                    strokeWidth={2}
                    fill="url(#gradInput)"
                    dot={showDots ? { r: 3, fill: CHART_PALETTE[0], strokeWidth: 0 } : false}
                    activeDot={{ r: 5, fill: CHART_PALETTE[0], strokeWidth: 2, stroke: "#fff" }}
                    animationDuration={800}
                />
                <Area
                    type="monotone"
                    dataKey="Output Tokens"
                    stroke={CHART_PALETTE[1]}
                    strokeWidth={2}
                    fill="url(#gradOutput)"
                    dot={showDots ? { r: 3, fill: CHART_PALETTE[1], strokeWidth: 0 } : false}
                    activeDot={{ r: 5, fill: CHART_PALETTE[1], strokeWidth: 2, stroke: "#fff" }}
                    animationDuration={800}
                    animationBegin={200}
                />
                <Area
                    type="monotone"
                    dataKey="Cache Reads"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#gradCache)"
                    dot={showDots ? { r: 3, fill: "#10b981", strokeWidth: 0 } : false}
                    activeDot={{ r: 5, fill: "#10b981", strokeWidth: 2, stroke: "#fff" }}
                    animationDuration={800}
                    animationBegin={400}
                />
            </AreaChart>
        </ResponsiveContainer>
    );
}

function ModelBars({ data }: { data: UsageStats["modelUsage"] }) {
    const chartData = useMemo(
        () =>
            [...data]
                .sort(
                    (a, b) =>
                        b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens)
                )
                .map((m) => ({
                    name: m.model,
                    "Input Tokens": m.inputTokens,
                    "Output Tokens": m.outputTokens,
                })),
        [data]
    );

    if (data.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                No model data
            </div>
        );
    }

    const barHeight = Math.max(chartData.length * 36, 120);

    return (
        <ResponsiveContainer width="100%" height={barHeight}>
            <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
            >
                <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border, #333)"
                    horizontal={false}
                />
                <XAxis
                    type="number"
                    tickFormatter={formatAxisTick}
                    tick={{
                        fontSize: 10,
                        fill: "var(--color-muted-foreground, #888)",
                    }}
                    axisLine={false}
                    tickLine={false}
                />
                <YAxis
                    type="category"
                    dataKey="name"
                    tick={{
                        fontSize: 10,
                        fill: "var(--color-muted-foreground, #888)",
                    }}
                    axisLine={false}
                    tickLine={false}
                    width={120}
                />
                <RechartsTooltip
                    content={<ChartTooltip valueFormatter={formatNumber} />}
                />
                <Bar
                    dataKey="Input Tokens"
                    stackId="tokens"
                    fill={CHART_PALETTE[0]}
                    animationDuration={600}
                />
                <Bar
                    dataKey="Output Tokens"
                    stackId="tokens"
                    fill={CHART_PALETTE[1]}
                    radius={[0, 4, 4, 0]}
                    animationDuration={600}
                    animationBegin={200}
                />
            </BarChart>
        </ResponsiveContainer>
    );
}

function AgentUsageBars({ data }: { data: UsageStats["agentUsage"] }) {
    const chartData = useMemo(() => {
        const withTotal = data.map((a) => ({
            name: a.agentName,
            "Input Tokens": a.inputTokens,
            "Output Tokens": a.outputTokens,
        }));
        return withTotal
            .sort(
                (a, b) =>
                    b["Input Tokens"] +
                    b["Output Tokens"] -
                    (a["Input Tokens"] + a["Output Tokens"])
            )
            .slice(0, 8);
    }, [data]);

    if (data.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                No agent data
            </div>
        );
    }

    return (
        <ResponsiveContainer width="100%" height={220}>
            <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
            >
                <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border, #333)"
                    horizontal={false}
                />
                <XAxis
                    type="number"
                    tickFormatter={formatAxisTick}
                    tick={{
                        fontSize: 11,
                        fill: "var(--color-muted-foreground, #888)",
                    }}
                    axisLine={false}
                    tickLine={false}
                />
                <YAxis
                    type="category"
                    dataKey="name"
                    tick={{
                        fontSize: 11,
                        fill: "var(--color-muted-foreground, #888)",
                    }}
                    axisLine={false}
                    tickLine={false}
                    width={100}
                />
                <RechartsTooltip
                    content={<ChartTooltip valueFormatter={formatNumber} />}
                />
                <Bar
                    dataKey="Input Tokens"
                    stackId="tokens"
                    fill={CHART_PALETTE[0]}
                    animationDuration={600}
                />
                <Bar
                    dataKey="Output Tokens"
                    stackId="tokens"
                    fill={CHART_PALETTE[1]}
                    radius={[0, 4, 4, 0]}
                    animationDuration={600}
                    animationBegin={200}
                />
            </BarChart>
        </ResponsiveContainer>
    );
}

function ToolUsageBars({ data }: { data: UsageStats["toolUsage"] }) {
    const chartData = useMemo(
        () =>
            [...data]
                .sort((a, b) => b.callCount - a.callCount)
                .slice(0, 10)
                .map((t) => ({ name: t.toolName, Calls: t.callCount })),
        [data]
    );

    if (data.length === 0) {
        return (
            <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
                No tool data
            </div>
        );
    }

    const barHeight = Math.max(chartData.length * 32, 120);

    return (
        <ResponsiveContainer width="100%" height={barHeight}>
            <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
            >
                <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border, #333)"
                    horizontal={false}
                />
                <XAxis
                    type="number"
                    tickFormatter={formatAxisTick}
                    tick={{
                        fontSize: 11,
                        fill: "var(--color-muted-foreground, #888)",
                    }}
                    axisLine={false}
                    tickLine={false}
                />
                <YAxis
                    type="category"
                    dataKey="name"
                    tick={{
                        fontSize: 11,
                        fill: "var(--color-muted-foreground, #888)",
                    }}
                    axisLine={false}
                    tickLine={false}
                    width={140}
                />
                <RechartsTooltip
                    content={<ChartTooltip valueFormatter={formatNumber} />}
                />
                <Bar
                    dataKey="Calls"
                    fill={CHART_PALETTE[2]}
                    radius={[0, 4, 4, 0]}
                    animationDuration={600}
                />
            </BarChart>
        </ResponsiveContainer>
    );
}

function ProviderKeyBars({ data }: { data: UsageStats["providerKeyUsage"] }) {
    const chartData = useMemo(() => {
        return [...data]
            .sort((a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens))
            .slice(0, 10)
            .map((p) => ({
                name: `${p.keyLabel} (${p.provider})`,
                "Input Tokens": p.inputTokens,
                "Output Tokens": p.outputTokens,
            }));
    }, [data]);

    if (data.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                No provider key data
            </div>
        );
    }

    const barHeight = Math.max(chartData.length * 36, 120);

    return (
        <ResponsiveContainer width="100%" height={barHeight}>
            <BarChart
                data={chartData}
                layout="vertical"
                margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
            >
                <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--color-border, #333)"
                    horizontal={false}
                />
                <XAxis
                    type="number"
                    tickFormatter={formatAxisTick}
                    tick={{
                        fontSize: 11,
                        fill: "var(--color-muted-foreground, #888)",
                    }}
                    axisLine={false}
                    tickLine={false}
                />
                <YAxis
                    type="category"
                    dataKey="name"
                    tick={{
                        fontSize: 11,
                        fill: "var(--color-muted-foreground, #888)",
                    }}
                    axisLine={false}
                    tickLine={false}
                    width={140}
                />
                <RechartsTooltip
                    content={<ChartTooltip valueFormatter={formatNumber} />}
                />
                <Bar
                    dataKey="Input Tokens"
                    stackId="tokens"
                    fill={CHART_PALETTE[4]}
                    animationDuration={600}
                />
                <Bar
                    dataKey="Output Tokens"
                    stackId="tokens"
                    fill={CHART_PALETTE[5]}
                    radius={[0, 4, 4, 0]}
                    animationDuration={600}
                    animationBegin={200}
                />
            </BarChart>
        </ResponsiveContainer>
    );
}

type SortDirection = "asc" | "desc";

interface TableColumn {
    key: string;
    label: string;
    align?: "left" | "right";
    // Gets the whole row so a cell can decorate itself from a sibling field
    // (the provider logo next to a key or model name). Sorting still runs on
    // the raw value, so a decorated cell orders the same as a plain one.
    format?: (value: number | string, row: TableRow) => React.ReactNode;
    mono?: boolean;
}

interface TableRow {
    [key: string]: string | number;
}

function SortableTable({
    columns,
    rows,
    defaultSortKey,
    defaultSortDir = "desc",
    icon: Icon,
    title,
}: {
    columns: TableColumn[];
    rows: TableRow[];
    defaultSortKey: string;
    defaultSortDir?: SortDirection;
    icon: React.ComponentType<{ size: number; className?: string }>;
    title: string;
}) {
    const [sortKey, setSortKey] = useState(defaultSortKey);
    const [sortDir, setSortDir] = useState<SortDirection>(defaultSortDir);

    const sorted = useMemo(() => {
        return [...rows].sort((a, b) => {
            const av = a[sortKey];
            const bv = b[sortKey];
            if (typeof av === "number" && typeof bv === "number") {
                return sortDir === "asc" ? av - bv : bv - av;
            }
            return sortDir === "asc"
                ? String(av).localeCompare(String(bv))
                : String(bv).localeCompare(String(av));
        });
    }, [rows, sortKey, sortDir]);

    const handleSort = (key: string) => {
        if (key === sortKey) {
            setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        } else {
            setSortKey(key);
            setSortDir("desc");
        }
    };

    return (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <Icon size={16} className="text-muted-foreground" />
                <h3 className="font-medium text-foreground text-sm">{title}</h3>
                <span className="ml-auto text-xs text-muted-foreground">
                    {rows.length} {rows.length === 1 ? "entry" : "entries"}
                </span>
            </div>
            {rows.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                    No data available
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-border bg-muted/30">
                                {columns.map((col) => {
                                    const isActive = sortKey === col.key;
                                    return (
                                        <th
                                            key={col.key}
                                            className={cn(
                                                "px-4 py-2.5 text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer select-none hover:text-foreground transition-colors group/th",
                                                col.align === "right"
                                                    ? "text-right"
                                                    : "text-left"
                                            )}
                                            onClick={() => handleSort(col.key)}
                                        >
                                            <span className="inline-flex items-center gap-1">
                                                {col.label}
                                                {isActive ? (
                                                    sortDir === "asc" ? (
                                                        <SortAscending
                                                            size={12}
                                                            weight="bold"
                                                            className="text-primary"
                                                        />
                                                    ) : (
                                                        <SortDescending
                                                            size={12}
                                                            weight="bold"
                                                            className="text-primary"
                                                        />
                                                    )
                                                ) : (
                                                    <CaretUpDown
                                                        size={12}
                                                        className="opacity-0 group-hover/th:opacity-40 transition-opacity"
                                                    />
                                                )}
                                            </span>
                                        </th>
                                    );
                                })}
                            </tr>
                        </thead>
                        <tbody>
                            {sorted.map((row, i) => (
                                <tr
                                    key={i}
                                    className="border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors"
                                >
                                    {columns.map((col) => {
                                        const raw = row[col.key];
                                        const display = col.format
                                            ? col.format(raw, row)
                                            : typeof raw === "number"
                                              ? raw.toLocaleString()
                                              : String(raw);
                                        return (
                                            <td
                                                key={col.key}
                                                className={cn(
                                                    "px-4 py-2.5 text-foreground",
                                                    col.align === "right" &&
                                                        "text-right",
                                                    col.mono &&
                                                        "font-mono text-xs"
                                                )}
                                            >
                                                {display}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function TokenLegend() {
    return (
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
                <span
                    className="w-3 h-2 rounded-sm inline-block"
                    style={{ backgroundColor: CHART_PALETTE[0] }}
                />
                Input
            </span>
            <span className="flex items-center gap-1.5">
                <span
                    className="w-3 h-2 rounded-sm inline-block"
                    style={{ backgroundColor: CHART_PALETTE[1] }}
                />
                Output
            </span>
        </div>
    );
}

export function UsageView() {
    const dispatch = useAppDispatch();
    const stats = useAppSelector(selectUsageStats);
    const loading = useAppSelector(selectUsageLoading);
    const selectedDays = useAppSelector(selectSelectedDays);
    const selectedInterval = useAppSelector(selectSelectedInterval);
    const { isOrgAdmin, isSystemAdmin } = useAdminAccess();
    const isAdmin = isOrgAdmin || isSystemAdmin;

    const availableModels = useAppSelector(selectAvailableModels);

    useEffect(() => {
        dispatch(fetchUsageStats({ days: selectedDays, interval: selectedInterval }));
    }, [dispatch, selectedDays, selectedInterval]);

    useEffect(() => {
        // Settings > AI renders this outside the agents layout, where the catalog
        // is normally prefetched. The thunk no-ops when it is already loaded.
        dispatch(fetchAvailableModels());
    }, [dispatch]);

    // Usage rows carry a model id but no provider, so the catalog supplies it.
    const providerByModel = useMemo(() => {
        const byModel: Record<string, string> = {};
        for (const model of availableModels) {
            byModel[model.id] = model.provider;
        }
        return byModel;
    }, [availableModels]);

    if (loading && !stats) {
        return (
            <div className="flex flex-col h-full items-center justify-center gap-3">
                <CircleNotch
                    size={32}
                    className="animate-spin text-muted-foreground"
                />
                <p className="text-sm text-muted-foreground">
                    Loading usage data...
                </p>
            </div>
        );
    }

    if (!stats) {
        return (
            <div className="flex flex-col h-full items-center justify-center gap-4">
                <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center">
                    <ChartBar size={32} className="text-muted-foreground" />
                </div>
                <div className="text-center">
                    <h2 className="text-lg font-semibold text-foreground">
                        No Usage Data
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                        Start chatting with an agent to see analytics and usage
                        breakdowns here.
                    </p>
                </div>
            </div>
        );
    }

    const totalTokens = stats.totalInputTokens + stats.totalOutputTokens;
    const avgTokensPerRun =
        stats.totalRuns > 0 ? Math.round(totalTokens / stats.totalRuns) : 0;

    const modelRows: TableRow[] = stats.modelUsage.map((m) => ({
        model: m.model,
        provider: providerByModel[m.model] ?? "",
        runs: m.runs,
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        totalTokens: m.inputTokens + m.outputTokens,
        cost: parseFloat(m.cost) || 0,
    }));

    const agentRows: TableRow[] = stats.agentUsage.map((a) => ({
        agent: a.agentName,
        runs: a.runs,
        inputTokens: a.inputTokens,
        outputTokens: a.outputTokens,
        totalTokens: a.inputTokens + a.outputTokens,
    }));

    const toolRows: TableRow[] = stats.toolUsage.map((t) => ({
        tool: t.toolName,
        calls: t.callCount,
    }));

    const providerKeyRows: TableRow[] = stats.providerKeyUsage.map((p) => ({
        key: `${p.keyLabel} (${p.provider})`,
        provider: p.provider,
        runs: p.runs,
        inputTokens: p.inputTokens,
        outputTokens: p.outputTokens,
        totalTokens: p.inputTokens + p.outputTokens,
    }));

    const fmtNum = (v: number | string) => formatNumber(v as number);

    return (
        <div className="flex-1 overflow-y-auto">
            <div className="max-w-[1400px] mx-auto p-6 space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-foreground tracking-tight">
                            Usage Analytics
                        </h2>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            {isAdmin
                                ? "Organization-wide token consumption, model distribution, and agent activity"
                                : "Your personal token consumption, model distribution, and agent activity"}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        {loading && (
                            <CircleNotch
                                size={14}
                                className="animate-spin text-muted-foreground"
                            />
                        )}
                        <div className="flex items-center bg-muted/50 rounded-lg p-0.5 border border-border">
                            {TIME_RANGES.map((r) => (
                                <button
                                    key={r.days}
                                    type="button"
                                    onClick={() => dispatch(setSelectedDays(r.days))}
                                    className={cn(
                                        "px-3 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer",
                                        selectedDays === r.days
                                            ? "bg-primary text-primary-foreground shadow-sm"
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    {r.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                    <StatCard
                        label="Total Cost"
                        value={formatCurrency(stats.totalCost, stats.displayCurrency)}
                        icon={CurrencyDollar}
                        subtitle={
                            stats.totalImageCount > 0
                                ? `${formatNumber(stats.totalImageCount)} images`
                                : `${formatNumber(stats.totalRuns)} runs`
                        }
                        accentColor={CHART_PALETTE[0]}
                    />
                    <StatCard
                        label="Total Tokens"
                        value={formatNumber(totalTokens)}
                        icon={ChartBar}
                        subtitle={`${formatNumber(stats.totalInputTokens)} in / ${formatNumber(stats.totalOutputTokens)} out`}
                        accentColor={CHART_PALETTE[1]}
                    />
                    <StatCard
                        label="Cache Reads"
                        value={formatNumber(stats.totalCacheReadInputTokens)}
                        icon={Database}
                        subtitle={
                            stats.totalCacheReadInputTokens + stats.totalInputTokens > 0
                                ? `${Math.round((stats.totalCacheReadInputTokens / (stats.totalCacheReadInputTokens + stats.totalInputTokens)) * 100)}% of prompt from cache`
                                : "no input yet"
                        }
                        accentColor="#10b981"
                    />
                    <StatCard
                        label="Avg Duration"
                        value={formatDuration(stats.avgDurationMs)}
                        icon={Clock}
                        subtitle={`${formatNumber(avgTokensPerRun)} tokens/run avg`}
                        accentColor={CHART_PALETTE[2]}
                    />
                    <StatCard
                        label="Sessions"
                        value={formatNumber(stats.totalSessions)}
                        icon={ChatCircle}
                        subtitle={`across ${stats.agentUsage.length} agents`}
                        accentColor={CHART_PALETTE[3]}
                    />
                </div>

                {/* Robustness signals - only render when something fired */}
                {(stats.totalRetries > 0 ||
                    stats.totalCancelled > 0 ||
                    stats.totalDeadlineExceeded > 0 ||
                    stats.totalImageCount > 0) && (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <SecondaryStat
                            label="Images generated"
                            value={formatNumber(stats.totalImageCount)}
                            icon={ImageIcon}
                            tone="emerald"
                        />
                        <SecondaryStat
                            label="Retries"
                            value={formatNumber(stats.totalRetries)}
                            icon={ArrowsClockwise}
                            tone="amber"
                            subtitle="provider failovers"
                        />
                        <SecondaryStat
                            label="Cancelled"
                            value={formatNumber(stats.totalCancelled)}
                            icon={StopIcon}
                            tone="red"
                            subtitle="user-initiated stops"
                        />
                        <SecondaryStat
                            label="Deadline hits"
                            value={formatNumber(stats.totalDeadlineExceeded)}
                            icon={Timer}
                            tone="red"
                            subtitle="runtime limit exceeded"
                        />
                    </div>
                )}

                <div className="bg-card border border-border rounded-xl p-5">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="font-semibold text-foreground text-sm">
                            Token Usage
                        </h3>
                        <div className="flex items-center gap-3">
                            <div className="flex items-center bg-muted/50 rounded-lg p-0.5 border border-border">
                                {INTERVALS.map((iv) => (
                                    <button
                                        key={iv.value}
                                        type="button"
                                        onClick={() => dispatch(setSelectedInterval(iv.value))}
                                        className={cn(
                                            "px-2.5 py-1 text-xs font-medium rounded-md transition-all cursor-pointer",
                                            selectedInterval === iv.value
                                                ? "bg-primary text-primary-foreground shadow-sm"
                                                : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        {iv.label}
                                    </button>
                                ))}
                            </div>
                            <TokenLegend />
                        </div>
                    </div>
                    <DailyUsageChart data={stats.dailyUsage} interval={selectedInterval} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="bg-card border border-border rounded-xl p-5">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <Cube
                                    size={16}
                                    className="text-muted-foreground"
                                />
                                <h3 className="font-semibold text-foreground text-sm">
                                    Model Distribution
                                </h3>
                            </div>
                            <TokenLegend />
                        </div>
                        <ModelBars data={stats.modelUsage} />
                    </div>
                    <div className="bg-card border border-border rounded-xl p-5">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <Robot
                                    size={16}
                                    className="text-muted-foreground"
                                />
                                <h3 className="font-semibold text-foreground text-sm">
                                    Agent Activity
                                </h3>
                            </div>
                            <TokenLegend />
                        </div>
                        <AgentUsageBars data={stats.agentUsage} />
                    </div>
                </div>

                {stats.providerKeyUsage.length > 0 && (
                    <div className="bg-card border border-border rounded-xl p-5">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <Key
                                    size={16}
                                    className="text-muted-foreground"
                                />
                                <h3 className="font-semibold text-foreground text-sm">
                                    Provider Keys
                                </h3>
                            </div>
                            <TokenLegend />
                        </div>
                        <ProviderKeyBars data={stats.providerKeyUsage} />
                    </div>
                )}

                {stats.cronTotalRuns > 0 && (
                    <>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                            <StatCard
                                label="Cron Runs"
                                value={formatNumber(stats.cronTotalRuns)}
                                icon={Timer}
                                subtitle={`${formatNumber(stats.cronUsage.length)} tasks`}
                                accentColor={CHART_PALETTE[5]}
                            />
                            <StatCard
                                label="Success Rate"
                                value={
                                    stats.cronTotalRuns > 0
                                        ? `${Math.round((stats.cronTotalSuccesses / stats.cronTotalRuns) * 100)}%`
                                        : "N/A"
                                }
                                icon={CheckCircle}
                                subtitle={`${formatNumber(stats.cronTotalSuccesses)} passed / ${formatNumber(stats.cronTotalFailures)} failed`}
                                accentColor={
                                    stats.cronTotalFailures > 0
                                        ? CHART_PALETTE[4]
                                        : CHART_PALETTE[2]
                                }
                            />
                            <StatCard
                                label="Cron Input Tokens"
                                value={formatNumber(stats.cronTotalInputTokens)}
                                icon={Lightning}
                                subtitle="from scheduled runs"
                                accentColor={CHART_PALETTE[0]}
                            />
                            <StatCard
                                label="Cron Output Tokens"
                                value={formatNumber(stats.cronTotalOutputTokens)}
                                icon={ChartBar}
                                subtitle="from scheduled runs"
                                accentColor={CHART_PALETTE[1]}
                            />
                        </div>
                        <SortableTable
                            title="Scheduled Task Breakdown"
                            icon={Timer}
                            defaultSortKey="totalRuns"
                            columns={[
                                { key: "task", label: "Task" },
                                { key: "agent", label: "Agent" },
                                {
                                    key: "totalRuns",
                                    label: "Runs",
                                    align: "right",
                                    format: fmtNum,
                                },
                                {
                                    key: "successes",
                                    label: "OK",
                                    align: "right",
                                    format: fmtNum,
                                },
                                {
                                    key: "failures",
                                    label: "Failed",
                                    align: "right",
                                    format: fmtNum,
                                },
                                {
                                    key: "totalTokens",
                                    label: "Tokens",
                                    align: "right",
                                    format: fmtNum,
                                },
                            ]}
                            rows={stats.cronUsage.map((c) => ({
                                task: c.taskName,
                                agent: c.agentName,
                                totalRuns: c.totalRuns,
                                successes: c.successes,
                                failures: c.failures,
                                totalTokens: c.inputTokens + c.outputTokens,
                            }))}
                        />
                    </>
                )}

                <div className="bg-card border border-border rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-4">
                        <Wrench
                            size={16}
                            className="text-muted-foreground"
                        />
                        <h3 className="font-semibold text-foreground text-sm">
                            Tool Calls
                        </h3>
                    </div>
                    <ToolUsageBars data={stats.toolUsage} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <SortableTable
                        title="Model Breakdown"
                        icon={Cube}
                        defaultSortKey="totalTokens"
                        columns={[
                            {
                                key: "model",
                                label: "Model",
                                mono: true,
                                format: (value, row) => (
                                    <span className="inline-flex items-center gap-1.5">
                                        <ProviderLogo
                                            provider={String(row.provider)}
                                            size="sm"
                                        />
                                        {String(value)}
                                    </span>
                                ),
                            },
                            {
                                key: "runs",
                                label: "Runs",
                                align: "right",
                                format: fmtNum,
                            },
                            {
                                key: "inputTokens",
                                label: "Input",
                                align: "right",
                                format: fmtNum,
                            },
                            {
                                key: "outputTokens",
                                label: "Output",
                                align: "right",
                                format: fmtNum,
                            },
                            {
                                key: "totalTokens",
                                label: "Total",
                                align: "right",
                                format: fmtNum,
                            },
                            {
                                key: "cost",
                                label: "Cost",
                                align: "right",
                                format: (v: unknown) =>
                                    typeof v === "number"
                                        ? formatCurrency(v, stats.displayCurrency)
                                        : "—",
                            },
                        ]}
                        rows={modelRows}
                    />
                    <SortableTable
                        title="Agent Breakdown"
                        icon={Robot}
                        defaultSortKey="totalTokens"
                        columns={[
                            { key: "agent", label: "Agent" },
                            {
                                key: "runs",
                                label: "Runs",
                                align: "right",
                                format: fmtNum,
                            },
                            {
                                key: "inputTokens",
                                label: "Input",
                                align: "right",
                                format: fmtNum,
                            },
                            {
                                key: "outputTokens",
                                label: "Output",
                                align: "right",
                                format: fmtNum,
                            },
                            {
                                key: "totalTokens",
                                label: "Total",
                                align: "right",
                                format: fmtNum,
                            },
                        ]}
                        rows={agentRows}
                    />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <SortableTable
                        title="Tool Usage"
                        icon={Wrench}
                        defaultSortKey="calls"
                        columns={[
                            { key: "tool", label: "Tool", mono: true },
                            {
                                key: "calls",
                                label: "Calls",
                                align: "right",
                                format: fmtNum,
                            },
                        ]}
                        rows={toolRows}
                    />
                    <SortableTable
                        title="Provider Key Breakdown"
                        icon={Key}
                        defaultSortKey="totalTokens"
                        columns={[
                            {
                                key: "key",
                                label: "Key",
                                format: (value, row) => (
                                    <span className="inline-flex items-center gap-1.5">
                                        <ProviderLogo
                                            provider={String(row.provider)}
                                            size="sm"
                                        />
                                        {String(value)}
                                    </span>
                                ),
                            },
                            {
                                key: "runs",
                                label: "Runs",
                                align: "right",
                                format: fmtNum,
                            },
                            {
                                key: "inputTokens",
                                label: "Input",
                                align: "right",
                                format: fmtNum,
                            },
                            {
                                key: "outputTokens",
                                label: "Output",
                                align: "right",
                                format: fmtNum,
                            },
                            {
                                key: "totalTokens",
                                label: "Total",
                                align: "right",
                                format: fmtNum,
                            },
                        ]}
                        rows={providerKeyRows}
                    />
                </div>
            </div>
        </div>
    );
}
