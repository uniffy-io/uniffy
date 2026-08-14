import { useState, useMemo, useCallback } from "react";
import { ArrowsClockwise, CaretDown, CaretRight } from "@phosphor-icons/react";
import { cn } from "@/shared/utils/cn";
import { Select } from "@/components/ui/select";
import { DatePicker } from "@/components/ui/date-picker";
import { NumberInput } from "@/components/ui/number-input";

type RecurrencePattern = "daily" | "weekly" | "biweekly" | "monthly" | "yearly";
type DayOfWeek = "MONDAY" | "TUESDAY" | "WEDNESDAY" | "THURSDAY" | "FRIDAY" | "SATURDAY" | "SUNDAY";
type EndCondition = "never" | "after" | "on_date";

interface RecurrenceConfig {
  pattern: string;
  interval: number;
  days_of_week?: string[];
  day_of_month?: number;
  end_date?: string | null;
  max_occurrences?: number | null;
  occurrences_created?: number;
}

const PATTERNS: { value: RecurrencePattern; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
];

const ALL_DAYS: { value: DayOfWeek; label: string; short: string }[] = [
  { value: "MONDAY", label: "Monday", short: "Mo" },
  { value: "TUESDAY", label: "Tuesday", short: "Tu" },
  { value: "WEDNESDAY", label: "Wednesday", short: "We" },
  { value: "THURSDAY", label: "Thursday", short: "Th" },
  { value: "FRIDAY", label: "Friday", short: "Fr" },
  { value: "SATURDAY", label: "Saturday", short: "Sa" },
  { value: "SUNDAY", label: "Sunday", short: "Su" },
];

const INTERVAL_UNITS: Record<RecurrencePattern, string> = {
  daily: "day(s)",
  weekly: "week(s)",
  biweekly: "week(s)",
  monthly: "month(s)",
  yearly: "year(s)",
};

function getTodayDayOfWeek(): DayOfWeek {
  const mapping: DayOfWeek[] = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ];
  return mapping[new Date().getDay()];
}

function parseConfig(json: string | null): RecurrenceConfig | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed === "object" && parsed.pattern) return parsed;
    return null;
  } catch {
    return null;
  }
}

function serializeConfig(config: RecurrenceConfig): string {
  return JSON.stringify(config);
}

function getEndCondition(config: RecurrenceConfig): EndCondition {
  if (config.max_occurrences) return "after";
  if (config.end_date) return "on_date";
  return "never";
}

