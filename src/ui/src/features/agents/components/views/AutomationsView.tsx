import { useEffect, useMemo, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
    Plus,
    Trash,
    Timer,
    Play,
    Pause,
    Clock,
    CircleNotch,
    CheckCircle,
    XCircle,
    ArrowClockwise,
    CaretRight,
    Robot,
    Lightning,
} from "@phosphor-icons/react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { cn } from "@/shared/utils/cn";
import { loadPanelLayout, savePanelLayout } from "@/shared/utils/panelStorage";
import { formatRelativeTime } from "@/shared/utils/dateFormatting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
    selectCronTasksList,
    selectCronLoading,
    selectCronRunLogs,
} from "@/features/agents/store/agentCronSlice";
import {
    fetchCronTasks,
    createCronTask,
    updateCronTask,
    deleteCronTask,
    fetchCronRunLogs,
    triggerCronTask,
} from "@/features/agents/store/agentCronThunks";
import type { SerializedCronTask } from "@/features/agents/store/agentCronThunks";

// Schedule builder types and helpers

type Frequency = "minutes" | "hourly" | "daily" | "weekly" | "monthly";

interface ScheduleConfig {
    frequency: Frequency;
    minuteInterval: number;    // for "minutes": every N minutes
    hour: number;              // 0-23, for daily/weekly/monthly
    minute: number;            // 0-59, for daily/weekly/monthly
    weekdays: number[];        // 0=Sun..6=Sat, for weekly
    monthDay: number;          // 1-31, for monthly
}

const DEFAULT_SCHEDULE: ScheduleConfig = {
    frequency: "daily",
    minuteInterval: 30,
    hour: 9,
    minute: 0,
    weekdays: [1, 2, 3, 4, 5],
    monthDay: 1,
};

const FREQUENCY_OPTIONS = [
    { value: "minutes" as Frequency, label: "Every X minutes" },
    { value: "hourly" as Frequency, label: "Every hour" },
    { value: "daily" as Frequency, label: "Daily" },
    { value: "weekly" as Frequency, label: "Weekly" },
    { value: "monthly" as Frequency, label: "Monthly" },
];

const MINUTE_INTERVAL_OPTIONS = [
    { value: 5, label: "5 minutes" },
    { value: 10, label: "10 minutes" },
    { value: 15, label: "15 minutes" },
    { value: 30, label: "30 minutes" },
];

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const MONTH_DAY_OPTIONS = Array.from({ length: 31 }, (_, i) => ({
    value: i + 1,
    label: `${i + 1}${ordinalSuffix(i + 1)}`,
}));

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
    value: i,
    label: formatHour(i),
}));

const MINUTE_OPTIONS = [
    { value: 0, label: ":00" },
    { value: 15, label: ":15" },
    { value: 30, label: ":30" },
    { value: 45, label: ":45" },
];

function ordinalSuffix(n: number): string {
    if (n >= 11 && n <= 13) return "th";
    switch (n % 10) {
        case 1: return "st";
        case 2: return "nd";
        case 3: return "rd";
        default: return "th";
    }
}

function formatHour(h: number): string {
    if (h === 0) return "12 AM";
    if (h === 12) return "12 PM";
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function scheduleToCron(config: ScheduleConfig): string {
    switch (config.frequency) {
        case "minutes":
            return `*/${config.minuteInterval} * * * *`;
        case "hourly":
            return `${config.minute} * * * *`;
        case "daily":
            return `${config.minute} ${config.hour} * * *`;
        case "weekly": {
            const days = config.weekdays.length > 0
                ? config.weekdays.sort((a, b) => a - b).join(",")
                : "*";
            return `${config.minute} ${config.hour} * * ${days}`;
        }
        case "monthly":
            return `${config.minute} ${config.hour} ${config.monthDay} * *`;
    }
}

function cronToHuman(cron: string): string {
    const parts = cron.split(" ");
    if (parts.length !== 5) return cron;
    const [min, hour, dom, , dow] = parts;

    // Every N minutes
    if (min.startsWith("*/") && hour === "*") {
        return `Every ${min.slice(2)} minutes`;
    }
    // Every hour
    if (hour === "*" && dom === "*" && dow === "*") {
        return min === "0" ? "Every hour" : `Every hour at :${min.padStart(2, "0")}`;
    }

    const timeStr = formatHour(Number(hour))
        + (Number(min) > 0 ? `:${min.padStart(2, "0")}` : "");

    // Monthly
    if (dom !== "*" && dow === "*") {
        return `${ordinalSuffix(Number(dom))} of every month at ${timeStr}`;
    }

    // Weekly
    if (dow !== "*" && dom === "*") {
        const dayNames = dow.split(",").map((d) => {
            const num = Number(d);
            // Handle ranges like 1-5
            if (d.includes("-")) {
                const [start, end] = d.split("-").map(Number);
                if (start === 1 && end === 5) return "weekdays";
                if (start === 0 && end === 6) return "every day";
                return `${WEEKDAY_LABELS[start]}-${WEEKDAY_LABELS[end]}`;
            }
            return WEEKDAY_LABELS[num] ?? d;
        });
        if (dayNames.length === 1 && dayNames[0] === "weekdays") {
            return `Weekdays at ${timeStr}`;
        }
        if (dayNames.length === 7 || (dayNames.length === 1 && dayNames[0] === "every day")) {
            return `Daily at ${timeStr}`;
        }
        return `${dayNames.join(", ")} at ${timeStr}`;
    }

    // Daily
    if (dom === "*" && dow === "*") {
        return `Daily at ${timeStr}`;
    }

    return cron;
}

const TIMEZONE_OPTIONS = [
    { value: "UTC", label: "UTC" },
    { value: "America/New_York", label: "US Eastern" },
    { value: "America/Chicago", label: "US Central" },
    { value: "America/Denver", label: "US Mountain" },
    { value: "America/Los_Angeles", label: "US Pacific" },
    { value: "Europe/London", label: "London" },
    { value: "Europe/Berlin", label: "Berlin" },
    { value: "Europe/Paris", label: "Paris" },
    { value: "Asia/Tokyo", label: "Tokyo" },
    { value: "Asia/Shanghai", label: "Shanghai" },
    { value: "Australia/Sydney", label: "Sydney" },
];

function protoTimestampToDateStr(ts?: { seconds: number; nanos: number }): string | undefined {
    if (!ts) return undefined;
    return new Date(ts.seconds * 1000).toISOString();
}

// Schedule Builder component

function ScheduleBuilder({
    value,
    onChange,
}: {
    value: ScheduleConfig;
    onChange: (config: ScheduleConfig) => void;
}) {
    const toggleWeekday = (day: number) => {
        const next = value.weekdays.includes(day)
            ? value.weekdays.filter((d) => d !== day)
            : [...value.weekdays, day];
        onChange({ ...value, weekdays: next });
    };

    const selectWeekdayPreset = (preset: "weekdays" | "everyday" | "weekends") => {
        const map = {
            weekdays: [1, 2, 3, 4, 5],
            everyday: [0, 1, 2, 3, 4, 5, 6],
            weekends: [0, 6],
        };
        onChange({ ...value, weekdays: map[preset] });
    };

    return (
        <div className="space-y-4">
            {/* Frequency */}
            <div>
                <label className="block text-sm text-muted-foreground mb-1.5">Repeat</label>
                <Select<string>
                    value={value.frequency}
                    onChange={(f) => onChange({ ...value, frequency: f as Frequency })}
                    options={FREQUENCY_OPTIONS}
                />
            </div>

            {/* Minutes interval */}
            {value.frequency === "minutes" && (
                <div>
                    <label className="block text-sm text-muted-foreground mb-1.5">Interval</label>
                    <Select<number>
                        value={value.minuteInterval}
                        onChange={(v) => onChange({ ...value, minuteInterval: v })}
                        options={MINUTE_INTERVAL_OPTIONS}
                    />
                </div>
            )}

            {/* Time picker for hourly/daily/weekly/monthly */}
            {value.frequency !== "minutes" && (
                <div>
                    <label className="block text-sm text-muted-foreground mb-1.5">
                        {value.frequency === "hourly" ? "At minute" : "Time"}
                    </label>
                    {value.frequency === "hourly" ? (
                        <Select<number>
                            value={value.minute}
                            onChange={(m) => onChange({ ...value, minute: m })}
                            options={MINUTE_OPTIONS}
                        />
                    ) : (
                        <div className="flex gap-2">
                            <div className="flex-1">
                                <Select<number>
                                    value={value.hour}
                                    onChange={(h) => onChange({ ...value, hour: h })}
                                    options={HOUR_OPTIONS}
                                />
                            </div>
                            <div className="w-24">
                                <Select<number>
                                    value={value.minute}
                                    onChange={(m) => onChange({ ...value, minute: m })}
                                    options={MINUTE_OPTIONS}
                                />
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Weekday picker */}
            {value.frequency === "weekly" && (
                <div>
                    <label className="block text-sm text-muted-foreground mb-1.5">Days</label>
                    <div className="flex gap-1 mb-2">
                        {WEEKDAY_LABELS.map((label, i) => {
                            const active = value.weekdays.includes(i);
                            return (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={() => toggleWeekday(i)}
                                    className={cn(
                                        "flex-1 py-1.5 rounded-md text-xs font-medium transition-colors",
                                        active
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-muted text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => selectWeekdayPreset("weekdays")}
                            className="text-xs text-primary hover:underline"
                        >
                            Weekdays
                        </button>
                        <button
                            type="button"
                            onClick={() => selectWeekdayPreset("weekends")}
                            className="text-xs text-primary hover:underline"
                        >
                            Weekends
                        </button>
                        <button
                            type="button"
                            onClick={() => selectWeekdayPreset("everyday")}
                            className="text-xs text-primary hover:underline"
                        >
                            Every day
                        </button>
                    </div>
                </div>
            )}

            {/* Month day picker */}
            {value.frequency === "monthly" && (
                <div>
                    <label className="block text-sm text-muted-foreground mb-1.5">Day of month</label>
                    <Select<number>
                        value={value.monthDay}
                        onChange={(d) => onChange({ ...value, monthDay: d })}
                        options={MONTH_DAY_OPTIONS}
                    />
                </div>
            )}

            {/* Preview */}
            <div className="bg-muted/50 border border-border rounded-lg px-3 py-2">
                <span className="text-xs text-muted-foreground">Schedule: </span>
                <span className="text-sm font-medium text-foreground">
                    {cronToHuman(scheduleToCron(value))}
                </span>
            </div>
        </div>
    );
}

// Sub-components

function TaskStatusBadge({ task }: { task: SerializedCronTask }) {
    if (!task.isEnabled && task.consecutiveFailures >= task.maxConsecutiveFailures) {
        return (
            <Badge variant="destructive" className="text-xs">
                Auto-disabled
            </Badge>
        );
    }
    if (!task.isEnabled) {
        return (
            <Badge variant="secondary" className="text-xs">
                Paused
            </Badge>
        );
    }
    return (
        <Badge variant="default" className="text-xs bg-green-600 dark:bg-green-700">
            Active
        </Badge>
    );
}

function CreateTaskForm({
    agentOptions,
    onSubmit,
    onCancel,
}: {
    agentOptions: { value: string; label: string }[];
    onSubmit: () => void;
    onCancel: () => void;
}) {
    const dispatch = useAppDispatch();
    const [agentId, setAgentId] = useState(agentOptions[0]?.value ?? "");
    const [name, setName] = useState("");
    const [prompt, setPrompt] = useState("");
    const [schedule, setSchedule] = useState<ScheduleConfig>(DEFAULT_SCHEDULE);
    const [timezone, setTimezone] = useState("UTC");
    const [submitting, setSubmitting] = useState(false);

    const cronExpression = scheduleToCron(schedule);
    const canSubmit = agentId && name.trim() && prompt.trim() && !submitting;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!canSubmit) return;
        setSubmitting(true);
        try {
            await dispatch(
                createCronTask({
                    agentId,
                    name: name.trim(),
                    prompt: prompt.trim(),
                    cronExpression,
                    timezone,
                }),
            ).unwrap();
            onSubmit();
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            <div>
                <label className="block text-sm text-muted-foreground mb-1">Agent</label>
                <Select value={agentId} onChange={setAgentId} options={agentOptions} />
            </div>
            <div>
                <label className="block text-sm text-muted-foreground mb-1">Task Name</label>
                <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Daily standup summary"
                />
            </div>
            <div>
                <label className="block text-sm text-muted-foreground mb-1">Prompt</label>
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="The instruction sent to the agent on each execution..."
                    className={cn(
                        "w-full rounded-lg border border-border bg-input px-3 py-2 text-sm",
                        "text-foreground placeholder:text-muted-foreground",
                        "focus:outline-none focus:ring-2 focus:ring-ring min-h-[100px] resize-y",
                    )}
                />
            </div>

            {/* Schedule builder */}
            <div className="bg-card border border-border rounded-lg p-4">
                <h3 className="text-sm font-medium text-foreground mb-3">Schedule</h3>
                <ScheduleBuilder value={schedule} onChange={setSchedule} />
            </div>

            <div>
                <label className="block text-sm text-muted-foreground mb-1">Timezone</label>
                <Select value={timezone} onChange={setTimezone} options={TIMEZONE_OPTIONS} />
            </div>

            <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={onCancel}>
                    Cancel
                </Button>
                <Button type="submit" disabled={!canSubmit}>
                    {submitting ? (
                        <CircleNotch size={16} className="animate-spin" />
                    ) : (
                        <Plus size={16} />
                    )}
                    Create Task
                </Button>
            </div>
        </form>
    );
}

function TaskRunHistory({ taskId }: { taskId: string }) {
    const dispatch = useAppDispatch();
    const logs = useAppSelector(selectCronRunLogs(taskId));
    const [loaded, setLoaded] = useState(false);

    // Check if any logs are still pending (worker hasn't finished yet)
    const hasPending = useMemo(
        () => logs.some((log) => log.status === "pending"),
        [logs],
    );

    useEffect(() => {
        dispatch(fetchCronRunLogs({ taskId }));
        // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting loaded state when taskId changes
        setLoaded(true);
    }, [taskId, dispatch]);

    // Poll for updates while a run is pending
    useEffect(() => {
        if (!hasPending) return;
        const interval = setInterval(() => {
            dispatch(fetchCronRunLogs({ taskId }));
            dispatch(fetchCronTasks());
        }, 3000);
        return () => clearInterval(interval);
    }, [hasPending, taskId, dispatch]);

    if (!loaded) return null;

    if (logs.length === 0) {
        return (
            <div className="text-sm text-muted-foreground py-4 text-center">
                No execution history yet.
            </div>
        );
    }

    return (
        <div className="space-y-2">
            {logs.map((log) => (
                <div
                    key={log.id}
                    className="flex items-start gap-3 px-3 py-2 rounded-lg bg-muted/30 border border-border"
                >
                    <div className="pt-0.5">
                        {log.status === "pending" ? (
                            <CircleNotch
                                size={16}
                                className="animate-spin text-primary"
                            />
                        ) : log.status === "success" ? (
                            <CheckCircle
                                size={16}
                                weight="fill"
                                className="text-green-600 dark:text-green-400"
                            />
                        ) : (
                            <XCircle
                                size={16}
                                weight="fill"
                                className="text-red-500 dark:text-red-400"
                            />
                        )}
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span>
                                {formatRelativeTime(protoTimestampToDateStr(log.startedAt))}
                            </span>
                            {log.status === "pending" ? (
                                <span className="text-primary font-medium">Running...</span>
                            ) : (
                                <span>{log.inputTokens + log.outputTokens} tokens</span>
                            )}
                        </div>
                        {log.resultSummary && (
                            <p className="text-sm text-foreground mt-1 line-clamp-2">
                                {log.resultSummary}
                            </p>
                        )}
                        {log.error && (
                            <p className="text-sm text-red-500 dark:text-red-400 mt-1 line-clamp-2">
                                {log.error}
                            </p>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}

function TaskDetailPanel({
    task,
    onDelete,
}: {
    task: SerializedCronTask;
    onDelete: () => void;
}) {
    const [togglingEnabled, setTogglingEnabled] = useState(false);
    const [triggering, setTriggering] = useState(false);
    const dispatch = useAppDispatch();

    const handleToggle = async () => {
        setTogglingEnabled(true);
        try {
            await dispatch(
                updateCronTask({
                    taskId: task.id,
                    isEnabled: !task.isEnabled,
                }),
            ).unwrap();
        } finally {
            setTogglingEnabled(false);
        }
    };

    const handleTrigger = async () => {
        setTriggering(true);
        try {
            await dispatch(triggerCronTask(task.id)).unwrap();
            // Refresh logs to show the pending entry
            dispatch(fetchCronRunLogs({ taskId: task.id }));
        } finally {
            setTriggering(false);
        }
    };

    const scheduleLabel = cronToHuman(task.cronExpression);

    return (
        <>
            {/* Header */}
            <div className="px-6 py-4 border-b border-border">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <Timer size={20} className="text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 className="text-xl font-semibold text-foreground">{task.name}</h2>
                        <p className="text-sm text-muted-foreground truncate">
                            {scheduleLabel} ({task.timezone})
                            {task.agentName && ` - ${task.agentName}`}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={handleTrigger}
                            disabled={triggering}
                            title="Run now"
                        >
                            {triggering ? (
                                <CircleNotch size={14} className="animate-spin" />
                            ) : (
                                <Play size={14} weight="fill" />
                            )}
                            {triggering ? "Running..." : "Run Now"}
                        </Button>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={task.isEnabled}
                            aria-label={task.isEnabled ? "Pause task" : "Resume task"}
                            disabled={togglingEnabled}
                            onClick={handleToggle}
                            className={cn(
                                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                                task.isEnabled ? "bg-primary" : "bg-muted-foreground/30",
                                togglingEnabled && "opacity-50 cursor-not-allowed",
                            )}
                        >
                            <span
                                className={cn(
                                    "inline-block h-4 w-4 rounded-full bg-white transition-transform",
                                    task.isEnabled ? "translate-x-6" : "translate-x-1",
                                )}
                            />
                        </button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onDelete}
                            className="text-muted-foreground hover:text-red-500"
                            aria-label="Delete task"
                            title="Delete"
                        >
                            <Trash size={18} />
                        </Button>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Details card */}
                <div className="bg-card border border-border rounded-lg p-4 space-y-3">
                    <h3 className="font-medium text-foreground">Task Details</h3>
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Status</span>
                        <TaskStatusBadge task={task} />
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Schedule</span>
                        <span className="text-sm text-foreground">{scheduleLabel}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Timezone</span>
                        <span className="text-sm text-foreground">{task.timezone}</span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Next Run</span>
                        <span className="text-sm text-foreground">
                            {task.nextRunAt
                                ? formatRelativeTime(protoTimestampToDateStr(task.nextRunAt))
                                : "N/A"}
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Last Run</span>
                        <span className="text-sm text-foreground">
                            {task.lastRunAt
                                ? formatRelativeTime(protoTimestampToDateStr(task.lastRunAt))
                                : "Never"}
                        </span>
                    </div>
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Total Runs</span>
                        <span className="text-sm text-foreground">{task.runCount}</span>
                    </div>
                    {task.consecutiveFailures > 0 && (
                        <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">
                                Consecutive Failures
                            </span>
                            <Badge variant="destructive" className="text-xs">
                                {task.consecutiveFailures} / {task.maxConsecutiveFailures}
                            </Badge>
                        </div>
                    )}
                    {task.lastRunError && (
                        <div className="mt-2 p-3 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50">
                            <p className="text-xs font-medium text-red-700 dark:text-red-400 mb-1">
                                Last Error
                            </p>
                            <p className="text-xs text-red-600 dark:text-red-300 whitespace-pre-wrap break-words">
                                {task.lastRunError}
                            </p>
                        </div>
                    )}
                </div>

                {/* Prompt card */}
                <div className="bg-card border border-border rounded-lg p-4">
                    <h3 className="font-medium text-foreground mb-2">Prompt</h3>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {task.prompt}
                    </p>
                </div>

                {/* Run history */}
                <div className="bg-card border border-border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <Clock size={16} className="text-muted-foreground" />
                            <h3 className="font-medium text-foreground">Execution History</h3>
                        </div>
                    </div>
                    <TaskRunHistory taskId={task.id} />
                </div>
            </div>
        </>
    );
}

// Main view

export function AutomationsView({ agentId }: { agentId?: string } = {}) {
    const dispatch = useAppDispatch();
    const navigate = useNavigate();
    const { subId } = useParams<{ subId?: string }>();
    const allTasks = useAppSelector(selectCronTasksList);
    const loading = useAppSelector(selectCronLoading);
    const agents = useAppSelector((state) => state.agents.agents);

    // When top-level (no agentId prop), selection is URL-driven via subId.
    // When embedded inside AgentsView, selection is local state.
    const isTopLevel = !agentId;
    const [localSelectedTaskId, setLocalSelectedTaskId] = useState<string | null>(null);
    const selectedTaskId = isTopLevel ? (subId ?? null) : localSelectedTaskId;

    const selectTask = useCallback(
        (taskId: string | null) => {
            if (isTopLevel) {
                navigate(taskId ? `/agents/automations/${taskId}` : "/agents/automations", { replace: !taskId });
            } else {
                setLocalSelectedTaskId(taskId);
            }
        },
        [isTopLevel, navigate],
    );

    const [showCreateForm, setShowCreateForm] = useState(false);

    // Filter tasks by agent when scoped to a specific agent
    const tasks = useMemo(
        () => (agentId ? allTasks.filter((t) => t.agentId === agentId) : allTasks),
        [allTasks, agentId],
    );

    const agentOptions = useMemo(
        () =>
            agentId
                ? Object.values(agents)
                      .filter((a) => a.id === agentId)
                      .map((a) => ({ value: a.id, label: a.name }))
                : Object.values(agents).map((a) => ({
                      value: a.id,
                      label: a.name,
                  })),
        [agents, agentId],
    );

    useEffect(() => {
        dispatch(fetchCronTasks(agentId ? { agentId } : undefined));
    }, [agentId]); // eslint-disable-line react-hooks/exhaustive-deps

    const selectedTask = useMemo(
        () => (selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) ?? null : null),
        [selectedTaskId, tasks],
    );

    // No auto-select - URL drives selection for top-level, empty state shown otherwise.

    const handleDelete = async (taskId: string) => {
        await dispatch(deleteCronTask(taskId)).unwrap();
        if (selectedTaskId === taskId) {
            selectTask(null);
        }
    };

    const [defaultAutoLayout] = useState(() => loadPanelLayout("agents-automations"));

    const handleAutoLayoutChange = useCallback(
        (layout: Record<string, number>) => {
            savePanelLayout("agents-automations", layout);
        },
        [],
    );

    if (loading && tasks.length === 0) {
        return (
            <div className="flex h-full items-center justify-center">
                <CircleNotch size={32} className="animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (!isTopLevel) {
        return (
            <div className="flex h-full flex-col overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div>
                        <h3 className="text-sm font-semibold text-foreground">Scheduled Tasks</h3>
                        <p className="text-xs text-muted-foreground">
                            Recurring runs for this agent on a cron schedule.
                        </p>
                    </div>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => dispatch(fetchCronTasks({ agentId }))}
                            aria-label="Refresh"
                        >
                            <ArrowClockwise size={16} />
                        </Button>
                        <Button
                            size="sm"
                            onClick={() => {
                                setShowCreateForm(true);
                                selectTask(null);
                            }}
                        >
                            <Plus size={14} />
                            New task
                        </Button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {showCreateForm ? (
                        <div className="border border-border rounded-lg bg-card p-4">
                            {agentOptions.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-8">
                                    <Robot size={28} className="text-muted-foreground mb-2" />
                                    <p className="text-sm text-muted-foreground">
                                        Create an agent first to schedule tasks
                                    </p>
                                </div>
                            ) : (
                                <CreateTaskForm
                                    agentOptions={agentOptions}
                                    onSubmit={() => setShowCreateForm(false)}
                                    onCancel={() => setShowCreateForm(false)}
                                />
                            )}
                        </div>
                    ) : selectedTask ? (
                        <div className="border border-border rounded-lg bg-card">
                            <div className="px-4 py-2 border-b border-border flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">Task detail</span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => selectTask(null)}
                                >
                                    Back to list
                                </Button>
                            </div>
                            <TaskDetailPanel
                                task={selectedTask}
                                onDelete={() => handleDelete(selectedTask.id)}
                            />
                        </div>
                    ) : tasks.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 border border-dashed border-border rounded-lg bg-muted/30">
                            <Timer size={32} className="text-muted-foreground mb-2" />
                            <p className="text-sm text-muted-foreground">No scheduled tasks yet</p>
                            <Button
                                variant="secondary"
                                size="sm"
                                className="mt-3"
                                onClick={() => setShowCreateForm(true)}
                            >
                                <Plus size={14} />
                                Create task
                            </Button>
                        </div>
                    ) : (
                        tasks.map((task) => {
                            const agentName = agents[task.agentId]?.name;
                            return (
                                <button
                                    key={task.id}
                                    type="button"
                                    onClick={() => selectTask(task.id)}
                                    className="w-full text-left border border-border rounded-lg bg-card hover:bg-muted px-4 py-3 flex items-center gap-3 transition-colors"
                                >
                                    <div className="shrink-0">
                                        <TaskStatusBadge task={task} />
                                    </div>
                                    <div className="flex flex-col flex-1 min-w-0">
                                        <span className="text-sm font-medium truncate text-foreground">
                                            {task.name}
                                        </span>
                                        <span className="text-xs text-muted-foreground truncate">
                                            {cronToHuman(task.cronExpression)}
                                            {agentName && ` - ${agentName}`}
                                        </span>
                                    </div>
                                    <CaretRight size={14} className="text-muted-foreground shrink-0" />
                                </button>
                            );
                        })
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full overflow-hidden">
            <Group
                orientation="horizontal"
                className="h-full w-full flex"
                defaultLayout={defaultAutoLayout}
                onLayoutChange={handleAutoLayoutChange}
            >
            <Panel
                id="automations-sidebar"
                defaultSize={280}
                minSize={200}
                maxSize={400}
                className="border-r border-border bg-card overflow-hidden"
            >
            {/* Left sidebar - task list */}
            <div className="h-full flex flex-col">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                    <span className="font-semibold text-foreground">Scheduled Tasks</span>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => dispatch(fetchCronTasks())}
                            aria-label="Refresh"
                        >
                            <ArrowClockwise size={16} />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className={showCreateForm ? "text-primary bg-primary/10" : ""}
                            onClick={() => {
                                setShowCreateForm(!showCreateForm);
                                if (!showCreateForm) selectTask(null);
                            }}
                            aria-label="Create task"
                        >
                            <Plus size={16} />
                        </Button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {tasks.length === 0 && !loading ? (
                        <div className="flex flex-col items-center justify-center py-12 px-4">
                            <Timer size={28} className="text-muted-foreground mb-2" />
                            <p className="text-sm text-muted-foreground text-center">
                                No scheduled tasks yet
                            </p>
                        </div>
                    ) : (
                        tasks.map((task) => {
                            const isSelected = task.id === selectedTaskId;
                            const agentName = agents[task.agentId]?.name;
                            return (
                                <button
                                    key={task.id}
                                    type="button"
                                    onClick={() => {
                                        selectTask(task.id);
                                        setShowCreateForm(false);
                                    }}
                                    className={cn(
                                        "w-full px-4 py-3 flex items-center gap-3",
                                        "cursor-pointer transition-colors text-left",
                                        isSelected
                                            ? "bg-primary/10 border-l-2 border-primary"
                                            : "hover:bg-muted border-l-2 border-transparent",
                                    )}
                                >
                                    <div className="shrink-0">
                                        {task.lastRunStatus === "error" ? (
                                            <XCircle
                                                size={16}
                                                weight="fill"
                                                className="text-red-500 dark:text-red-400"
                                            />
                                        ) : task.isEnabled ? (
                                            <Play
                                                size={16}
                                                weight="fill"
                                                className="text-green-600 dark:text-green-400"
                                            />
                                        ) : (
                                            <Pause
                                                size={16}
                                                weight="fill"
                                                className="text-muted-foreground"
                                            />
                                        )}
                                    </div>
                                    <div className="flex flex-col flex-1 min-w-0">
                                        <span className="text-sm font-medium truncate text-foreground">
                                            {task.name}
                                        </span>
                                        <span className="text-xs text-muted-foreground truncate">
                                            {cronToHuman(task.cronExpression)}
                                            {agentName && ` - ${agentName}`}
                                        </span>
                                    </div>
                                    <CaretRight
                                        size={14}
                                        className="text-muted-foreground shrink-0"
                                    />
                                </button>
                            );
                        })
                    )}
                </div>
            </div>
            </Panel>

            <Separator className="w-1 bg-border hover:bg-primary/50 transition-colors cursor-col-resize data-[resize-handle-state=drag]:bg-primary" />

            {/* Right panel */}
            <Panel id="automations-detail" minSize={400}>
            <div className="h-full flex flex-col overflow-hidden">
                {showCreateForm ? (
                    <>
                        <div className="px-6 py-4 border-b border-border">
                            <h2 className="text-xl font-semibold text-foreground">
                                Create Scheduled Task
                            </h2>
                            <p className="text-sm text-muted-foreground">
                                Set up a recurring task that runs on a schedule
                            </p>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6">
                            <div className="max-w-xl">
                                {agentOptions.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-12">
                                        <Robot
                                            size={32}
                                            className="text-muted-foreground mb-2"
                                        />
                                        <p className="text-sm text-muted-foreground">
                                            Create an agent first to schedule tasks
                                        </p>
                                    </div>
                                ) : (
                                    <CreateTaskForm
                                        agentOptions={agentOptions}
                                        onSubmit={() => setShowCreateForm(false)}
                                        onCancel={() => setShowCreateForm(false)}
                                    />
                                )}
                            </div>
                        </div>
                    </>
                ) : selectedTask ? (
                    <TaskDetailPanel
                        task={selectedTask}
                        onDelete={() => handleDelete(selectedTask.id)}
                    />
                ) : (
                    <div className="flex-1 flex items-center justify-center">
                        <div className="text-center">
                            <Lightning
                                size={32}
                                className="text-muted-foreground mx-auto mb-2"
                            />
                            <p className="text-muted-foreground">
                                {tasks.length > 0
                                    ? "Select a task from the sidebar"
                                    : "No scheduled tasks configured"}
                            </p>
                            {tasks.length === 0 && (
                                <Button
                                    variant="secondary"
                                    size="sm"
                                    className="mt-3"
                                    onClick={() => setShowCreateForm(true)}
                                >
                                    <Plus size={14} />
                                    Create Task
                                </Button>
                            )}
                        </div>
                    </div>
                )}
            </div>
            </Panel>
            </Group>
        </div>
    );
}