function describeSummary(config: RecurrenceConfig): string {
  const pattern = config.pattern as RecurrencePattern;
  const interval = config.interval;
  let desc = "";

  if (pattern === "daily") {
    desc = interval === 1 ? "Every day" : `Every ${interval} days`;
  } else if (pattern === "weekly") {
    desc = interval === 1 ? "Every week" : `Every ${interval} weeks`;
  } else if (pattern === "biweekly") {
    desc = "Every 2 weeks";
  } else if (pattern === "monthly") {
    desc = interval === 1 ? "Every month" : `Every ${interval} months`;
    if (config.day_of_month)
      desc += ` on the ${config.day_of_month}${ordinalSuffix(config.day_of_month)}`;
  } else if (pattern === "yearly") {
    desc = interval === 1 ? "Every year" : `Every ${interval} years`;
  }

  if ((pattern === "weekly" || pattern === "biweekly") && config.days_of_week?.length) {
    const dayNames = config.days_of_week.map(
      (d) => d.charAt(0) + d.slice(1).toLowerCase().slice(0, 2),
    );
    desc += ` on ${dayNames.join(", ")}`;
  }

  return desc;
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

const INPUT_CLASS = cn(
  "h-auto w-14 px-1.5 py-0.5 text-xs rounded text-foreground text-center",
  "focus:ring-1 focus:ring-primary/50 focus:border-primary transition-all",
);

interface TaskRecurrenceSelectorProps {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

export function TaskRecurrenceSelector({ value, onChange, disabled }: TaskRecurrenceSelectorProps) {
  const config = useMemo(() => parseConfig(value), [value]);
  const isActive = config !== null;
  const pattern = (config?.pattern as RecurrencePattern) ?? "weekly";
  const [isOpen, setIsOpen] = useState(false);

  const [endCondition, setEndCondition] = useState<EndCondition>(() =>
    config ? getEndCondition(config) : "never",
  );

  const emitChange = useCallback(
    (newConfig: RecurrenceConfig) => {
      onChange(serializeConfig(newConfig));
    },
    [onChange],
  );

  const handleToggle = useCallback(() => {
    if (isActive) {
      onChange(null);
      setIsOpen(false);
    } else {
      emitChange({
        pattern: "weekly",
        interval: 1,
        days_of_week: [getTodayDayOfWeek()],
        occurrences_created: 1,
      });
      setIsOpen(true);
    }
  }, [isActive, onChange, emitChange]);

  const handlePatternChange = useCallback(
    (newPattern: RecurrencePattern) => {
      const base: RecurrenceConfig = {
        pattern: newPattern,
        interval: newPattern === "biweekly" ? 2 : (config?.interval ?? 1),
        occurrences_created: config?.occurrences_created ?? 0,
      };
      if (newPattern === "weekly" || newPattern === "biweekly") {
        base.days_of_week = config?.days_of_week?.length
          ? config.days_of_week
          : [getTodayDayOfWeek()];
      }
      if (newPattern === "monthly") {
        base.day_of_month = config?.day_of_month ?? new Date().getDate();
      }
      if (endCondition === "after") base.max_occurrences = config?.max_occurrences ?? 10;
      if (endCondition === "on_date") base.end_date = config?.end_date;
      emitChange(base);
    },
    [config, endCondition, emitChange],
  );

  const handleIntervalChange = useCallback(
    (interval: number) => {
      if (!config) return;
      emitChange({ ...config, interval: Math.max(1, Math.min(99, interval)) });
    },
    [config, emitChange],
  );

  const handleDayToggle = useCallback(
    (day: DayOfWeek) => {
      if (!config) return;
      const current = (config.days_of_week ?? []) as string[];
      const updated = current.includes(day) ? current.filter((d) => d !== day) : [...current, day];
      emitChange({ ...config, days_of_week: updated.length > 0 ? updated : [day] });
    },
    [config, emitChange],
  );

  const handleDayOfMonthChange = useCallback(
    (dayOfMonth: number) => {
      if (!config) return;
      emitChange({ ...config, day_of_month: Math.max(1, Math.min(31, dayOfMonth)) });
    },
    [config, emitChange],
  );

  const handleEndConditionChange = useCallback(
    (condition: EndCondition) => {
      setEndCondition(condition);
      if (!config) return;
      const updated = { ...config };
      delete updated.max_occurrences;
      delete updated.end_date;
      if (condition === "after") updated.max_occurrences = 10;
      if (condition === "on_date") {
        const d = new Date();
        d.setMonth(d.getMonth() + 3);
        updated.end_date = d.toISOString().split("T")[0];
      }
      emitChange(updated);
    },
    [config, emitChange],
  );

  const showDaysOfWeek = pattern === "weekly" || pattern === "biweekly";
  const showDayOfMonth = pattern === "monthly";

  // Not active - show simple toggle
  if (!isActive) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={handleToggle}
        className={cn(
          "flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted px-2 py-1 rounded-md transition-colors",
          disabled && "opacity-50 cursor-not-allowed",
        )}
      >
        <ArrowsClockwise size={13} />
        Set recurrence
      </button>
    );
  }

  // Active - show summary with expand/collapse for editing
  return (
    <div className="space-y-1.5">
      {/* Summary row */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          className="flex items-center gap-1.5 text-xs bg-primary/10 text-primary px-2 py-1 rounded-md transition-colors hover:bg-primary/15 flex-1 min-w-0"
        >
          <ArrowsClockwise size={13} weight="fill" className="shrink-0" />
          <span className="truncate">{config ? describeSummary(config) : "Recurring"}</span>
          {!disabled &&
            (isOpen ? (
              <CaretDown size={10} className="shrink-0 ml-auto" />
            ) : (
              <CaretRight size={10} className="shrink-0 ml-auto" />
            ))}
        </button>
        {!disabled && (
          <button
            type="button"
            onClick={handleToggle}
            className="text-[10px] text-muted-foreground hover:text-destructive transition-colors shrink-0 px-1"
            title="Remove recurrence"
          >
            Clear
          </button>
        )}
      </div>

      {/* Expanded config */}
      {isOpen && !disabled && config && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
          {/* Pattern + Interval row */}
          <div className="flex items-center gap-2 flex-wrap">
            <Select
              value={pattern}
              onChange={(v) => handlePatternChange(v as RecurrencePattern)}
              options={PATTERNS.map((p) => ({ value: p.value, label: p.label }))}
              className="w-28"
            />
            <span className="text-xs text-muted-foreground">every</span>
            <NumberInput
              min={1}
              max={99}
              value={config.interval}
              onChange={(e) => handleIntervalChange(parseInt(e.target.value) || 1)}
              className={INPUT_CLASS}
            />
            <span className="text-xs text-muted-foreground">{INTERVAL_UNITS[pattern]}</span>
          </div>

          {/* Days of week */}
          {showDaysOfWeek && (
            <div className="flex flex-wrap gap-1">
              {ALL_DAYS.map((day) => {
                const selected = (config.days_of_week ?? []).includes(day.value);
                return (
                  <button
                    key={day.value}
                    type="button"
                    onClick={() => handleDayToggle(day.value)}
                    className={cn(
                      "w-7 h-7 rounded-full text-[10px] font-medium transition-colors",
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "bg-background text-muted-foreground hover:text-foreground border border-border",
                    )}
                    title={day.label}
                  >
                    {day.short}
                  </button>
                );
              })}
            </div>
          )}

          {/* Day of month */}
          {showDayOfMonth && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">on day</span>
              <NumberInput
                min={1}
                max={31}
                value={config.day_of_month ?? 1}
                onChange={(e) => handleDayOfMonthChange(parseInt(e.target.value) || 1)}
                className={INPUT_CLASS}
              />
            </div>
          )}

          {/* End condition */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
              Ends
            </span>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="radio"
                name="endCondition"
                checked={endCondition === "never"}
                onChange={() => handleEndConditionChange("never")}
                className="h-3 w-3 accent-primary"
              />
              <span className="text-foreground">Never</span>
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="radio"
                name="endCondition"
                checked={endCondition === "after"}
                onChange={() => handleEndConditionChange("after")}
                className="h-3 w-3 accent-primary"
              />
              <span className="text-foreground">After</span>
              {endCondition === "after" && (
                <>
                  <NumberInput
                    min={1}
                    max={999}
                    value={config.max_occurrences ?? 10}
                    onChange={(e) => {
                      if (!config) return;
                      emitChange({
                        ...config,
                        max_occurrences: Math.max(1, parseInt(e.target.value) || 1),
                      });
                    }}
                    className={INPUT_CLASS}
                  />
                  <span className="text-muted-foreground">total occurrences</span>
                </>
              )}
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="radio"
                name="endCondition"
                checked={endCondition === "on_date"}
                onChange={() => handleEndConditionChange("on_date")}
                className="h-3 w-3 accent-primary"
              />
              <span className="text-foreground">On</span>
              {endCondition === "on_date" && (
                <DatePicker
                  value={config.end_date ?? ""}
                  onChange={(v) => {
                    if (!config) return;
                    emitChange({ ...config, end_date: v || null });
                  }}
                  placeholder="Pick end date"
                />
              )}
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
